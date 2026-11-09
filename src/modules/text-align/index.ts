import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { CARD_FONT_MAX, CARD_FONT_MIN, TEXT_ALIGNS, VERTICAL_ALIGNS, type OpcNode, type TextAlign, type VerticalAlign } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { NumberPromptModal } from "../../ui/number-prompt";
import { showPicker } from "../../ui/picker";
import { canvasDirection, common, mutate, nodeType, onlyNodes, selectedNodes, textCardsIn } from "../shared";
import { logError } from "../../core/log";

interface TextAlignSettings {
	/** Center the text of every new card: not at all, horizontally, or horizontally and vertically. */
	newCards: "off" | "horizontal" | "both";
}

const DEFAULTS: TextAlignSettings = { newCards: "off" };
const NEW_CARDS = ["off", "horizontal", "both"] as const;
const V_ICONS: Record<VerticalAlign, string> = { top: "align-vertical-justify-start", middle: "align-vertical-justify-center", bottom: "align-vertical-justify-end" };

/** Lucide icon for a logical alignment, mirrored in right-to-left canvases. */
function alignIcon(align: TextAlign, dir: "ltr" | "rtl"): string {
	if (align === "center") return "align-center";
	const left = (align === "start") === (dir === "ltr");
	return left ? "align-left" : "align-right";
}

/** Text sizes offered in the picker (pixels). */
export const CARD_FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
/** Pixels added or taken away by "bigger" and "smaller". */
const FONT_STEP = 2;

/** The next size up or down from `now`: the preset after it, or a step beyond the last one. */
export function stepCardFont(now: number, direction: 1 | -1): number {
	const next = direction > 0 ? CARD_FONT_SIZES.find((s) => s > now + 0.5) : [...CARD_FONT_SIZES].reverse().find((s) => s < now - 0.5);
	return Math.min(CARD_FONT_MAX, Math.max(CARD_FONT_MIN, next ?? Math.round(now + direction * FONT_STEP)));
}

/** A picker preview: the size written as a number. */
function sizeSvg(size: number): SVGElement {
	const svg = createSvg("svg", { attr: { viewBox: "0 0 28 20", width: "28", height: "20" } });
	const text = svg.createSvg("text", { attr: { x: "14", y: "15", "text-anchor": "middle", "font-size": "13", fill: "currentColor" } });
	text.textContent = String(size);
	return svg;
}

/** Vertical position when none is stored: stickies are centered, other cards start at the top. */
export function effectiveVAlign(extra: Readonly<OpcNode>): VerticalAlign {
	return extra.valign ?? (extra.kind === "sticky" ? "middle" : "top");
}

/**
 * Text alignment: start / center / end (logical, so it stays right in RTL) and top / middle /
 * bottom, in reading and editing mode. New cards can be centered automatically.
 */
