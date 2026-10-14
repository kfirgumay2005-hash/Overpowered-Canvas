import { defineModule } from "../../core/module";
import { FLOWCHART_SHAPES, SCHEMA_KEY, STANDALONE_SHAPES, type ShapeName } from "../../data/schema";
import { readNode } from "../../data/validate";
import type { I18nKey } from "../../i18n";
import { showPicker } from "../../ui/picker";
import { renderNodeShape, shapePreviewSvg } from "../../ui/shape-renderer";
import { common, mutate, nodeType, onlyNodes } from "../shared";

export const shapeLabelKey = (shape: ShapeName): I18nKey => `shape.${shape}` as I18nKey;

/** Flowchart and basic shapes on regular cards (text, file, link). */
export const nodeShapesModule = defineModule({
	id: "node-shapes",
	name: "nodeShapes.name",
	description: "nodeShapes.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		ctx.decorateNodes({
			apply: (node, extra) => renderNodeShape(node, extra.kind === undefined && extra.shape && nodeType(node) !== "group" ? extra.shape : null),
			clear: (node) => {
				if (readNode(node.unknownData[SCHEMA_KEY]).kind === undefined) renderNodeShape(node, null);
			},
		});

		ctx.addMenuButton({
			id: "shape",
			icon: "shapes",
			tooltip: () => ctx.t("nodeShapes.button"),
			order: 10,
			isVisible: (selection) => {
				const nodes = onlyNodes(selection);
				return !!nodes && nodes.every((n) => nodeType(n) !== "group" && ctx.data.node(n).get().kind === undefined);
			},
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = onlyNodes(selection) ?? [];
				const current = common(nodes, (n) => ctx.data.node(n).get().shape);
				const item = (shape: ShapeName) => ({ id: shape, label: ctx.t(shapeLabelKey(shape)), svg: shapePreviewSvg(shape), active: current === shape });
				showPicker(
					buttonEl,
					[
						{ items: [{ id: "none", label: ctx.t("nodeShapes.none"), icon: "square-dashed", active: current === undefined }], columns: 1 },
						{ title: ctx.t("nodeShapes.flowchart"), items: FLOWCHART_SHAPES.map(item) },
						{ title: ctx.t("nodeShapes.basic"), items: STANDALONE_SHAPES.map(item) },
					],
					(id) =>
						mutate(ctx, canvas, () => {
							for (const node of nodes) ctx.data.node(node).set({ shape: id === "none" ? undefined : (id as ShapeName) });
						}),
				);
			},
		});
	},
});
