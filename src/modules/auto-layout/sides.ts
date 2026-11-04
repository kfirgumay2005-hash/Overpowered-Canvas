/**
 * Which sides edges attach to after a layout (pure, unit-tested). Every pair of sides is tried
 * on the curve the core draws for it; the shortest one wins unless it passes under a card or
 * crosses another connector, in which case a longer clear one is taken. When every pair passes
 * under a card the edge is reported as blocked, so it can be routed around the cards instead.
 */
import type { EdgeSide } from "../../data/json-canvas";
import { anchor, NORMALS, type Box, type P } from "../../geometry/routing";

export interface SideBox {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SideEdge {
	id: string;
	from: string;
	to: string;
	fromSide: EdgeSide;
	toSide: EdgeSide;
	/** Leave this end's side as it is (a floating end, or an edge not being re-arranged). */
	keepFrom?: boolean;
	keepTo?: boolean;
	/** False: the edge keeps both sides and only counts as something to avoid. */
	change: boolean;
	/** The sides a plain "facing each other" rule would pick: preferred when it costs the same. */
	preferFrom?: EdgeSide;
	preferTo?: EdgeSide;
}

export interface SideChoice {
	fromSide: EdgeSide;
	toSide: EdgeSide;
	/** Every pair of sides passes under some card. */
	blocked: boolean;
}

const SIDES: readonly EdgeSide[] = ["right", "left", "bottom", "top"];
const SAMPLES = 16;
/** Cards are shrunk by this much before testing, so a curve touching a border doesn't count. */
const INSET = 3;
const HIT_COST = 10_000;
const CROSS_COST = 1_500;
const UNPREFERRED_COST = 30;

interface Line {
	pts: P[];
	box: Box;
	from: string;
	to: string;
}

const toBox = (b: SideBox): Box => ({ minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height });

/** The core's bezier for an edge: control points 70–150 px out along each side's normal. */
export function edgeCurve(a: Box, aSide: EdgeSide, b: Box, bSide: EdgeSide, samples = SAMPLES): P[] {
	const p0 = anchor(a, aSide);
	const p3 = anchor(b, bSide);
	const k = Math.min(150, Math.max(70, Math.hypot(p3.x - p0.x, p3.y - p0.y) / 2));
	const p1 = { x: p0.x + NORMALS[aSide].x * k, y: p0.y + NORMALS[aSide].y * k };
	const p2 = { x: p3.x + NORMALS[bSide].x * k, y: p3.y + NORMALS[bSide].y * k };
	const out: P[] = [];
	for (let i = 0; i <= samples; i++) {
		const t = i / samples;
		const u = 1 - t;
		out.push({
			x: u * u * u * p0.x + 3 * t * u * u * p1.x + 3 * t * t * u * p2.x + t * t * t * p3.x,
			y: u * u * u * p0.y + 3 * t * u * u * p1.y + 3 * t * t * u * p2.y + t * t * t * p3.y,
		});
	}
	return out;
}

function boundsOf(pts: P[]): Box {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of pts) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x);
		maxY = Math.max(maxY, p.y);
	}
	return { minX, minY, maxX, maxY };
}

const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

function segmentHitsBox(p: P, q: P, b: Box): boolean {
	// Liang–Barsky clipping.
	let t0 = 0;
	let t1 = 1;
	const dx = q.x - p.x;
	const dy = q.y - p.y;
	const clip = (den: number, num: number) => {
		if (den === 0) return num >= 0;
		const t = num / den;
		if (den < 0) {
			if (t > t1) return false;
			if (t > t0) t0 = t;
		} else {
			if (t < t0) return false;
			if (t < t1) t1 = t;
		}
		return true;
	};
	return clip(-dx, p.x - b.minX) && clip(dx, b.maxX - p.x) && clip(-dy, p.y - b.minY) && clip(dy, b.maxY - p.y) && t0 <= t1;
}