export const textAlignModule = defineModule<TextAlignSettings>({
	id: "text-align",
	name: "textAlign.name",
	description: "textAlign.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: DEFAULTS,
	overlapsWith: ["advanced-canvas"],
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return { newCards: NEW_CARDS.includes(s.newCards) ? s.newCards : defaults.newCards };
	},

	enable(ctx) {
		ctx.decorateNodes({
			apply: (node, extra) => {
				if (extra.align) node.nodeEl.setAttribute("data-opc-align", extra.align);
				else node.nodeEl.removeAttribute("data-opc-align");
				// Its own text size: on the card, in its editor and wherever it is shown like the board.
				if (extra.fontSize && nodeType(node) !== "group") {
					node.nodeEl.setAttribute("data-opc-font-size", String(extra.fontSize));
					node.nodeEl.setCssProps({ "--opc-card-font-size": `${extra.fontSize}px` });
				} else {
					node.nodeEl.removeAttribute("data-opc-font-size");
					node.nodeEl.setCssProps({ "--opc-card-font-size": "" });
				}
				// Text in a handwriting style (the editor's iframe mirrors the attribute too).
				if (extra.font && nodeType(node) !== "group") node.nodeEl.setAttribute("data-opc-font", extra.font);
				else node.nodeEl.removeAttribute("data-opc-font");
				const valign = effectiveVAlign(extra);
				// Stickies always carry it: their own CSS centers them when it is absent.
				if ((valign !== "top" || extra.kind === "sticky") && nodeType(node) !== "group") node.nodeEl.setAttribute("data-opc-valign", valign);
				else node.nodeEl.removeAttribute("data-opc-valign");
			},
			clear: (node) => {
				node.nodeEl.removeAttribute("data-opc-align");
				node.nodeEl.removeAttribute("data-opc-valign");
				node.nodeEl.removeAttribute("data-opc-font-size");
				node.nodeEl.removeAttribute("data-opc-font");
				node.nodeEl.setCssProps({ "--opc-card-font-size": "" });
			},
		});

		const eligible = (selection: Parameters<typeof onlyNodes>[0]) => textCardsIn(ctx, selection);

		ctx.addMenuButton({
			id: "align",
			icon: (selection) => {
				const nodes = eligible(selection) ?? [];
				const current = common(nodes, (n) => ctx.data.node(n).get().align ?? "start") ?? "start";
				const first = nodes[0];
				return alignIcon(current, first ? canvasDirection(first.canvas) : "ltr");
			},
			tooltip: () => ctx.t("textAlign.button"),
			order: 12,
			isVisible: (selection) => !!eligible(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = eligible(selection) ?? [];
				const current = common(nodes, (n) => ctx.data.node(n).get().align ?? "start");
				const currentV = common(nodes, (n) => effectiveVAlign(ctx.data.node(n).get()));
				const dir = canvasDirection(canvas);
				showPicker(
					buttonEl,
					[
						{ title: ctx.t("textAlign.horizontal"), items: TEXT_ALIGNS.map((align) => ({ id: align, label: ctx.t(`textAlign.${align}` as I18nKey), icon: alignIcon(align, dir), active: current === align })), columns: 3 },
						{ title: ctx.t("textAlign.vertical"), items: VERTICAL_ALIGNS.map((v) => ({ id: `v:${v}`, label: ctx.t(`textAlign.v.${v}` as I18nKey), icon: V_ICONS[v], active: currentV === v })), columns: 3 },
					],
					(id) =>
						mutate(ctx, canvas, () => {
							for (const node of nodes)
								ctx.data.node(node).set(id.startsWith("v:") ? { valign: id.slice(2) as VerticalAlign } : { align: id as TextAlign });
						}),
				);
			},
		});

		// ---- Text size of cards ----------------------------------------------------------------

		/** The size a card's text shows at: its own, else the canvas's. */
		const sizeOf = (node: CanvasNodeLike): number => {
			const own = ctx.data.node(node).get().fontSize;
			if (own) return own;
			const view = node.contentEl?.querySelector<HTMLElement>(".markdown-preview-view");
			const shown = view?.isConnected ? Number.parseFloat(getComputedStyle(view).fontSize) : Number.NaN;
			if (shown > 0) return Math.round(shown);
			const base = Number.parseFloat(getComputedStyle(node.canvas.wrapperEl).getPropertyValue("--font-text-size"));
			return base > 0 ? Math.round(base) : 16;
		};
		/** Handwriting style on or off for these cards (on, unless all of them have it already). */
		const toggleHand = (canvas: CanvasLike, nodes: CanvasNodeLike[], on = !nodes.every((n) => ctx.data.node(n).get().font === "hand")) =>
			mutate(ctx, canvas, () => {
				for (const node of nodes) ctx.data.node(node).set({ font: on ? "hand" : undefined });
			});
		const setSize = (canvas: CanvasLike, nodes: CanvasNodeLike[], size: (node: CanvasNodeLike) => number | undefined) =>
			mutate(ctx, canvas, () => {
				for (const node of nodes) ctx.data.node(node).set({ fontSize: size(node) });
			});
		const askSize = (canvas: CanvasLike, nodes: CanvasNodeLike[]) =>
			new NumberPromptModal(
				ctx.app,
				ctx.t,
				{ title: ctx.t("textAlign.size.set"), help: ctx.t("textAlign.size.prompt"), value: common(nodes, (n) => ctx.data.node(n).get().fontSize) ?? undefined, min: CARD_FONT_MIN, max: CARD_FONT_MAX, step: 1 },
				(v) => setSize(canvas, nodes, () => v),
			).open();

		ctx.addMenuButton({
			id: "font-size",
			icon: "a-large-small",
			tooltip: () => ctx.t("textAlign.size.button"),
			order: 13,
			command: false,
			isVisible: (selection) => !!eligible(selection),
			isActive: (selection) => (eligible(selection) ?? []).some((n) => !!ctx.data.node(n).get().fontSize || !!ctx.data.node(n).get().font),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = eligible(selection) ?? [];
				const current = common(nodes, (n) => ctx.data.node(n).get().fontSize);
				showPicker(
					buttonEl,
					[
						{ title: ctx.t("textAlign.size.title"), items: CARD_FONT_SIZES.map((size) => ({ id: String(size), label: `${size} px`, svg: sizeSvg(size), active: current === size })), columns: 5 },
						{
							items: [
								{ id: "smaller", label: ctx.t("textAlign.size.smaller"), icon: "a-arrow-down" },
								{ id: "bigger", label: ctx.t("textAlign.size.bigger"), icon: "a-arrow-up" },
								{ id: "custom", label: ctx.t("textAlign.size.set"), icon: "pencil" },
								{ id: "reset", label: ctx.t("textAlign.size.reset"), icon: "rotate-ccw", active: current === undefined },
							],
							columns: 4,
						},
						{
							title: ctx.t("textAlign.font.title"),
							items: [
								{ id: "font:normal", label: ctx.t("textAlign.font.normal"), icon: "type", active: nodes.every((n) => !ctx.data.node(n).get().font) },
								{ id: "font:hand", label: ctx.t("textAlign.font.hand"), icon: "signature", active: nodes.every((n) => ctx.data.node(n).get().font === "hand") },
							],
							columns: 2,
						},
					],
					(id) => {
						if (id.startsWith("font:")) return toggleHand(canvas, nodes, id === "font:hand");
						if (id === "custom") return askSize(canvas, nodes);
						if (id === "reset") return setSize(canvas, nodes, () => undefined);
						if (id === "smaller" || id === "bigger") return setSize(canvas, nodes, (n) => stepCardFont(sizeOf(n), id === "bigger" ? 1 : -1));
						setSize(canvas, nodes, () => Number(id));
					},
				);
			},
		});
		const sizeCommand = (id: string, name: string, icon: string, run: (canvas: CanvasLike, nodes: CanvasNodeLike[]) => void) =>
			ctx.addCommand({
				id,
				name,
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					const nodes = canvas ? (eligible(selectedNodes(canvas)) ?? []) : [];
					if (!canvas || canvas.readonly || !nodes.length) return false;
					if (!checking) run(canvas, nodes);
					return true;
				},
			});
		sizeCommand("font-size-set", ctx.t("textAlign.size.set"), "a-large-small", askSize);
		sizeCommand("font-size-bigger", ctx.t("textAlign.size.bigger"), "a-arrow-up", (c, nodes) => setSize(c, nodes, (n) => stepCardFont(sizeOf(n), 1)));
		sizeCommand("font-size-smaller", ctx.t("textAlign.size.smaller"), "a-arrow-down", (c, nodes) => setSize(c, nodes, (n) => stepCardFont(sizeOf(n), -1)));
		sizeCommand("font-size-reset", ctx.t("textAlign.size.reset"), "rotate-ccw", (c, nodes) => setSize(c, nodes, () => undefined));
		sizeCommand("font-hand", ctx.t("textAlign.font.toggle"), "signature", (c, nodes) => toggleHand(c, nodes));

		// New cards: center their text when the setting asks for it.
		const centerNew = (node: CanvasNodeLike) => {
			const mode = ctx.settings.newCards;
			if (mode === "off" || !node || nodeType(node) !== "text") return;
			try {
				ctx.data.node(node).set(mode === "both" ? { align: "center", valign: "middle" } : { align: "center" }, { history: false });
			} catch (error) {
				logError("[overpowered-canvas] text-align: centering a new card failed", error);
			}
		};
		const patched = new WeakSet<object>();
		ctx.onCanvas((canvas) => {
			const proto = Object.getPrototypeOf(canvas) as CanvasLike;
			if (patched.has(proto)) return;
			patched.add(proto);
			ctx.patch("canvas.createTextNode", proto, {
				createTextNode: (next) =>
					function (this: CanvasLike, ...args: Parameters<CanvasLike["createTextNode"]>) {
						const node = next.apply(this, args);
						centerNew(node);
						return node;
					},
			});
		});
	},

	renderSettings(el, ctx: ModuleContext<TextAlignSettings>) {
		new Setting(el)
			.setName(ctx.t("textAlign.newCards.name"))
			.setDesc(ctx.t("textAlign.newCards.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ off: ctx.t("textAlign.newCards.off"), horizontal: ctx.t("textAlign.newCards.horizontal"), both: ctx.t("textAlign.newCards.both") })
					.setValue(ctx.settings.newCards)
					.onChange((v) => ctx.updateSettings({ newCards: v as TextAlignSettings["newCards"] })),
			);
	},
});
