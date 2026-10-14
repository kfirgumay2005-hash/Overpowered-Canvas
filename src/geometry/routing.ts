/**
 * Edge routing geometry. Pure functions — unit-tested.
 * Coordinates are canvas units; sides follow JSON Canvas ("top", "right", "bottom", "left").
 */
import type { EdgeSide } from "../data/json-canvas";

export interface P {
	x: number;
	y: number;
}

export interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export const NORMALS: Readonly<Record<EdgeSide, P>> = {
	top: { x: 0, y: -1 },
	right: { x: 1, y: 0 },
	bottom: { x: 0, y: 1 },
	left: { x: -1, y: 0 },
};

export function anchor(box: Box, side: EdgeSide): P {
	switch (side) {
		case "top":
			return { x: (box.minX + box.maxX) / 2, y: box.minY };
		case "right":
			return { x: box.maxX, y: (box.minY + box.maxY) / 2 };
		case "bottom":
			return { x: (box.minX + box.maxX) / 2, y: box.maxY };
		case "left":
			return { x: box.minX, y: (box.minY + box.maxY) / 2 };
	}
}

const add = (a: P, b: P, k = 1): P => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);
const same = (a: P, b: P) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** Drops repeated and collinear interior points. */
export function simplify(points: P[]): P[] {
	const out: P[] = [];
	for (const p of points) {
		if (out.length && same(out[out.length - 1]!, p)) continue;
		if (out.length >= 2) {
			const a = out[out.length - 2]!;
			const b = out[out.length - 1]!;
			const cross = (b.x - a.x) * (p.y - b.y) - (b.y - a.y) * (p.x - b.x);
			const dot = (b.x - a.x) * (p.x - b.x) + (b.y - a.y) * (p.y - b.y);
			if (Math.abs(cross) < 1e-6 && dot >= 0) {
				out[out.length - 1] = p;
				continue;
			}
		}
		out.push(p);
	}
	return out;
}

/** The side of `box` facing point `p` — used by floating edges. */
export function bestSide(box: Box, p: P): EdgeSide {
	const cx = (box.minX + box.maxX) / 2;
	const cy = (box.minY + box.maxY) / 2;
	const w = Math.max(1, box.maxX - box.minX);
	const h = Math.max(1, box.maxY - box.minY);
	// Normalize by the box aspect so the diagonals split the sides.
	const dx = (p.x - cx) / w;
	const dy = (p.y - cy) / h;
	if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
	return dy >= 0 ? "bottom" : "top";
}

function boxHitsSegment(box: Box, a: P, b: P): boolean {
	// Axis-aligned segments only (orthogonal routes).
	const minX = Math.min(a.x, b.x);
	const maxX = Math.max(a.x, b.x);
	const minY = Math.min(a.y, b.y);
	const maxY = Math.max(a.y, b.y);
	return maxX > box.minX && minX < box.maxX && maxY > box.minY && minY < box.maxY;
}

/**
 * Manhattan route between two side anchors with a short perpendicular stub at each end.
 * Picks the cheapest of a few elbow layouts, penalizing segments that run back into either
 * node or leave/enter against the side's direction.
 */
export function orthogonalRoute(a: P, sideA: EdgeSide, b: P, sideB: EdgeSide, avoid: Box[] = [], stub = 24): P[] {
	const na = NORMALS[sideA];
	const nb = NORMALS[sideB];
	const a1 = add(a, na, stub);
	const b1 = add(b, nb, stub);
	const mx = (a1.x + b1.x) / 2;
	const my = (a1.y + b1.y) / 2;
	const candidates: P[][] = [
		[a1, { x: b1.x, y: a1.y }, b1],
		[a1, { x: a1.x, y: b1.y }, b1],
		[a1, { x: mx, y: a1.y }, { x: mx, y: b1.y }, b1],
		[a1, { x: a1.x, y: my }, { x: b1.x, y: my }, b1],
	];
	let best: P[] = candidates[0]!;
	let bestCost = Infinity;
	for (const c of candidates) {
		const pts = simplify([a, ...c, b]);
		let cost = 0;
		for (let i = 1; i < pts.length; i++) {
			const p = pts[i - 1]!;
			const q = pts[i]!;
			cost += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
			// Interior segments crossing the end nodes are ugly.
			if (i > 1 && i < pts.length - 1) for (const box of avoid) if (boxHitsSegment(box, p, q)) cost += 10_000;
		}
		cost += (pts.length - 2) * 8; // fewer bends
		// First move should follow the start side, last move should arrive against the end side.
		const first = pts[1]!;
		const second = pts[2];
		if (second && (second.x - first.x) * na.x + (second.y - first.y) * na.y < -1e-6) cost += 400;
		const lastIn = pts[pts.length - 2]!;
		const beforeLast = pts[pts.length - 3];
		if (beforeLast && (lastIn.x - beforeLast.x) * nb.x + (lastIn.y - beforeLast.y) * nb.y > 1e-6) cost += 400;
		if (cost < bestCost) {
			bestCost = cost;
			best = pts;
		}
	}
	return best;
}

