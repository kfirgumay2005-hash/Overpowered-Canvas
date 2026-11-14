import { type Menu, Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { OpcNode, ShapeName } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { showPicker } from "../../ui/picker";
import { canvasDirection, common, isTextBox, mutate, nodeType, onlyNodes, selectedNodes, textCardsIn } from "../shared";
import { logError } from "../../core/log";
import { shapeMinSize, sizeForTextRoom, textRoom } from "../../geometry/shapes";

interface AutoResizeSettings {
	/** "Fit text" cards grow up to this width (canvas units), then their lines wrap. */
	maxWidth: number;
	/** The size mode new text cards start in. */
	newCards: Mode;
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
/** The choices in the toolbar's picker: "Fit text" is left out (owner's choice); it stays for new cards (setting) and the "Fit cards to their text" command. */
const PICKER_MODES: readonly Mode[] = MODES.filter((m) => m !== "fit");
const ICONS: Record<Mode, string> = { off: "square", fit: "wrap-text", height: "fold-vertical", width: "fold-horizontal" };
/** Widest a card grows to by itself. */
const MAX_WIDTH = 2400;
/** Only a bound for solving heights: cards never get near it. */
const MAX_HEIGHT = 100000;
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

/** The shape drawn on the card, if any (set by the shape renderer). */
function shapeOf(node: CanvasNodeLike): ShapeName | null {
	return node.nodeEl.getAttribute("data-opc-shape") as ShapeName | null;
}

/**
 * The card width or height at which its text gets `shortfall` more room than it has now. A
 * shape keeps text inside its outline (a diamond only uses the middle half), so the card grows
 * more than its text does; the size is solved from the outline in one step, since some shapes
 * give text a share that changes with the size (a parallelogram's slant).
 */
function sizeFor(node: CanvasNodeLike, axis: "x" | "y", shortfall: number): number {
	const shape = shapeOf(node);
	const room = textRoom(shape, node.width, node.height)[axis] + shortfall;
	return sizeForTextRoom(shape, axis, axis === "x" ? node.height : node.width, room, 1, axis === "x" ? MAX_WIDTH : MAX_HEIGHT);
}

/** The reading-mode width the text has now, and the width its longest line needs. */
function previewWidths(content: HTMLElement): { available: number; needed: number } | null {
	const sizer = content.querySelector<HTMLElement>(".markdown-embed-content > .markdown-preview-view > .markdown-preview-sizer");
	const view = sizer?.parentElement;
	if (!sizer || !view || !sizer.isShown()) return null;
	// In shapes the sizer (and the view around it) can be wider than the card, so the room is
	// the card's content box less the view's padding.
	const win = view.win;
	const outer = win.getComputedStyle(content);
	const inner = win.getComputedStyle(view);
	const room = content.clientWidth - parseFloat(outer.paddingLeft) - parseFloat(outer.paddingRight) - parseFloat(inner.paddingLeft) - parseFloat(inner.paddingRight);
	const available = Math.min(sizer.offsetWidth, room);
	sizer.setCssStyles({ width: "max-content" });
	const needed = sizer.offsetWidth;
	sizer.setCssStyles({ width: "" });
	return { available, needed };
}

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
		return sizeFor(node, "y", inner - scroller.clientHeight);
	}
	const preview = content.querySelector<HTMLElement>(".markdown-embed-content > .markdown-preview-view");
	if (!preview || !preview.isShown()) return null;
	const available = preview.clientHeight;
	preview.setCssStyles({ height: "1px" });
	const needed = preview.scrollHeight;
	preview.setCssStyles({ height: "" });
	return sizeFor(node, "y", needed - available + 1);
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
		return sizeFor(node, "x", Math.ceil(widest) + 4 - lineBox);
	}
	const w = previewWidths(content);
	return w ? sizeFor(node, "x", w.needed - w.available + 1) : null;
}

/**
 * How wide a "Fit text" card must be: as wide as its text with one line per paragraph, at most
 * `max` (then the lines wrap). Measured in reading mode, so custom fonts and CSS count.
 */
