import { defineModule } from "../../core/module";
import { BORDER_STYLES, type BorderStyle } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import { showPicker } from "../../ui/picker";
import { common, mutate, onlyNodes } from "../shared";

const preview = (style: BorderStyle) => {
	const dash = style === "dotted" ? "1 3" : style === "dashed" ? "5 3" : "";
	const stroke = style === "none" ? "var(--text-faint)" : "currentColor";
	const opacity = style === "none" ? "0.4" : "1";
	return `<svg viewBox="0 0 22 16" width="22" height="16"><rect x="2" y="2" width="18" height="12" rx="2" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="1.6" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ""}/></svg>`;
};

/** Solid / dotted / dashed / invisible borders on any node, groups included. */
export const nodeBordersModule = defineModule({
	id: "node-borders",
	name: "nodeBorders.name",
	description: "nodeBorders.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		ctx.decorateNodes({
			apply: (node, extra) => {
				if (extra.border) node.nodeEl.setAttribute("data-opc-border", extra.border);
				else node.nodeEl.removeAttribute("data-opc-border");
			},
			clear: (node) => node.nodeEl.removeAttribute("data-opc-border"),
		});

		ctx.addMenuButton({
			id: "border",
			icon: "square-dashed",
			tooltip: () => ctx.t("nodeBorders.button"),
			order: 11,
			isVisible: (selection) => !!onlyNodes(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = onlyNodes(selection) ?? [];
				const current = common(nodes, (n) => ctx.data.node(n).get().border ?? "solid");
				showPicker(
					buttonEl,
					[{ items: BORDER_STYLES.map((style) => ({ id: style, label: ctx.t(`nodeBorders.${style}` as I18nKey), svg: preview(style), active: current === style })), columns: 4 }],
					(id) =>
						mutate(ctx, canvas, () => {
							for (const node of nodes) ctx.data.node(node).set({ border: id as BorderStyle });
						}),
				);
			},
		});
	},
});