/** Minimal binary heap keyed by number. */
class Heap<T> {
	private items: { k: number; v: T }[] = [];
	get size() {
		return this.items.length;
	}
	push(k: number, v: T) {
		const a = this.items;
		a.push({ k, v });
		let i = a.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (a[p]!.k <= a[i]!.k) break;
			[a[p], a[i]] = [a[i]!, a[p]!];
			i = p;
		}
	}
	pop(): T | undefined {
		const a = this.items;
		if (a.length === 0) return undefined;
		const top = a[0]!.v;
		const last = a.pop()!;
		if (a.length) {
			a[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				if (l < a.length && a[l]!.k < a[m]!.k) m = l;
				if (r < a.length && a[r]!.k < a[m]!.k) m = r;
				if (m === i) break;
				[a[m], a[i]] = [a[i]!, a[m]!];
				i = m;
			}
		}
		return top;
	}
}

export interface AStarOptions {
	/** Grid cell size in canvas units. */
	cell?: number;
	/** Clearance kept around obstacles. */
	margin?: number;
	/** Extra cost per bend, in cells. */
	bendCost?: number;
	/** Safety limit on explored cells; falls back to an orthogonal route when exceeded. */
	maxCells?: number;
}

/**
 * Orthogonal A* route around obstacles (node boxes). The route leaves `a` and enters `b`
 * perpendicular to their sides. Returns null when no route is found within the limits.
 */
export function astarRoute(a: P, sideA: EdgeSide, b: P, sideB: EdgeSide, obstacles: Box[], opts: AStarOptions = {}): P[] | null {
	const cell = opts.cell ?? 20;
	const margin = opts.margin ?? 12;
	const bendCost = (opts.bendCost ?? 2) * cell;
	const maxCells = opts.maxCells ?? 40_000;
	const na = NORMALS[sideA];
	const nb = NORMALS[sideB];
	const stub = cell * 1.5;
	const a1 = add(a, na, stub);
	const b1 = add(b, nb, stub);
	const snap = (v: number) => Math.round(v / cell);
	const start = { i: snap(a1.x), j: snap(a1.y) };
	const goal = { i: snap(b1.x), j: snap(b1.y) };
	const pad = 12;
	const minI = Math.min(start.i, goal.i) - pad;
	const maxI = Math.max(start.i, goal.i) + pad;
	const minJ = Math.min(start.j, goal.j) - pad;
	const maxJ = Math.max(start.j, goal.j) + pad;
	const inflated = obstacles.map((o) => ({ minX: o.minX - margin, minY: o.minY - margin, maxX: o.maxX + margin, maxY: o.maxY + margin }));
	const blocked = (i: number, j: number) => {
		const x = i * cell;
		const y = j * cell;
		for (const o of inflated) if (x > o.minX && x < o.maxX && y > o.minY && y < o.maxY) return true;
		return false;
	};
	const key = (i: number, j: number, d: number) => (((i - minI) * (maxJ - minJ + 1) + (j - minJ)) << 2) | d;
	const DIRS = [
		{ di: 1, dj: 0 },
		{ di: -1, dj: 0 },
		{ di: 0, dj: 1 },
		{ di: 0, dj: -1 },
	];
	const startDir = DIRS.findIndex((d) => d.di === Math.sign(na.x) && d.dj === Math.sign(na.y));
	const goalDir = DIRS.findIndex((d) => d.di === -Math.sign(nb.x) && d.dj === -Math.sign(nb.y));
	const h = (i: number, j: number) => (Math.abs(i - goal.i) + Math.abs(j - goal.j)) * cell;
	const g = new Map<number, number>();
	const parent = new Map<number, number>();
	const heap = new Heap<{ i: number; j: number; d: number; k: number }>();
	const sk = key(start.i, start.j, startDir);
	g.set(sk, 0);
	heap.push(h(start.i, start.j), { i: start.i, j: start.j, d: startDir, k: sk });
	let explored = 0;
	let found: number | null = null;
	while (heap.size) {
		const cur = heap.pop()!;
		if (cur.i === goal.i && cur.j === goal.j) {
			found = cur.k;
			break;
		}
		if (++explored > maxCells) return null;
		const gc = g.get(cur.k)!;
		DIRS.forEach((dir, d) => {
			// No U-turns.
			if (DIRS[cur.d] && dir.di === -DIRS[cur.d]!.di && dir.dj === -DIRS[cur.d]!.dj) return;
			const ni = cur.i + dir.di;
			const nj = cur.j + dir.dj;
			if (ni < minI || ni > maxI || nj < minJ || nj > maxJ) return;
			const isGoal = ni === goal.i && nj === goal.j;
			if (!isGoal && blocked(ni, nj)) return;
			let cost = gc + cell + (d !== cur.d ? bendCost : 0);
			if (isGoal && d !== goalDir) cost += bendCost;
			const nk = key(ni, nj, d);
			if (cost < (g.get(nk) ?? Infinity)) {
				g.set(nk, cost);
				parent.set(nk, cur.k);
				heap.push(cost + h(ni, nj), { i: ni, j: nj, d, k: nk });
			}
		});
	}
	if (found === null) return null;
	const cells: P[] = [];
	const span = maxJ - minJ + 1;
	for (let k: number | undefined = found; k !== undefined; k = parent.get(k)) {
		const idx = k >> 2;
		cells.push({ x: (Math.floor(idx / span) + minI) * cell, y: ((idx % span) + minJ) * cell });
	}
	cells.reverse();
	// Connect the exact anchors to the grid with axis-aligned joints.
	const first = cells[0]!;
	const last = cells[cells.length - 1]!;
	const joinStart = na.x !== 0 ? { x: first.x, y: a.y } : { x: a.x, y: first.y };
	const joinEnd = nb.x !== 0 ? { x: last.x, y: b.y } : { x: b.x, y: last.y };
	return simplify([a, joinStart, ...cells, joinEnd, b]);
}

