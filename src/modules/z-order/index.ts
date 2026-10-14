import { defineModule } from "../../core/module";
import type { I18nKey } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mutate, nodeType, selectedNodes } from "../shared";
import { reorder, type ZOperation } from "./order";

const OPS: { op: ZOperation; icon: string; key: I18nKey }[] = [
	{ op: "front", icon: "bring-to-front", key: "zOrder.front" },
	{ op: "forward", icon: "arrow-up-narrow-wide", key: "zOrder.forward" },
	{ op: "backward", icon: "arrow-down-wide-narrow", key: "zOrder.backward" },
	{ op: "back", icon: "send-to-back", key: "zOrder.back" },
];

/** Applies a z-order operation to the selected non-group nodes (groups are always ordered by area). */
function applyOrder(canvas: CanvasLike, op: ZOperation): boolean {
	const targets = selectedNodes(canvas).filter((n) => nodeType(n) !== "group");
	if (targets.length === 0) return false;
	const nodes = [...canvas.nodes.values()].filter((n) => nodeType(n) !== "group");
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const overlapping = (id: string) => {
		const node = byId.get(id);
		return new Set(node ? canvas.getIntersectingNodes(node.getBBox()).map((n) => n.id) : []);
	};
	const changes = reorder(
		nodes.map((n) => ({ id: n.id, z: n.zIndex })),
		new Set(targets.map((n) => n.id)),
		op,
		overlapping,
	);
	for (const [id, z] of changes) {
		const node = byId.get(id) as CanvasNodeLike;
		node.zIndex = z;
		node.renderZIndex();
	}
	const maxZ = Math.max(canvas.zIndexCounter, ...[...changes.values()]);
	canvas.zIndexCounter = maxZ;
	return changes.size > 0;
}

/** Bring to front / forward, send backward / to back — from the context menu and commands. */
export const zOrderModule = defineModule({
	id: "z-order",
	name: "zOrder.name",
	description: "zOrder.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const run = (canvas: CanvasLike, op: ZOperation) =>
			mutate(ctx, canvas, () => {
				// The z-index is part of the saved node order, so the transaction snapshot records it.
				applyOrder(canvas, op);
			});

		for (const { op, icon, key } of OPS) {
			ctx.addCommand({
				id: `z-${op}`,
				name: ctx.t(key),
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || canvas.readonly || selectedNodes(canvas).length === 0) return false;
					if (!checking) run(canvas, op);
					return true;
				},
			});
		}

		const addItems = (menu: import("obsidian").Menu, canvas: CanvasLike) => {
			if (canvas.readonly || selectedNodes(canvas).every((n) => nodeType(n) === "group")) return;
			for (const { op, icon, key } of OPS) menu.addItem((item) => item.setSection("opc-arrange").setTitle(ctx.t(key)).setIcon(icon).onClick(() => run(canvas, op)));
		};
		ctx.onNodeMenu((menu, node) => addItems(menu, node.canvas));
		ctx.onSelectionMenu((menu, canvas) => addItems(menu, canvas));
	},
});
