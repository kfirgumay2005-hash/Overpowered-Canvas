/**
 * What a lasso catches (pure): cards whose middle is inside it, groups that are entirely inside,
 * edges whose middle is inside (or whose two cards are both caught), and the ink strokes that
 * are mostly inside.
 */
import type { EdgeSide } from "../../data/json-canvas";
import { inPolygon } from "../../geometry/ink";

export interface P {
	x: number;
	y: number;
}

export interface LassoBox {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	group?: boolean;
}

export interface LassoEdge {
	id: string;
	from: string;
	fromSide: EdgeSide;
	to: string;
	toSide: EdgeSide;
}

export function sidePoint(n: LassoBox, side: EdgeSide): P {
	if (side === "left") return { x: n.x, y: n.y + n.height / 2 };
	if (side === "right") return { x: n.x + n.width, y: n.y + n.height / 2 };
	if (side === "top") return { x: n.x + n.width / 2, y: n.y };
	return { x: n.x + n.width / 2, y: n.y + n.height };
}

export function caught(lasso: P[], nodes: LassoBox[], edges: LassoEdge[]): { nodes: Set<string>; edges: Set<string> } {
	const outNodes = new Set<string>();
	const outEdges = new Set<string>();
	if (lasso.length < 3) return { nodes: outNodes, edges: outEdges };
	for (const n of nodes) {
		const corners = [
			{ x: n.x, y: n.y },
			{ x: n.x + n.width, y: n.y },
			{ x: n.x, y: n.y + n.height },
			{ x: n.x + n.width, y: n.y + n.height },
		];
		const hit = n.group ? corners.every((c) => inPolygon(c, lasso)) : inPolygon({ x: n.x + n.width / 2, y: n.y + n.height / 2 }, lasso);
		if (hit) outNodes.add(n.id);
	}
	const byId = new Map(nodes.map((n) => [n.id, n]));
	for (const e of edges) {
		const a = byId.get(e.from);
		const b = byId.get(e.to);
		if (!a || !b) continue;
		const pa = sidePoint(a, e.fromSide);
		const pb = sidePoint(b, e.toSide);
		if ((outNodes.has(e.from) && outNodes.has(e.to)) || inPolygon({ x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }, lasso)) outEdges.add(e.id);
	}
	return { nodes: outNodes, edges: outEdges };
}