export function polylineLength(points: P[]): number {
	let len = 0;
	for (let i = 1; i < points.length; i++) len += dist(points[i - 1]!, points[i]!);
	return len;
}

/** Point and unit tangent at fraction t (0–1) of the polyline's length. */
export function pointAlong(points: P[], t: number): { point: P; tangent: P } {
	if (points.length === 0) return { point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 } };
	if (points.length === 1) return { point: points[0]!, tangent: { x: 1, y: 0 } };
	const total = polylineLength(points);
	let remaining = Math.min(1, Math.max(0, t)) * total;
	for (let i = 1; i < points.length; i++) {
		const p = points[i - 1]!;
		const q = points[i]!;
		const len = dist(p, q);
		if (remaining <= len || i === points.length - 1) {
			const k = len === 0 ? 0 : remaining / len;
			return { point: { x: p.x + (q.x - p.x) * Math.min(1, k), y: p.y + (q.y - p.y) * Math.min(1, k) }, tangent: len === 0 ? { x: 1, y: 0 } : { x: (q.x - p.x) / len, y: (q.y - p.y) / len } };
		}
		remaining -= len;
	}
	return { point: points[points.length - 1]!, tangent: { x: 1, y: 0 } };
}

/** Nearest fraction t (0–1) along the polyline to point p — used when dragging labels. */
export function projectOnPolyline(points: P[], p: P): number {
	const total = polylineLength(points);
	if (total === 0) return 0.5;
	let best = { d: Infinity, at: 0 };
	let walked = 0;
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1]!;
		const b = points[i]!;
		const len = dist(a, b);
		const k = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len)));
		const q = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
		const d = dist(p, q);
		if (d < best.d) best = { d, at: walked + len * k };
		walked += len;
	}
	return best.at / total;
}

/** Shortens the polyline by `start` units at its beginning and `end` units at its end. */
export function trim(points: P[], start: number, end: number): P[] {
	let pts = points.map((p) => ({ ...p }));
	const cut = (list: P[], amount: number): P[] => {
		let left = amount;
		while (list.length >= 2 && left > 0) {
			const a = list[0]!;
			const b = list[1]!;
			const len = dist(a, b);
			if (len > left) {
				list[0] = { x: a.x + ((b.x - a.x) * left) / len, y: a.y + ((b.y - a.y) * left) / len };
				return list;
			}
			left -= len;
			list.shift();
		}
		return list;
	};
	if (start > 0) pts = cut(pts, start);
	if (end > 0) pts = cut(pts.reverse(), end).reverse();
	return pts;
}

/** SVG path for a polyline, with optional rounded corners. */
export function polylinePath(points: P[], radius = 0): string {
	const f = (n: number) => Math.round(n * 100) / 100;
	if (points.length === 0) return "";
	let d = `M${f(points[0]!.x)} ${f(points[0]!.y)}`;
	for (let i = 1; i < points.length; i++) {
		const p = points[i]!;
		const prev = points[i - 1]!;
		const next = points[i + 1];
		if (radius > 0 && next) {
			const r = Math.min(radius, dist(prev, p) / 2, dist(p, next) / 2);
			const inDir = { x: (p.x - prev.x) / (dist(prev, p) || 1), y: (p.y - prev.y) / (dist(prev, p) || 1) };
			const outDir = { x: (next.x - p.x) / (dist(p, next) || 1), y: (next.y - p.y) / (dist(p, next) || 1) };
			const before = { x: p.x - inDir.x * r, y: p.y - inDir.y * r };
			const after = { x: p.x + outDir.x * r, y: p.y + outDir.y * r };
			d += ` L${f(before.x)} ${f(before.y)} Q${f(p.x)} ${f(p.y)} ${f(after.x)} ${f(after.y)}`;
		} else d += ` L${f(p.x)} ${f(p.y)}`;
	}
	return d;
}

/** Rotation (degrees, 0–360) for an arrowhead whose tip is at `tip` and whose body points toward `from`. */
export function arrowAngle(tip: P, from: P): number {
	const ux = from.x - tip.x;
	const uy = from.y - tip.y;
	const deg = (Math.atan2(-ux, uy) * 180) / Math.PI;
	return Math.round((((deg % 360) + 360) % 360) * 1000) / 1000;
}