function segmentsCross(a: P, b: P, c: P, d: P): boolean {
	const o = (p: P, q: P, r: P) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	const d1 = o(c, d, a);
	const d2 = o(c, d, b);
	const d3 = o(a, b, c);
	const d4 = o(a, b, d);
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function length(pts: P[]): number {
	let sum = 0;
	for (let i = 1; i < pts.length; i++) sum += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
	return sum;
}

function hits(pts: P[], box: Box, cards: Box[]): number {
	let n = 0;
	for (const c of cards) {
		if (!overlaps(box, c)) continue;
		for (let i = 1; i < pts.length; i++) {
			if (segmentHitsBox(pts[i - 1]!, pts[i]!, c)) {
				n++;
				break;
			}
		}
	}
	return n;
}

function crossings(line: Line, others: Iterable<Line>): number {
	let n = 0;
	for (const o of others) {
		// Edges of the same card meet at that card anyway.
		if (o.from === line.from || o.from === line.to || o.to === line.from || o.to === line.to) continue;
		if (!overlaps(line.box, o.box)) continue;
		outer: for (let i = 1; i < line.pts.length; i++)
			for (let j = 1; j < o.pts.length; j++)
				if (segmentsCross(line.pts[i - 1]!, line.pts[i]!, o.pts[j - 1]!, o.pts[j]!)) {
					n++;
					break outer;
				}
	}
	return n;
}

/**
 * Picks the sides of every edge with `change` set. `cards` are every card on the board (the
 * ends of the edges among them); edges without `change` keep their sides and are avoided.
 */
export function chooseSides(cards: SideBox[], edges: SideEdge[]): Map<string, SideChoice> {
	const boxes = new Map(cards.map((c) => [c.id, toBox(c)]));
	const shrunk = new Map(cards.map((c) => [c.id, { minX: c.x + INSET, minY: c.y + INSET, maxX: c.x + c.width - INSET, maxY: c.y + c.height - INSET }]));
	const lines = new Map<string, Line>();
	const lineOf = (e: SideEdge, fromSide: EdgeSide, toSide: EdgeSide): Line | null => {
		const a = boxes.get(e.from);
		const b = boxes.get(e.to);
		if (!a || !b) return null;
		const pts = edgeCurve(a, fromSide, b, toSide);
		return { pts, box: boundsOf(pts), from: e.from, to: e.to };
	};
	for (const e of edges) {
		if (e.from === e.to) continue;
		const line = lineOf(e, e.fromSide, e.toSide);
		if (line) lines.set(e.id, line);
	}
	const movable = edges.filter((e) => e.change && e.from !== e.to && boxes.has(e.from) && boxes.has(e.to));
	const all = [...shrunk.values()];
	const cost = (e: SideEdge, line: Line, fromSide: EdgeSide, toSide: EdgeSide) => {
		const others = [...lines.entries()].filter(([id]) => id !== e.id).map(([, l]) => l);
		const hit = hits(line.pts, line.box, all);
		let c = length(line.pts) + HIT_COST * hit + CROSS_COST * crossings(line, others);
		if ((e.preferFrom && fromSide !== e.preferFrom) || (e.preferTo && toSide !== e.preferTo)) c += UNPREFERRED_COST;
		return { c, hit };
	};
	const result = new Map<string, SideChoice>();
	const pick = (e: SideEdge) => {
		let best: { from: EdgeSide; to: EdgeSide; c: number; hit: number; line: Line } | null = null;
		for (const fromSide of e.keepFrom ? [e.fromSide] : SIDES)
			for (const toSide of e.keepTo ? [e.toSide] : SIDES) {
				const line = lineOf(e, fromSide, toSide);
				if (!line) continue;
				const { c, hit } = cost(e, line, fromSide, toSide);
				if (!best || c < best.c) best = { from: fromSide, to: toSide, c, hit, line };
			}
		if (!best) return;
		lines.set(e.id, best.line);
		result.set(e.id, { fromSide: best.from, toSide: best.to, blocked: best.hit > 0 });
	};
	// Short edges first (they have the fewest good options), then one more pass now that every
	// edge has a place, so early choices can make way for later ones.
	const order = [...movable].sort((a, b) => length(lines.get(a.id)?.pts ?? []) - length(lines.get(b.id)?.pts ?? []));
	for (const e of order) pick(e);
	for (const e of order) pick(e);
	return result;
}

/**
 * Edges whose drawn curve (with the sides they have) crosses another edge or passes under a
 * card that is neither of its ends. `only`: the edges to report (all are obstacles).
 */
export function troubledEdges(cards: SideBox[], edges: SideEdge[], only: ReadonlySet<string>): Set<string> {
	const boxes = new Map(cards.map((c) => [c.id, toBox(c)]));
	// Grown a little: a curve that only grazes a card's corner touches it too.
	const grown = cards.map((c) => ({ id: c.id, box: { minX: c.x - TOUCH / 2, minY: c.y - TOUCH / 2, maxX: c.x + c.width + TOUCH / 2, maxY: c.y + c.height + TOUCH / 2 } }));
	const lines = new Map<string, Line>();
	for (const e of edges) {
		const a = boxes.get(e.from);
		const b = boxes.get(e.to);
		if (!a || !b || e.from === e.to) continue;
		// Finer than when choosing sides: curves that only graze each other count too.
		const pts = edgeCurve(a, e.fromSide, b, e.toSide, 96);
		lines.set(e.id, { pts, box: boundsOf(pts), from: e.from, to: e.to });
	}
	const out = new Set<string>();
	for (const [id, line] of lines) {
		if (!only.has(id)) continue;
		const others = [...lines.entries()].filter(([o]) => o !== id).map(([, l]) => l);
		const under = hits(
			line.pts,
			line.box,
			grown.filter((c) => c.id !== line.from && c.id !== line.to).map((c) => c.box),
		);
		if (under > 0 || crossings(line, others) > 0 || others.some((o) => touching(line, o))) out.add(id);
	}
	return out;
}

/** Room under which two curves count as touching (the core draws them a few px off our anchors). */
const TOUCH = 8;

/** Two edges of different cards whose curves come within TOUCH of each other. */
function touching(a: Line, b: Line): boolean {
	if (b.from === a.from || b.from === a.to || b.to === a.from || b.to === a.to) return false;
	const near = (x: Box, y: Box) => x.minX - TOUCH <= y.maxX && y.minX - TOUCH <= x.maxX && x.minY - TOUCH <= y.maxY && y.minY - TOUCH <= x.maxY;
	if (!near(a.box, b.box)) return false;
	for (const p of a.pts) for (const q of b.pts) if (Math.abs(p.x - q.x) < TOUCH && Math.abs(p.y - q.y) < TOUCH && Math.hypot(p.x - q.x, p.y - q.y) < TOUCH) return true;
	return false;
}
