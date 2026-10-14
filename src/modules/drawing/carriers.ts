/**
 * Ink carriers: text cards (kind "ink") that hold strokes in x-opc.strokes, with points relative
 * to the card. Pure helpers (unit-tested) plus the canvas operations used by the drawing module.
 */
import type { Stroke } from "../../data/schema";
import { bounds, pack, unpack, type Bounds, type InkPoint } from "../../geometry/ink";

export const CARRIER_TEXT = "✏️";
export const CARRIER_PAD = 12;

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Bounds of a stroke in canvas coordinates, given its carrier's origin. */
export function strokeBounds(s: Stroke, origin: { x: number; y: number }): Bounds {
	const b = bounds(unpack(s.pts).map((p) => ({ x: p.x + origin.x, y: p.y + origin.y })), s.size / 2);
	return b;
}

/**
 * Re-fits a carrier around its strokes: returns the new box and strokes with points relative
 * to it (the canvas positions of all strokes stay the same).
 */
export function refit(strokes: Stroke[], origin: { x: number; y: number }): { box: Box; strokes: Stroke[] } | null {
	if (strokes.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const s of strokes) {
		const b = strokeBounds(s, origin);
		minX = Math.min(minX, b.minX);
		minY = Math.min(minY, b.minY);
		maxX = Math.max(maxX, b.maxX);
		maxY = Math.max(maxY, b.maxY);
	}
	const x = Math.floor(minX - CARRIER_PAD);
	const y = Math.floor(minY - CARRIER_PAD);
	const box = { x, y, width: Math.ceil(maxX + CARRIER_PAD - x), height: Math.ceil(maxY + CARRIER_PAD - y) };
	const dx = origin.x - x;
	const dy = origin.y - y;
	return { box, strokes: dx === 0 && dy === 0 ? strokes : strokes.map((s) => shiftStroke(s, dx, dy)) };
}

export function shiftStroke(s: Stroke, dx: number, dy: number): Stroke {
	const pts = s.pts.slice();
	for (let i = 0; i + 2 < pts.length; i += 3) {
		pts[i] = Math.round((pts[i]! + dx) * 10) / 10;
		pts[i + 1] = Math.round((pts[i + 1]! + dy) * 10) / 10;
	}
	return { ...s, pts };
}

/** A stroke from absolute canvas points, relative to `origin`. */
export function makeStroke(id: string, points: InkPoint[], origin: { x: number; y: number }, style: Pick<Stroke, "tool" | "color" | "size" | "smoothing">): Stroke {
	const rel = points.map((p) => ({ ...p, x: p.x - origin.x, y: p.y - origin.y }));
	const packed = pack(rel);
	return { id, tool: style.tool, color: style.color, size: style.size, ...(style.smoothing !== undefined ? { smoothing: style.smoothing } : {}), ...packed };
}

/** Absolute points of a stored stroke. */
export function absolutePoints(s: Stroke, origin: { x: number; y: number }): InkPoint[] {
	return unpack(s.pts, s.tilt).map((p) => ({ ...p, x: p.x + origin.x, y: p.y + origin.y }));
}
