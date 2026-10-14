import { defineModule } from "../../core/module";
import { TEXT_ALIGNS, type TextAlign } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import { showPicker } from "../../ui/picker";
import { canvasDirection, common, mutate, nodeType, onlyNodes } from "../shared";

/** Lucide icon for a logical alignment, mirrored in right-to-left canvases. */
function alignIcon(align: TextAlign, dir: "ltr" | "rtl"): string {
	if (align === "center") return "align-center";
	const left = (align === "start") === (dir === "ltr");
	return left ? "align-left" : "align-right";
}

/** Start / center / end text alignment (logical, so it stays right in RTL). */
export const textAlignModule = defineModule({
	id: "text-align",
	name: "textAlign.name",
	description: "textAlign.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		ctx.decorateNodes({
			apply: (node, extra) => {
				if (extra.align) node.nodeEl.setAttribute("data-opc-align", extra.align);
				else node.nodeEl.removeAttribute("data-opc-align");
			},
			clear: (node) => node.nodeEl.removeAttribute("data-opc-align"),
		});

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
			isVisible: (selection) => {
				const nodes = onlyNodes(selection);
				return !!nodes && nodes.every((n) => nodeType(n) === "text" || nodeType(n) === "file");
			},
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = onlyNodes(selection) ?? [];
				const current = common(nodes, (n) => ctx.data.node(n).get().align ?? "start");
				const dir = canvasDirection(canvas);
				showPicker(
					buttonEl,
					[{ items: TEXT_ALIGNS.map((align) => ({ id: align, label: ctx.t(`textAlign.${align}` as I18nKey), icon: alignIcon(align, dir), active: current === align })), columns: 3 }],
					(id) =>
						mutate(ctx, canvas, () => {
							for (const node of nodes) ctx.data.node(node).set({ align: id as TextAlign });
						}),
				);
			},
		});
	},
});