function fittedWidth(node: CanvasNodeLike, max: number): number | null {
	const content = node.contentEl;
	if (!content || !content.isConnected || node.isEditing) return null;
	const w = previewWidths(content);
	return w ? Math.min(max, sizeFor(node, "x", w.needed - w.available + 2)) : null;
}

/**
 * Gives the card a new width without bending its arrows: a card linked only on its left keeps
 * its left edge, only on its right its right edge, and one linked from above or below (or on
 * both sides) grows evenly around its center. A card without arrows grows away from the side
 * text starts on.
 */
function setWidth(node: CanvasNodeLike, width: number): void {
	// The core rounds positions: centering from the rounded box each time would drift a
	// half pixel per change, so the exact center is kept while nothing else moved the card.
	const last = centers.get(node);
	const center = last && last.x === node.x && last.width === node.width ? last.center : node.x + node.width / 2;
	const sides = new Set<string>();
	for (const e of node.canvas.getEdgesForNode(node)) {
		if (e.from.node === node) sides.add(e.from.side);
		if (e.to.node === node) sides.add(e.to.side);
	}
	const left = sides.has("left");
	const right = sides.has("right");
	const keepRight = right && !left ? true : left && !right ? false : sides.size ? null : canvasDirection(node.canvas) === "rtl";
	const x = keepRight === null ? Math.round(center - width / 2) : keepRight ? node.x + node.width - width : node.x;
	if (x === node.x) node.resize({ width, height: node.height });
	else node.moveAndResize({ x, y: node.y, width, height: node.height });
	if (keepRight === null) centers.set(node, { x: node.x, width: node.width, center });
	else centers.delete(node);
}
/** Exact centers of cards that grow around their center (see setWidth). */
const centers = new WeakMap<CanvasNodeLike, { x: number; width: number; center: number }>();

