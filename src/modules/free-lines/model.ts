/**
 * Free lines and arrows (kind "line"): text cards whose x-opc.line holds the polyline relative
 * to the card. Ends can attach to other cards; the card's box always wraps the line. Pure.
 */
import type { CanvasNodeData } from "../../data/json-canvas";
import type { ArrowStyle, LineData, Point } from "../../data/schema";
import { simplifyPath } from "../../geometry/ink";

export const LINE_PAD = 16;

export interface P {
	x: number;
	y: number;
}

export interface LineStyle {
	color?: string;
	strokeWidth?: number;
	startArrow?: ArrowStyle;
	endArrow?: ArrowStyle;
}

/** Box around absolute points, and the points relative to it. */
export function fitLine(points: P[]): { box: { x: number; y: number; width: number; height: number }; rel: Point[] } {
	const minX = Math.min(...points.map((p) => p.x)) - LINE_PAD;
	const minY = Math.min(...points.map((p) => p.y)) - LINE_PAD;
	const maxX = Math.max(...points.map((p) => p.x)) + LINE_PAD;
	const maxY = Math.max(...points.map((p) => p.y)) + LINE_PAD;
	const x = Math.floor(minX);
	const y = Math.floor(minY);
	return {
		box: { x, y, width: Math.ceil(maxX - x), height: Math.ceil(maxY - y) },
		rel: points.map((p) => [Math.round((p.x - x) * 10) / 10, Math.round((p.y - y) * 10) / 10]),
	};
}

export function lineNodeData(id: string, points: P[], attach: { from?: string; to?: string }, style: LineStyle): CanvasNodeData {
	const { box, rel } = fitLine(points);
	const line: LineData = { points: rel };
	if (attach.from) line.from = { node: attach.from };
	if (attach.to) line.to = { node: attach.to };
	if (style.startArrow) line.startArrow = style.startArrow;
	if (style.endArrow) line.endArrow = style.endArrow;
	return {
		id,
		type: "text",
		text: "",
		...box,
		// The standard color field, so the core color picker recolors lines.
		...(style.color ? { color: style.color } : {}),
		"x-opc": { kind: "line", line, ...(style.strokeWidth ? { strokeWidth: style.strokeWidth } : {}) },
	};
}

/** Absolute points of a stored line. */
export function absoluteLine(line: LineData, origin: P): P[] {
	return line.points.map(([x, y]) => ({ x: x + origin.x, y: y + origin.y }));
}

/** Point on the border of `box` along the ray from its center toward `toward`. */
export function borderPoint(box: { x: number; y: number; width: number; height: number }, toward: P): P {
	const cx = box.x + box.width / 2;
	const cy = box.y + box.height / 2;
	const dx = toward.x - cx;
	const dy = toward.y - cy;
	if (dx === 0 && dy === 0) return { x: cx, y: cy };
	const sx = dx === 0 ? Infinity : box.width / 2 / Math.abs(dx);
	const sy = dy === 0 ? Infinity : box.height / 2 / Math.abs(dy);
	const s = Math.min(sx, sy);
	return { x: cx + dx * s, y: cy + dy * s };
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Where a bent line meets a card: straight across from its neighboring corner when that corner
 * faces a side of the card (so square routes stay square), else toward the card's center.
 */
function bentEnd(box: Box, toward: P): P {
	if (toward.x >= box.x && toward.x <= box.x + box.width && (toward.y < box.y || toward.y > box.y + box.height)) return { x: toward.x, y: toward.y < box.y ? box.y : box.y + box.height };
	if (toward.y >= box.y && toward.y <= box.y + box.height && (toward.x < box.x || toward.x > box.x + box.width)) return { x: toward.x < box.x ? box.x : box.x + box.width, y: toward.y };
	return borderPoint(box, toward);
}

/** Moves attached ends onto the border of their cards, toward the neighboring point. */
export function snapEnds(points: P[], from?: Box | null, to?: Box | null): P[] {
	if (points.length < 2) return points;
	const out = points.slice();
	const end = out.length > 2 ? bentEnd : borderPoint;
	if (from) out[0] = end(from, out[1]!);
	if (to) out[out.length - 1] = end(to, out[out.length - 2]!);
	return out;
}

/** Within this angle of horizontal or vertical, a drawn segment is made exactly straight. */
const SQUARE = (12 * Math.PI) / 180;

function axisOf(a: P, b: P): "h" | "v" | null {
	const angle = Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x));
	return angle <= SQUARE ? "h" : angle >= Math.PI / 2 - SQUARE ? "v" : null;
}

/** Nearly horizontal or vertical segments of a bent line become exactly so (the corners move, not the ends). */
export function squareCorners(points: P[]): P[] {
	const out = points.map((p) => ({ ...p }));
	const n = out.length;
	if (n < 3) return out;
	for (let i = 1; i < n - 1; i++) {
		const axis = axisOf(out[i - 1]!, out[i]!);
		if (axis === "h") out[i]!.y = out[i - 1]!.y;
		else if (axis === "v") out[i]!.x = out[i - 1]!.x;
	}
	// The last segment: align its corner with the end.
	const axis = axisOf(out[n - 2]!, out[n - 1]!);
	if (axis === "h") out[n - 2]!.y = out[n - 1]!.y;
	else if (axis === "v") out[n - 2]!.x = out[n - 1]!.x;
	return out;
}

/** Every segment exactly horizontal or vertical. */
export function isSquare(points: P[]): boolean {
	return points.length > 2 && points.every((p, i) => i === 0 || Math.abs(p.x - points[i - 1]!.x) < 0.5 || Math.abs(p.y - points[i - 1]!.y) < 0.5);
}

