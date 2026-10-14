/** Pure helpers for editing edge bend points and label positions (unit-tested). */

export interface P {
	x: number;
	y: number;
}

/** Closest point on a polyline: its segment index and position along the whole line (0–1). */
export function nearestOnPolyline(points: P[], p: P): { point: P; segment: number; t: number } {
	let best = { point: points[0] ?? p, segment: 0, dist: Infinity, along: 0 };
	let walked = 0;
	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i]!;
		const b = points[i + 1]!;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len2 = dx * dx + dy * dy;
		const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
		const q = { x: a.x + u * dx, y: a.y + u * dy };
		const dist = Math.hypot(p.x - q.x, p.y - q.y);
		const len = Math.sqrt(len2);
		if (dist < best.dist) best = { point: q, segment: i, dist, along: walked + u * len };
		walked += len;
	}
	return { point: best.point, segment: best.segment, t: walked === 0 ? 0.5 : best.along / walked };
}

/** Midpoints of each segment, where a new bend point can be pulled out. */
export function midpoints(points: P[]): P[] {
	const out: P[] = [];
	for (let i = 0; i + 1 < points.length; i++) out.push({ x: (points[i]!.x + points[i + 1]!.x) / 2, y: (points[i]!.y + points[i + 1]!.y) / 2 });
	return out;
}

/**
 * Bend points after pulling a new one out of `segment` of the full path (ends included).
 * Interior points of the current path are kept, so routed shapes survive the first edit.
 */
export function insertBend(path: P[], segment: number, p: P): P[] {
	const interior = path.slice(1, -1);
	interior.splice(segment, 0, p);
	return interior;
}

export function round(p: P): [number, number] {
	return [Math.round(p.x), Math.round(p.y)];
}
