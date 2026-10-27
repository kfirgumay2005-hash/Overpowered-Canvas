/** Pure helpers for ink stuck to cards (unit-tested). */
import type { CanvasNodeData } from "../../data/json-canvas";

interface Box {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Share of a stroke's points that must lie on a card for the stroke to belong to it. */
const ON_CARD = 0.8;

/**
 * The card a stroke is drawn on (pure): the first of `cards` (topmost first) holding most of
 * its points, or null.
 */
export function cardUnder(points: { x: number; y: number }[], cards: Box[]): string | null {
	if (!points.length) return null;
	for (const c of cards) {
		let inside = 0;
		for (const p of points) if (p.x >= c.x && p.x <= c.x + c.width && p.y >= c.y && p.y <= c.y + c.height) inside++;
		if (inside / points.length >= ON_CARD) return c.id;
	}
	return null;
}

/** Node data after a paste or duplicate: card references point at the copies, or are dropped. */
export function remapRefs(nodes: CanvasNodeData[], idMap: Map<string, string>): void {
	for (const n of nodes) {
		const extra = n["x-opc"] as Record<string, unknown> | undefined;
		if (!extra || typeof extra !== "object") continue;
		if (typeof extra.anchor === "string") {
			const to = idMap.get(extra.anchor);
			if (to) extra.anchor = to;
			else delete extra.anchor;
		}
		const line = extra.line as { from?: { node: string }; to?: { node: string } } | undefined;
		if (line && typeof line === "object")
			for (const end of ["from", "to"] as const) {
				const ref = line[end];
				if (!ref || typeof ref.node !== "string") continue;
				const to = idMap.get(ref.node);
				if (to) line[end] = { ...ref, node: to };
				else delete line[end];
			}
	}
}
