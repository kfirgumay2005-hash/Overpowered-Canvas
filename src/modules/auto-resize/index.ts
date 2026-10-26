import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { OpcNode } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { showPicker } from "../../ui/picker";
import { common, isTextBox, mutate, nodeType, onlyNodes, onlyTextBoxes } from "../shared";

interface AutoResizeSettings {
	/** "Fit text" cards grow up to this width (canvas units), then their lines wrap. */
	maxWidth: number;
	/** New text cards start in "Fit text" mode. */
	newCards: boolean;
}

interface Watch {
	observer: ResizeObserver;
	/** Typing in the editor iframe: its input events don't reach our document. */
	mutations: MutationObserver;
	onInput: () => void;
	frame: number;
}

type Mode = "off" | "fit" | "height" | "width";
const MODES: readonly Mode[] = ["off", "fit", "height", "width"];
const ICONS: Record<Mode, string> = { off: "square", fit: "wrap-text", height: "fold-vertical", width: "fold-horizontal" };
/** Widest a card grows to by itself. */
const MAX_WIDTH = 2400;
/** Narrowest a "Fit text" card shrinks to. */
const FIT_MIN_WIDTH = 80;

function modeOf(extra: Readonly<OpcNode>): Mode {
	return extra.autoFit ? "fit" : extra.autoWidth ? "width" : extra.autoResize ? "height" : "off";
}

const PATCH: Record<Mode, Partial<OpcNode>> = {
	off: { autoResize: undefined, autoWidth: undefined, autoFit: undefined },
	fit: { autoResize: undefined, autoWidth: undefined, autoFit: true },
	height: { autoResize: true, autoWidth: undefined, autoFit: undefined },
	width: { autoResize: undefined, autoWidth: true, autoFit: undefined },
};

/**
 * Measures how tall the node must be to show all of its text, in reading or editing mode.
 * Returns the new node height, or null when it cannot be measured right now.
 */
function neededHeight(node: CanvasNodeLike): number | null {
	const content = node.contentEl;
	if (!content || !content.isConnected) return null;
	if (node.isEditing) {
		// Text cards edit inside an iframe.
		const root = content.querySelector<HTMLIFrameElement>("iframe.embed-iframe")?.contentDocument ?? content;
		const scroller = root.querySelector<HTMLElement>(".cm-scroller");
		const cm = root.querySelector<HTMLElement>(".cm-content");
		if (!scroller || !cm) return null;
		const style = scroller.win.getComputedStyle(scroller);
		const inner = cm.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
		return node.height + (inner - scroller.clientHeight);
	}
	const preview = content.querySelector<HTMLElement>(".markdown-embed-content > .markdown-preview-view");
	if (!preview || !preview.isShown()) return null;
	const available = preview.clientHeight;
	preview.setCssStyles({ height: "1px" });
	const needed = preview.scrollHeight;
	preview.setCssStyles({ height: "" });
	return node.height + (needed - available) + 1;
}

/**
 * How wide the node must be for its longest line (lines don't wrap in this mode).
 * Layout sizes (offsetWidth, rects inside the editor iframe) are in canvas units: the canvas
 * zoom is a transform on an ancestor.
 */
function neededWidth(node: CanvasNodeLike): number | null {
	const content = node.contentEl;
	if (!content || !content.isConnected) return null;
	if (node.isEditing) {
		const doc = content.querySelector<HTMLIFrameElement>("iframe.embed-iframe")?.contentDocument;
		const cm = doc?.querySelector<HTMLElement>(".cm-content");
		if (!doc || !cm) return null;
		const range = doc.createRange();
		let widest = 0;
		let lineBox = 0;
		for (const line of cm.querySelectorAll<HTMLElement>(".cm-line")) {
			range.selectNodeContents(line);
			widest = Math.max(widest, range.getBoundingClientRect().width);
			const style = doc.defaultView!.getComputedStyle(line);
			lineBox = Math.max(lineBox, line.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight));
		}
		if (!lineBox) return null;
		// A little room for the caret.
		return node.width + (Math.ceil(widest) + 4 - lineBox);
	}
	const sizer = content.querySelector<HTMLElement>(".markdown-embed-content > .markdown-preview-view > .markdown-preview-sizer");
	if (!sizer || !sizer.isShown()) return null;
	const available = sizer.offsetWidth;
	sizer.setCssStyles({ width: "max-content" });
	const needed = sizer.offsetWidth;
	sizer.setCssStyles({ width: "" });
	return node.width + (needed - available) + 1;
}

