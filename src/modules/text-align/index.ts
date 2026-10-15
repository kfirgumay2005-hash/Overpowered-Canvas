import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { TEXT_ALIGNS, VERTICAL_ALIGNS, type OpcNode, type TextAlign, type VerticalAlign } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { showPicker } from "../../ui/picker";
import { canvasDirection, common, mutate, nodeType, onlyNodes, onlyTextBoxes } from "../shared";

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
				const valign = effectiveVAlign(extra);
				// Stickies always carry it: their own CSS centers them when it is absent.
				if ((valign !== "top" || extra.kind === "sticky") && nodeType(node) !== "group") node.nodeEl.setAttribute("data-opc-valign", valign);
				else node.nodeEl.removeAttribute("data-opc-valign");
			},
			clear: (node) => {
				node.nodeEl.removeAttribute("data-opc-align");
				node.nodeEl.removeAttribute("data-opc-valign");
			},
		});

		const eligible = (selection: Parameters<typeof onlyNodes>[0]) => onlyTextBoxes(ctx as ModuleContext<object>, selection);

		ctx.addMenuButton({
			id: "align",
			icon: (selection) => {
				const nodes = onlyNodes(selection) ?? [];
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

		// New cards: center their text when the setting asks for it.
		const centerNew = (node: CanvasNodeLike) => {
			const mode = ctx.settings.newCards;
			if (mode === "off" || !node || nodeType(node) !== "text") return;
			try {
				ctx.data.node(node).set(mode === "both" ? { align: "center", valign: "middle" } : { align: "center" }, { history: false });
			} catch (error) {
				console.error("[overpowered-canvas] text-align: centering a new card failed", error);
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