/**
 * A square route whose card changed size: the corner next to an attached end moves back in
 * front of the card (staying in line with its next corner), so the end can still meet it
 * straight on.
 */
export function keepSquareEnds(points: P[], from?: Box | null, to?: Box | null): P[] {
	if (!isSquare(points)) return points;
	const out = points.map((p) => ({ ...p }));
	const n = out.length;
	const margin = (size: number) => Math.min(12, size / 2);
	const fix = (endIdx: number, nextIdx: number, box?: Box | null) => {
		if (!box) return;
		const end = out[endIdx]!;
		const next = out[nextIdx]!;
		const vertical = Math.abs(next.x - end.x) < 0.5;
		if (vertical) {
			const x = Math.max(box.x + margin(box.width), Math.min(box.x + box.width - margin(box.width), next.x));
			end.x = next.x = x;
		} else {
			const y = Math.max(box.y + margin(box.height), Math.min(box.y + box.height - margin(box.height), next.y));
			end.y = next.y = y;
		}
	};
	// A two-corner route shares its only middle segment: fix one end at a time.
	fix(0, 1, from);
	if (isSquare(out)) fix(n - 1, n - 2, to);
	return isSquare(out) ? out : points;
}

/**
 * Bend points of a square route follow its ends: the corner next to a moved end slides with it
 * along that segment's direction, so every segment stays horizontal or vertical.
 */
export function carrySquare(points: P[], start: P, end: P): P[] {
	const out = points.map((p) => ({ ...p }));
	const n = out.length;
	const slide = (endIdx: number, nextIdx: number, to: P) => {
		const was = points[endIdx]!;
		const vertical = Math.abs(points[nextIdx]!.x - was.x) < 0.5;
		if (vertical) out[nextIdx]!.x += to.x - was.x;
		else out[nextIdx]!.y += to.y - was.y;
		out[endIdx] = to;
	};
	slide(0, 1, start);
	slide(n - 1, n - 2, end);
	return out;
}

/**
 * The corners of a hand-drawn line: the path simplified to a polyline (`tolerance` in canvas
 * units), without corners that barely turn or sit inside the cards its ends attach to.
 * A drag that stays roughly straight gives just its two ends.
 */
export function cornersOf(trail: P[], tolerance: number, from?: Box | null, to?: Box | null): P[] {
	if (trail.length < 2) return trail.slice();
	const inside = (p: P, b?: Box | null) => !!b && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
	let pts = simplifyPath(trail, tolerance);
	const first = pts[0]!;
	const last = pts[pts.length - 1]!;
	let mid = pts.slice(1, -1).filter((p) => !inside(p, from) && !inside(p, to));
	// Drop corners that turn less than ~20° or sit on a very short segment.
	let changed = true;
	while (changed && mid.length) {
		changed = false;
		const all = [first, ...mid, last];
		for (let i = 1; i < all.length - 1; i++) {
			const a = all[i - 1]!;
			const b = all[i]!;
			const c = all[i + 1]!;
			const turn = Math.abs(angleBetween(b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y));
			if (turn < Math.PI / 9 || Math.hypot(b.x - a.x, b.y - a.y) < tolerance || Math.hypot(c.x - b.x, c.y - b.y) < tolerance) {
				mid = mid.filter((p) => p !== b);
				changed = true;
				break;
			}
		}
	}
	pts = [first, ...mid, last];
	return squareCorners(pts);
}

function angleBetween(ax: number, ay: number, bx: number, by: number): number {
	return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
}

/** Standalone shape card data (kind "shape"). */
export function shapeNodeData(id: string, shape: string, box: { x: number; y: number; width: number; height: number }, style: { color?: string; fill?: string; strokeWidth?: number }): CanvasNodeData {
	return {
		id,
		type: "text",
		text: "",
		x: Math.round(box.x),
		y: Math.round(box.y),
		width: Math.max(20, Math.round(box.width)),
		height: Math.max(20, Math.round(box.height)),
		...(style.color ? { color: style.color } : {}),
		"x-opc": { kind: "shape", shape, ...(style.fill ? { fill: style.fill } : {}), ...(style.strokeWidth ? { strokeWidth: style.strokeWidth } : {}) },
	};
}

/**
 * Bend points follow their line's ends: the transform that takes the old ends to the new ones
 * (move, turn and stretch) is applied to every point in between, so the route keeps its shape.
 */
export function carryBends(points: P[], start: P, end: P): P[] {
	const n = points.length;
	if (n < 2) return points;
	const a = points[0]!;
	const b = points[n - 1]!;
	const out = points.slice();
	out[0] = start;
	out[n - 1] = end;
	if (n === 2) return out;
	const ox = b.x - a.x;
	const oy = b.y - a.y;
	const len2 = ox * ox + oy * oy;
	if (len2 < 1e-6) {
		// Ends were on top of each other: just move the bends along with the start.
		for (let i = 1; i < n - 1; i++) out[i] = { x: points[i]!.x + start.x - a.x, y: points[i]!.y + start.y - a.y };
		return out;
	}
	const nx = end.x - start.x;
	const ny = end.y - start.y;
	// Complex ratio (new / old) = rotation and scale.
	const re = (nx * ox + ny * oy) / len2;
	const im = (ny * ox - nx * oy) / len2;
	for (let i = 1; i < n - 1; i++) {
		const dx = points[i]!.x - a.x;
		const dy = points[i]!.y - a.y;
		out[i] = { x: start.x + dx * re - dy * im, y: start.y + dx * im + dy * re };
	}
	return out;
}
