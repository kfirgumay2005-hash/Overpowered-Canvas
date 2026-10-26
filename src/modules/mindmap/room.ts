import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { canvasDirection } from "../shared";
import { childrenOf, descendants, siblingSlot, type TEdge } from "./tree";

export const edgesOf = (canvas: CanvasLike): TEdge[] => [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id }));

/**
 * Where a new sibling right after `node` goes; the later siblings (and their branches) move
 * along to make room. Call inside a history transaction.
 */
export function makeSiblingRoom(canvas: CanvasLike, parent: CanvasNodeLike, node: CanvasNodeLike, size: { width: number; height: number }): { x: number; y: number } {
	const edges = edgesOf(canvas);
	const kids = childrenOf(edges, parent.id).map((id) => canvas.nodes.get(id)).filter((n): n is CanvasNodeLike => !!n);
	const slot = siblingSlot(parent, node, kids, size, canvasDirection(canvas) === "rtl");
	if (slot.shift.x || slot.shift.y) {
		const moving = new Set(slot.later.flatMap((id) => [id, ...descendants(edges, id)]));
		for (const id of moving) {
			const n = canvas.nodes.get(id);
			if (n) n.moveTo({ x: n.x + slot.shift.x, y: n.y + slot.shift.y });
		}
	}
	return slot.pos;
}
