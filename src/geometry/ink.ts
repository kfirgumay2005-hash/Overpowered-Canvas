/**
 * Freehand ink geometry (pure, unit-tested): stroke outlines (perfect-freehand), hit testing,
 * partial erasing, lasso selection, transforms and shape recognition.
 */
import { getStroke } from "perfect-freehand";
import type { StrokeTool } from "../data/schema";

export interface InkPoint {
	x: number;
	y: number;
	/** 0–1. */
	p: number;
	tiltX?: number;
	tiltY?: number;
}

export interface BrushPreset {
	thinning: number;
	smoothing: number;
	streamline: number;
	opacity: number;
	/** Pressure from the device, or simulated from speed. */
	simulatePressure: boolean;
	/** How much stylus tilt widens the stroke (pencil shading). */
	tiltWidth: number;
}

export const BRUSHES: Record<StrokeTool, BrushPreset> = {
	pen: { thinning: 0.6, smoothing: 0.5, streamline: 0.5, opacity: 1, simulatePressure: false, tiltWidth: 0.2 },
	pencil: { thinning: 0.75, smoothing: 0.3, streamline: 0.3, opacity: 0.85, simulatePressure: false, tiltWidth: 1.5 },
	marker: { thinning: 0, smoothing: 0.6, streamline: 0.6, opacity: 1, simulatePressure: false, tiltWidth: 0 },
	highlighter: { thinning: 0, smoothing: 0.7, streamline: 0.7, opacity: 0.35, simulatePressure: false, tiltWidth: 0 },
};

/** Flat [x, y, p, …] → points. */
export function unpack(pts: number[], tilt?: number[]): InkPoint[] {
	const out: InkPoint[] = [];
	for (let i = 0, k = 0; i + 2 < pts.length; i += 3, k += 2) {
		const point: InkPoint = { x: pts[i]!, y: pts[i + 1]!, p: pts[i + 2]! };
		if (tilt && tilt.length > k + 1) {
			point.tiltX = tilt[k]!;
			point.tiltY = tilt[k + 1]!;
		}
		out.push(point);
	}
	return out;
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

/** Points → flat arrays (rounded to keep files small). */
export function pack(points: InkPoint[]): { pts: number[]; tilt?: number[] } {
	const pts: number[] = [];
	const tilt: number[] = [];
	let hasTilt = false;
	for (const p of points) {
		pts.push(round(p.x), round(p.y), round(Math.min(1, Math.max(0, p.p)), 2));
		tilt.push(round(p.tiltX ?? 0, 0), round(p.tiltY ?? 0, 0));
		if (p.tiltX || p.tiltY) hasTilt = true;
	}
	return hasTilt ? { pts, tilt } : { pts };
}

/** Effective pressure: device pressure, widened by tilt for brushes that shade. */
function pressure(p: InkPoint, brush: BrushPreset): number {
	const t = Math.min(1, Math.hypot(p.tiltX ?? 0, p.tiltY ?? 0) / 90);
	return Math.min(1, Math.max(0.05, p.p * (1 + t * brush.tiltWidth)));
}

/** SVG path of the filled stroke outline. */
export function strokePath(points: InkPoint[], tool: StrokeTool, size: number, smoothing?: number): string {
	const brush = BRUSHES[tool];
	const allSame = points.every((p) => p.p === points[0]?.p);
	const outline = getStroke(
		points.map((p) => [p.x, p.y, pressure(p, brush)]),
		{
			size,
			thinning: brush.thinning,
			smoothing: smoothing ?? brush.smoothing,
			streamline: brush.streamline,
			// Mice report a constant 0.5: simulate pressure from speed then.
			simulatePressure: brush.simulatePressure || (allSame && brush.thinning > 0),
			last: true,
		},
	);
	if (outline.length < 2) return "";
	let d = `M${round(outline[0]![0])} ${round(outline[0]![1])}`;
	for (let i = 1; i < outline.length; i++) {
		const [x0, y0] = outline[i - 1]!;
		const [x1, y1] = outline[i]!;
		d += ` Q${round(x0)} ${round(y0)} ${round((x0 + x1) / 2)} ${round((y0 + y1) / 2)}`;
	}
	return `${d} Z`;
}

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function bounds(points: { x: number; y: number }[], pad = 0): Bounds {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of points) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
	return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Distance from a point to the stroke's center line. */
export function distanceToStroke(p: { x: number; y: number }, points: InkPoint[]): number {
	if (points.length === 1) return Math.hypot(p.x - points[0]!.x, p.y - points[0]!.y);
	let best = Infinity;
	for (let i = 1; i < points.length; i++) best = Math.min(best, segDist(p, points[i - 1]!, points[i]!));
	return best;
}

/** Whether an eraser circle touches the stroke (stroke half-width included). */
export function hitsStroke(p: { x: number; y: number }, radius: number, points: InkPoint[], size: number): boolean {
	return distanceToStroke(p, points) <= radius + size / 2;
}

/**
 * Partial erase: removes the points inside the eraser circle and returns the remaining runs
 * (each with at least two points). An untouched stroke comes back as one run.
 */
export function eraseFrom(points: InkPoint[], p: { x: number; y: number }, radius: number): InkPoint[][] {
	const runs: InkPoint[][] = [];
	let run: InkPoint[] = [];
	for (const q of points) {
		if (Math.hypot(q.x - p.x, q.y - p.y) <= radius) {
			if (run.length >= 2) runs.push(run);
			run = [];
		} else run.push(q);
	}
	if (run.length >= 2) runs.push(run);
	return runs;
}

/** Even-odd point-in-polygon test. */
export function inPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i]!;
		const b = poly[j]!;
		if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}

