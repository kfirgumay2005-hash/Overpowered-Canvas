/**
 * Free lines and arrows (kind "line"): text cards whose x-opc.line holds the polyline relative
 * to the card. Ends can attach to other cards; the card's box always wraps the line. Pure.
 */
import type { CanvasNodeData } from "../../data/json-canvas";
import type { ArrowStyle, LineData, Point } from "../../data/schema";

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

/** Moves attached ends onto the border of their cards, toward the neighboring point. */
export function snapEnds(points: P[], from?: Box | null, to?: Box | null): P[] {
	if (points.length < 2) return points;
	const out = points.slice();
	if (from) out[0] = borderPoint(from, out[1]!);
	if (to) out[out.length - 1] = borderPoint(to, out[out.length - 2]!);
	return out;
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