/**
 * How wide a "Fit text" card must be: as wide as its text with one line per paragraph, at most
 * `max` (then the lines wrap). Measured in reading mode, so custom fonts and CSS count.
 */
function fittedWidth(node: CanvasNodeLike, max: number): number | null {
	const content = node.contentEl;
	if (!content || !content.isConnected || node.isEditing) return null;
	const sizer = content.querySelector<HTMLElement>(".markdown-embed-content > .markdown-preview-view > .markdown-preview-sizer");
	if (!sizer || !sizer.isShown()) return null;
	const available = sizer.offsetWidth;
	sizer.setCssStyles({ width: "max-content" });
	const needed = sizer.offsetWidth;
	sizer.setCssStyles({ width: "" });
	return Math.min(max, node.width + (needed - available) + 2);
}

/** Per-node choice: the card grows and shrinks to fit its text, downwards or sideways. */
export const autoResizeModule = defineModule<AutoResizeSettings>({
	id: "auto-resize",
	name: "autoResize.name",
	description: "autoResize.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: { maxWidth: 400, newCards: true },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			maxWidth: typeof s.maxWidth === "number" && s.maxWidth >= 100 && s.maxWidth <= MAX_WIDTH ? Math.round(s.maxWidth) : defaults.maxWidth,
			newCards: typeof s.newCards === "boolean" ? s.newCards : defaults.newCards,
		};
	},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const watches = new Map<CanvasNodeLike, Watch>();

		const fit = (node: CanvasNodeLike) => {
			const min = node.canvas.config.minContainerDimension;
			let width = node.width;
			const mode = modeOf(ctx.data.node(node).get());
			if (mode === "fit") {
				// While editing the width stays; it fits again once the text is shown.
				const target = fittedWidth(node, ctx.settings.maxWidth);
				if (target !== null) width = Math.max(Math.min(FIT_MIN_WIDTH, ctx.settings.maxWidth), min, Math.round(target));
				if (Math.abs(width - node.width) > 1) {
					node.resize({ width, height: node.height });
					node.render();
				}
			} else if (mode === "width") {
				const target = neededWidth(node);
				if (target !== null) width = Math.min(MAX_WIDTH, Math.max(min, Math.round(target)));
				if (Math.abs(width - node.width) > 1) {
					node.resize({ width, height: node.height });
					node.render();
				}
			}
			const target = neededHeight(node);
			if (target === null) return;
			const height = Math.max(min, Math.round(target));
			if (Math.abs(height - node.height) <= 1 && width === node.width) return;
			node.resize({ width: node.width, height });
			node.render();
			// An automatic fit is not a user action: fold it into the current undo step.
			node.canvas.overrideHistory();
		};

		const schedule = (node: CanvasNodeLike) => {
			const w = watches.get(node);
			if (!w || w.frame) return;
			w.frame = window.requestAnimationFrame(() => {
				w.frame = 0;
				observeTargets(node, w);
				fit(node);
			});
		};

		const observeTargets = (node: CanvasNodeLike, w: Watch) => {
			for (const el of node.contentEl?.querySelectorAll<HTMLElement>(".markdown-preview-sizer, .cm-content") ?? []) w.observer.observe(el);
			const cm = node.contentEl?.querySelector<HTMLIFrameElement>("iframe.embed-iframe")?.contentDocument?.querySelector<HTMLElement>(".cm-content");
			if (cm) {
				w.observer.observe(cm);
				w.mutations.observe(cm, { childList: true, subtree: true, characterData: true });
			}
		};

		const watch = (node: CanvasNodeLike) => {
			if (watches.has(node)) return schedule(node);
			const w: Watch = { observer: new ResizeObserver(() => schedule(node)), mutations: new MutationObserver(() => schedule(node)), onInput: () => schedule(node), frame: 0 };
			watches.set(node, w);
			node.nodeEl.addEventListener("input", w.onInput, true);
			observeTargets(node, w);
			schedule(node);
		};

		const unwatch = (node: CanvasNodeLike) => {
			const w = watches.get(node);
			if (!w) return;
			w.observer.disconnect();
			w.mutations.disconnect();
			if (w.frame) cancelAnimationFrame(w.frame);
			node.nodeEl.removeEventListener("input", w.onInput, true);
			watches.delete(node);
		};

		ctx.decorateNodes({
			apply: (node, extra) => {
				const mode = nodeType(node) === "text" || nodeType(node) === "file" ? modeOf(extra) : "off";
				node.nodeEl.toggleAttribute("data-opc-auto-resize", mode !== "off");
				node.nodeEl.toggleAttribute("data-opc-auto-width", mode === "width");
				if (mode !== "off") watch(node);
				else unwatch(node);
			},
			clear: (node) => {
				node.nodeEl.removeAttribute("data-opc-auto-resize");
				node.nodeEl.removeAttribute("data-opc-auto-width");
				unwatch(node);
			},
		});
		ctx.on("node-removed", unwatch);
		// The editor iframe appears a moment after editing starts: observe it once it's there.
		ctx.on("node-editing", (node) => {
			if (!watches.has(node)) return;
			schedule(node);
			ctx.registerInterval(window.setTimeout(() => schedule(node), 250));
		});
		ctx.register(() => {
			for (const node of [...watches.keys()]) unwatch(node);
		});

		const eligible = (selection: Parameters<typeof onlyNodes>[0]) => onlyTextBoxes(ctx, selection);
		const current = (nodes: CanvasNodeLike[]) => common(nodes, (n) => modeOf(ctx.data.node(n).get()));

		ctx.addMenuButton({
			id: "auto-resize",
			icon: (selection) => {
				const mode = current(eligible(selection) ?? []) ?? "off";
				return mode === "off" ? ICONS.height : ICONS[mode];
			},
			tooltip: () => ctx.t("autoResize.button"),
			order: 13,
			isVisible: (selection) => !!eligible(selection),
			isActive: (selection) => (current(eligible(selection) ?? []) ?? "off") !== "off",
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = eligible(selection) ?? [];
				const now = current(nodes);
				showPicker(
					buttonEl,
					[{ columns: 3, items: MODES.map((m) => ({ id: m, label: ctx.t(`autoResize.mode.${m}` as I18nKey), icon: ICONS[m], active: now === m })) }],
					(id) => {
						const mode = id as Mode;
						mutate(ctx, canvas, () => {
							for (const node of nodes) ctx.data.node(node).set(PATCH[mode]);
						});
						canvas.menu.render(true);
					},
				);
			},
		});

		// New text cards fit their text.
		const patched = new WeakSet<object>();
		ctx.onCanvas((canvas) => {
			const proto = Object.getPrototypeOf(canvas) as CanvasLike;
			if (patched.has(proto)) return;
			patched.add(proto);
			ctx.patch("canvas.createTextNode", proto, {
				createTextNode: (next) =>
					function (this: CanvasLike, ...args: Parameters<CanvasLike["createTextNode"]>) {
						const node = next.apply(this, args);
						if (ctx.settings.newCards && node && !this.readonly)
							try {
								ctx.data.node(node).set(PATCH.fit, { history: false });
							} catch (error) {
								console.error("[overpowered-canvas] auto-resize: fitting a new card failed", error);
							}
						return node;
					},
			});
		});

		/** "Fit text" for the selected text cards, or all of them. */
		const fitAll = (canvas: CanvasLike) => {
			const chosen = [...canvas.selection].filter((i): i is CanvasNodeLike => "nodeEl" in i);
			const nodes = (chosen.length ? chosen : [...canvas.nodes.values()]).filter((n) => nodeType(n) === "text" && isTextBox(ctx, n) && !ctx.data.node(n).get().sticky);
			mutate(ctx, canvas, () => {
				for (const node of nodes) ctx.data.node(node).set(PATCH.fit);
			});
		};
		ctx.addCommand({
			id: "fit-cards",
			name: ctx.t("autoResize.fitAll"),
			icon: "wrap-text",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) fitAll(canvas);
				return true;
			},
		});
	},

	renderSettings(el, ctx: ModuleContext<AutoResizeSettings>) {
		new Setting(el)
			.setName(ctx.t("autoResize.maxWidth.name"))
			.setDesc(ctx.t("autoResize.maxWidth.desc"))
			.addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(ctx.settings.maxWidth)).onChange((v) => {
					const n = Number(v);
					if (Number.isFinite(n) && n >= 100 && n <= MAX_WIDTH) void ctx.updateSettings({ maxWidth: Math.round(n) });
				});
			});
		new Setting(el)
			.setName(ctx.t("autoResize.newCards.name"))
			.setDesc(ctx.t("autoResize.newCards.desc"))
			.addToggle((t) => t.setValue(ctx.settings.newCards).onChange((v) => ctx.updateSettings({ newCards: v })));
	},
});
