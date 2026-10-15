import { defineModule } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mutate, nodeType, randomId } from "../shared";

const SIZE = { width: 160, height: 44 };

/**
 * Free-floating text, like Miro's text tool: a card without background or border that grows
 * with its text (needs "Auto-resize cards" for the growing). Bottom-bar button: click to add one
 * in the middle of the view, or drag it into place.
 */
export const floatingTextModule = defineModule({
	id: "floating-text",
	name: "floatingText.name",
	description: "floatingText.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		ctx.decorateNodes({
			apply: (node, extra) => {
				if (extra.kind === "text" && nodeType(node) === "text") node.nodeEl.setAttribute("data-opc-kind", "text");
				else if (node.nodeEl.getAttribute("data-opc-kind") === "text") node.nodeEl.removeAttribute("data-opc-kind");
			},
			clear: (node) => {
				if (node.nodeEl.getAttribute("data-opc-kind") === "text") node.nodeEl.removeAttribute("data-opc-kind");
			},
		});

		const create = (canvas: CanvasLike, pos: { x: number; y: number }): CanvasNodeLike | null => {
			const id = randomId();
			const ok = mutate(ctx, canvas, () => {
				canvas.importData(
					{ nodes: [{ id, type: "text", text: "", x: Math.round(pos.x), y: Math.round(pos.y), ...SIZE, "x-opc": { kind: "text", autoWidth: true } }], edges: [] },
					false,
				);
			});
			const node = ok ? canvas.nodes.get(id) : undefined;
			if (!node) return null;
			canvas.selectOnly(node);
			window.setTimeout(() => node.startEditing(), 20);
			return node;
		};
		const atCenter = (canvas: CanvasLike) => {
			const v = canvas.getViewportBBox();
			return { x: (v.minX + v.maxX) / 2 - SIZE.width / 2, y: (v.minY + v.maxY) / 2 - SIZE.height / 2 };
		};

		ctx.addCardMenuButton({
			id: "floating-text",
			icon: "type",
			tooltip: () => ctx.t("floatingText.add"),
			order: 95,
			onClick: (canvas) => void create(canvas, atCenter(canvas)),
			drag: { size: () => SIZE, drop: (canvas, pos) => void create(canvas, pos) },
		});
		ctx.addCommand({
			id: "add",
			name: ctx.t("floatingText.add"),
			icon: "type",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) create(canvas, atCenter(canvas));
				return true;
			},
		});
	},
});