/** Per-node choice: the card grows and shrinks to fit its text, downwards or sideways. */
export const autoResizeModule = defineModule<AutoResizeSettings>({
	id: "auto-resize",
	name: "autoResize.name",
	description: "autoResize.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: { maxWidth: 400, newCards: "width" },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		// Older versions stored a boolean here, whatever the type says.
		const stored: unknown = s.newCards;
		return {
			maxWidth: typeof s.maxWidth === "number" && s.maxWidth >= 100 && s.maxWidth <= MAX_WIDTH ? Math.round(s.maxWidth) : defaults.maxWidth,
			// Older versions had an on/off switch for "Fit text": off stays off, on takes the new default.
			newCards: MODES.find((m) => m === stored) ?? (stored === false ? "off" : defaults.newCards),
		};
	},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const watches = new Map<CanvasNodeLike, Watch>();
		/**
		 * "Grow sideways" cards never get narrower than this: the width they had when watching
		 * began, at most a new card's width (an empty new card or shape keeps its size).
		 */
		const floors = new Map<CanvasNodeLike, number>();
		/** Cards being resized by hand: fitting them now would undo the drag. */
		const resizing = new Set<CanvasNodeLike>();

		const fit = (node: CanvasNodeLike) => {
			if (resizing.has(node)) return;
			const min = node.canvas.config.minContainerDimension;
			let width = node.width;
			let widthChanged = false;
			const extra = ctx.data.node(node).get();
			const mode = modeOf(extra);
			// A shaped card keeps room for its text inside the outline.
			const shapeMin = extra.kind === undefined && extra.shape ? shapeMinSize(extra.shape, node.canvas.config.defaultTextNodeDimensions) : null;
			if (mode === "fit") {
				// While editing the width stays; it fits again once the text is shown.
				const target = fittedWidth(node, ctx.settings.maxWidth);
				if (target !== null) width = Math.max(Math.min(FIT_MIN_WIDTH, ctx.settings.maxWidth), min, shapeMin?.width ?? 0, Math.round(target));
				if (Math.abs(width - node.width) > 1) {
					setWidth(node, width);
					node.render();
					widthChanged = true;
				}
			} else if (mode === "width") {
				const target = neededWidth(node);
				if (target !== null) width = Math.min(MAX_WIDTH, Math.max(min, floors.get(node) ?? 0, shapeMin?.width ?? 0, Math.round(target)));
				if (Math.abs(width - node.width) > 1) {
					setWidth(node, width);
					node.render();
					widthChanged = true;
				}
			}
			const target = neededHeight(node);
			if (target === null) return;
			const height = Math.max(min, shapeMin?.height ?? 0, Math.round(target));
			// A width within a pixel was left alone above: resizing to the same size would still
			// redraw the card's arrows (and drop a label the core has just opened for editing).
			if (Math.abs(height - node.height) <= 1 && !widthChanged) return;
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
			// Only what the card shows now: the editor of a card that stopped editing stays alive
			// for the next card, and watching it would refit this one on every change there.
			w.observer.disconnect();
			w.mutations.disconnect();
			for (const el of node.contentEl?.querySelectorAll<HTMLElement>(".markdown-preview-sizer, .cm-content") ?? []) w.observer.observe(el);
			const cm = node.contentEl?.querySelector<HTMLIFrameElement>("iframe.embed-iframe")?.contentDocument?.querySelector<HTMLElement>(".cm-content");
			if (cm) {
				w.observer.observe(cm);
				w.mutations.observe(cm, { childList: true, subtree: true, characterData: true });
			}
		};

		const watch = (node: CanvasNodeLike) => {
			if (watches.has(node)) return schedule(node);
			floors.set(node, Math.min(node.width, node.canvas.config.defaultTextNodeDimensions.width));
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
			floors.delete(node);
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

		// Resizing a card by hand drops the automatic size it would snap back to: a new height
		// turns auto-resize off, a new width alone keeps the height growing with the text.
		ctx.onCanvas((canvas) => {
			const win = canvas.wrapperEl.win;
			let sizes: Map<CanvasNodeLike, { width: number; height: number }> | null = null;
			const onDown = (evt: PointerEvent) => {
				const handle = (evt.target as Element | null)?.closest(".canvas-node-resizer");
				if (!handle || canvas.readonly) return;
				const layer = canvas.nodeInteractionLayer;
				const nodes = layer && handle.parentElement === layer.interactionEl ? (layer.target ? [layer.target] : []) : selectedNodes(canvas);
				const auto = nodes.filter((n) => modeOf(ctx.data.node(n).get()) !== "off");
				if (!auto.length) return;
				sizes = new Map(auto.map((n) => [n, { width: n.width, height: n.height }]));
				for (const n of auto) resizing.add(n);
			};
			const onUp = () => {
				if (!sizes) return;
				const before = sizes;
				sizes = null;
				// Let the core finish the resize first.
				win.setTimeout(() => {
					const changes: [CanvasNodeLike, Mode][] = [];
					for (const [node, size] of before) {
						resizing.delete(node);
						const mode = modeOf(ctx.data.node(node).get());
						if (Math.abs(node.height - size.height) > 1) changes.push([node, "off"]);
						else if (Math.abs(node.width - size.width) > 1 && mode !== "height") changes.push([node, "height"]);
						else schedule(node);
					}
					if (!changes.length) return;
					// Joins the core's pending undo step for the resize.
					try {
						for (const [node, mode] of changes) ctx.data.node(node).set(PATCH[mode]);
					} catch (error) {
						logError("[overpowered-canvas] auto-resize: leaving auto mode after a resize failed", error);
					}
					canvas.menu.render(true);
				});
			};
			canvas.wrapperEl.addEventListener("pointerdown", onDown, true);
			win.addEventListener("pointerup", onUp, true);
			win.addEventListener("pointercancel", onUp, true);
			return () => {
				canvas.wrapperEl.removeEventListener("pointerdown", onDown, true);
				win.removeEventListener("pointerup", onUp, true);
				win.removeEventListener("pointercancel", onUp, true);
			};
		});

		const eligible = (selection: Parameters<typeof onlyNodes>[0]) => textCardsIn(ctx, selection);
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
					[{ columns: 3, items: PICKER_MODES.map((m) => ({ id: m, label: ctx.t(`autoResize.mode.${m}` as I18nKey), icon: ICONS[m], active: now === m })) }],
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

		// New text cards start in the chosen size mode.
		const patched = new WeakSet<object>();
		ctx.onCanvas((canvas) => {
			const proto = Object.getPrototypeOf(canvas) as CanvasLike;
			if (patched.has(proto)) return;
			patched.add(proto);
			ctx.patch("canvas.createTextNode", proto, {
				createTextNode: (next) =>
					function (this: CanvasLike, ...args: Parameters<CanvasLike["createTextNode"]>) {
						const node = next.apply(this, args);
						if (ctx.settings.newCards !== "off" && node && !this.readonly)
							try {
								ctx.data.node(node).set(PATCH[ctx.settings.newCards], { history: false });
							} catch (error) {
								logError("[overpowered-canvas] auto-resize: fitting a new card failed", error);
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
		/**
		 * One-off: the selected text and note cards get the height their text needs, top-left
		 * corner fixed. Cards off screen are drawn first so they can be measured. One undo step.
		 */
		const expandToText = async (canvas: CanvasLike, nodes: CanvasNodeLike[]) => {
			nodes = nodes.filter((n) => nodeType(n) === "text" || nodeType(n) === "file");
			if (!nodes.length || canvas.readonly) return;
			for (const n of nodes) if (!n.isAttached) n.attach();
			for (const n of nodes) n.render();
			const win = canvas.wrapperEl.win;
			const frame = () => new Promise<void>((r) => win.requestAnimationFrame(() => r()));
			const settle = async () => {
				await frame();
				await frame();
				await new Promise<void>((r) => win.setTimeout(r, 80));
			};
			// Markdown renders over a few frames, and the text can reflow once the card is taller:
			// measure and resize until nothing changes, then save it all as one step.
			const original = new Map(nodes.map((n) => [n, n.height]));
			const min = canvas.config.minContainerDimension;
			await settle();
			for (let pass = 0; pass < 4; pass++) {
				let changed = false;
				for (const n of nodes) {
					const target = neededHeight(n);
					if (target === null) continue;
					const height = Math.max(min, Math.round(target));
					if (Math.abs(height - n.height) <= 1) continue;
					n.resize({ width: n.width, height });
					n.render();
					changed = true;
				}
				if (!changed) break;
				await settle();
			}
			const heights = new Map(nodes.map((n) => [n, n.height]));
			for (const [n, h] of original) n.resize({ width: n.width, height: h });
			mutate(ctx, canvas, () => {
				for (const [n, height] of heights) {
					if (height === original.get(n)) continue;
					n.moveAndResize({ x: n.x, y: n.y, width: n.width, height });
					n.render();
				}
			});
			canvas.requestFrame();
		};
		const expandItem = (menu: Menu, canvas: CanvasLike, nodes: CanvasNodeLike[]) => {
			if (canvas.readonly || !nodes.some((n) => nodeType(n) === "text" || nodeType(n) === "file")) return;
			menu.addItem((item) => item.setSection("action").setTitle(ctx.t("autoResize.expand")).setIcon("unfold-vertical").onClick(() => void expandToText(canvas, nodes)));
		};
		ctx.onSelectionMenu((menu, canvas) => expandItem(menu, canvas, selectedNodes(canvas)));
		ctx.onNodeMenu((menu, node) => expandItem(menu, node.canvas, [node]));
		ctx.addCommand({
			id: "expand-to-text",
			name: ctx.t("autoResize.expand"),
			icon: "unfold-vertical",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const nodes = canvas ? selectedNodes(canvas) : [];
				if (!canvas || canvas.readonly || !nodes.length) return false;
				if (!checking) void expandToText(canvas, nodes);
				return true;
			},
		});

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
			.addDropdown((d) =>
				d
					.addOptions(Object.fromEntries(MODES.map((m) => [m, ctx.t(`autoResize.mode.${m}` as I18nKey)])))
					.setValue(ctx.settings.newCards)
					.onChange((v) => ctx.updateSettings({ newCards: v as Mode })),
			);
	},
});