/** A stroke is lassoed when most of its points are inside the lasso. */
export function lassoed(points: { x: number; y: number }[], lasso: { x: number; y: number }[], share = 0.6): boolean {
	if (lasso.length < 3 || points.length === 0) return false;
	const inside = points.filter((p) => inPolygon(p, lasso)).length;
	return inside / points.length >= share;
}

/** Moves and scales points: scale around `origin`, then translate. */
export function transform<T extends { x: number; y: number }>(points: T[], dx: number, dy: number, scale = 1, origin = { x: 0, y: 0 }): T[] {
	return points.map((p) => ({ ...p, x: origin.x + (p.x - origin.x) * scale + dx, y: origin.y + (p.y - origin.y) * scale + dy }));
}

// ---------- shape recognition ----------

export type RecognizedShape =
	| { kind: "ellipse"; box: Bounds }
	| { kind: "rectangle"; box: Bounds }
	| { kind: "triangle"; box: Bounds }
	| { kind: "line"; from: { x: number; y: number }; to: { x: number; y: number } }
	| { kind: "arrow"; from: { x: number; y: number }; to: { x: number; y: number } };

/** Ramer–Douglas–Peucker simplification. */
export function simplifyPath(points: { x: number; y: number }[], epsilon: number): { x: number; y: number }[] {
	if (points.length < 3) return points.slice();
	let maxDist = 0;
	let index = 0;
	const first = points[0]!;
	const last = points[points.length - 1]!;
	for (let i = 1; i < points.length - 1; i++) {
		const d = segDist(points[i]!, first, last);
		if (d > maxDist) {
			maxDist = d;
			index = i;
		}
	}
	if (maxDist <= epsilon) return [first, last];
	const left = simplifyPath(points.slice(0, index + 1), epsilon);
	const right = simplifyPath(points.slice(index), epsilon);
	return [...left.slice(0, -1), ...right];
}

function pathLength(points: { x: number; y: number }[]): number {
	let len = 0;
	for (let i = 1; i < points.length; i++) len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
	return len;
}

/** Recognizes a rough circle/ellipse, rectangle, triangle, line or arrow; null when unsure. */
export function recognize(points: { x: number; y: number }[]): RecognizedShape | null {
	if (points.length < 4) return null;
	const box = bounds(points);
	const w = box.maxX - box.minX;
	const h = box.maxY - box.minY;
	const size = Math.max(w, h);
	if (size < 12) return null;
	const length = pathLength(points);
	const first = points[0]!;
	const last = points[points.length - 1]!;
	const gap = Math.hypot(last.x - first.x, last.y - first.y);
	const closed = gap < Math.max(20, length * 0.15);

	if (!closed) {
		const simple = simplifyPath(points, size * 0.06);
		if (simple.length === 2 || pathLength(simple) / Math.hypot(last.x - first.x, last.y - first.y) < 1.08) return { kind: "line", from: first, to: last };
		// Shaft plus an arrowhead hook: a long first segment, then a short V at the end.
		const coarse = simplifyPath(points, size * 0.1);
		if (coarse.length >= 3 && coarse.length <= 5) {
			const shaftEnd = coarse[1]!;
			const shaft = Math.hypot(shaftEnd.x - first.x, shaftEnd.y - first.y);
			const rest = pathLength(coarse.slice(1));
			if (shaft > rest * 1.5 && shaft > size * 0.5) return { kind: "arrow", from: first, to: shaftEnd };
		}
		return null;
	}

	// Closed: corners from the simplified outline (dropping the duplicated closing point).
	const simple = simplifyPath([...points, first], size * 0.12);
	let corners = simple.slice(0, -1);
	if (corners.length > 1 && Math.hypot(corners[0]!.x - corners[corners.length - 1]!.x, corners[0]!.y - corners[corners.length - 1]!.y) < size * 0.15) corners = corners.slice(0, -1);
	// Circularity: spread of distances to the center relative to the ellipse.
	const cx = (box.minX + box.maxX) / 2;
	const cy = (box.minY + box.maxY) / 2;
	const devs = points.map((p) => Math.abs(Math.hypot((p.x - cx) / (w / 2 || 1), (p.y - cy) / (h / 2 || 1)) - 1));
	const meanDev = devs.reduce((a, b) => a + b, 0) / devs.length;
	if (corners.length === 3) return { kind: "triangle", box };
	if (corners.length === 4 && meanDev > 0.08) return { kind: "rectangle", box };
	if (meanDev < 0.18) return { kind: "ellipse", box };
	if (corners.length === 4 || corners.length === 5) return { kind: "rectangle", box };
	return null;
}
