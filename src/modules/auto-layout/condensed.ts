/**
 * Condensed radial layout (pure): an organic radial mind map. The root sits in the middle and
 * its branches share the full turn around it, each in a sector as wide as its subtree needs
 * (bigger branches get wider sectors, and together they fill the circle). Within its sector a
 * branch fans out as a small radial tree of its own, its levels spaced by its own cards.
 *
 * When a branch needs more room, only the level that gains most from it moves out (with the
 * levels beyond it): a branch crowded far out reaches further there while its first levels stay
 * right beside the root, and small branches stay close. (The classic radial layout multiplies
 * every ring by what the most crowded one needs, which leaves wide empty rings.)
 *
 * Every card keeps inside its parent's sector, so connectors fan outward and don't cross; a
 * final check against the real boxes and the parent → child lines moves out only the levels
 * that still touch something.
 *
 * Children go round in the map's order (radialKids): clockwise from the top, counter-clockwise in
 * right-to-left canvases.
 */
import type { ChildOrder } from "../mindmap/order";
import type { TEdge, TNode } from "../mindmap/tree";
import { clashingPairs, radialKids, type Positions } from "./radial";

interface Options {
	spacing: number;
	levelSpacing: number;
}

/** Share of the level spacing between a card and its children (the radial layout uses all of it). */
const CLOSE = 0.6;

interface Branch {
	id: string;
	depth: Map<string, number>;
	/** Radius of each level before any lift. */
	base: number[];
	/** Extra distance before each level (each lift moves that level and the ones beyond it). */
	lift: number[];
	start: number;
	wedge: number;
}

function layoutTree(byId: Map<string, TNode>, kids: Map<string, string[]>, root: string, opts: Options): Positions {
	const node = (id: string) => byId.get(id)!;
	const half = (id: string) => Math.hypot(node(id).width, node(id).height) / 2 + opts.spacing / 2;
	const branches = kids.get(root) ?? [];
	const r0 = node(root);
	const pos: Positions = new Map([[root, { x: -r0.width / 2, y: -r0.height / 2 }]]);
	if (!branches.length) return pos;

	const branchOf = new Map<string, string>();
	const made: Branch[] = branches.map((b) => {
		const depth = new Map<string, number>([[b, 0]]);
		const levels: string[][] = [[b]];
		branchOf.set(b, b);
		while (true) {
			const next = levels[levels.length - 1]!.flatMap((id) => kids.get(id) ?? []);
			if (!next.length) break;
			for (const id of next) {
				depth.set(id, levels.length);
				branchOf.set(id, b);
			}
			levels.push(next);
		}
		const maxHalf = levels.map((ids) => Math.max(...ids.map(half)));
		const base = [half(root) + opts.levelSpacing * CLOSE + maxHalf[0]!];
		for (let d = 1; d < levels.length; d++) base[d] = base[d - 1]! + maxHalf[d - 1]! + opts.levelSpacing * CLOSE + maxHalf[d]!;
		return { id: b, depth, base, lift: base.map(() => 0), start: 0, wedge: 0 };
	});
	const byBranch = new Map(made.map((b) => [b.id, b]));

	const radiusAt = (b: Branch, d: number) => {
		let r = b.base[d]!;
		for (let k = 0; k <= d; k++) r += b.lift[k]!;
		return r;
	};
	/** The angle each card's subtree needs at the branch's current radii. */
	const needOf = (b: Branch) => {
		const need = new Map<string, number>();
		const measure = (id: string): number => {
			const r = radiusAt(b, b.depth.get(id)!);
			const h = half(id);
			const own = h >= r ? Math.PI : 2 * Math.asin(h / r);
			const sum = (kids.get(id) ?? []).reduce((s, k) => s + measure(k), 0);
			need.set(id, Math.max(own, sum));
			return need.get(id)!;
		};
		measure(b.id);
		return need;
	};

	// Sectors: shares of the full turn by what each branch needs, the first one centered at the top.
	const needs = made.map((b) => needOf(b).get(b.id)!);
	const total = needs.reduce((s, n) => s + n, 0);
	let a0 = -Math.PI / 2 - (needs[0]! / total) * Math.PI;
	made.forEach((b, i) => {
		b.wedge = (needs[i]! / total) * 2 * Math.PI;
		b.start = a0;
		a0 += b.wedge;
	});

	const step = Math.max(16, opts.spacing);
	/** Moves out the level that gains the most room (the deepest of equals: the first levels stay close). */
	const grow = (b: Branch) => {
		const now = needOf(b).get(b.id)!;
		let best = b.lift.length - 1;
		let gain = -Infinity;
		for (let d = 0; d < b.lift.length; d++) {
			b.lift[d]! += step;
			const g = now - needOf(b).get(b.id)!;
			b.lift[d]! -= step;
			if (g > gain + 1e-9) {
				gain = g;
				best = d;
			} else if (Math.abs(g - gain) <= 1e-9) best = d;
		}
		b.lift[best]! += step;
	};
	for (const b of made) for (let i = 0; i < 600 && needOf(b).get(b.id)! > b.wedge; i++) grow(b);

	const place = (b: Branch) => {
		const need = needOf(b);
		const spread = (id: string, start: number, wedge: number) => {
			const mid = start + wedge / 2;
			const r = radiusAt(b, b.depth.get(id)!);
			const n = node(id);
			pos.set(id, { x: r * Math.cos(mid) - n.width / 2, y: r * Math.sin(mid) - n.height / 2 });
			const children = kids.get(id) ?? [];
			const sum = children.reduce((s, k) => s + need.get(k)!, 0);
			// Children take only the angle they need, centered on their parent: they stay close to it.
			const used = Math.min(wedge, sum);
			let a = mid - used / 2;
			for (const k of children) {
				const w = sum > 0 ? (need.get(k)! / sum) * used : used / children.length;
				spread(k, a, w);
				a += w;
			}
		};
		spread(b.id, b.start, b.wedge);
	};
	for (const b of made) place(b);

	// Whatever still touches (cards, or a connector crossing another or passing under a card):
	// the level of the card concerned moves out, in its own branch only. A connector that runs
	// too much along its ring gets more radial that way.
	for (let i = 0; i < 300; i++) {
		const pairs = clashingPairs(pos, byId, kids, root);
		if (!pairs.length) break;
		const lifted = new Map<Branch, number>();
		for (const pair of pairs)
			for (const id of pair) {
				const b = branchOf.has(id) ? byBranch.get(branchOf.get(id)!)! : null;
				if (!b) continue;
				const d = b.depth.get(id)!;
				lifted.set(b, Math.max(lifted.get(b) ?? 0, d));
			}
		if (!lifted.size) break;
		for (const [b, d] of lifted) {
			b.lift[d]! += step / 2;
			place(b);
		}
	}
	if (clashingPairs(pos, byId, kids, root).length === 0) compact(pos, byId, kids, root, opts);
	return pos;
}

type Pt = { x: number; y: number };

/** Room kept between connectors, and around cards (px). */
const CLEARANCE = 14;

/**
 * Pulls every card, with its whole branch, toward its parent along its connector, as close as it
 * gets without touching another card or a connector crossing another or passing under a card:
 * inner cards first, so each branch then starts from where its parent ended up. Leaves the layout
 * clear (it only accepts clear positions).
 */
function compact(pos: Positions, byId: Map<string, TNode>, kids: Map<string, string[]>, root: string, opts: Options): void {
	const node = (id: string) => byId.get(id)!;
	const parent = new Map<string, string>();
	const order: string[] = [];
	const queue = [root];
	while (queue.length) {
		const id = queue.shift()!;
		order.push(id);
		for (const k of kids.get(id) ?? []) {
			if (!pos.has(k) || parent.has(k)) continue;
			parent.set(k, id);
			queue.push(k);
		}
	}
	const subtree = (id: string): string[] => [id, ...(kids.get(id) ?? []).filter((k) => parent.get(k) === id).flatMap(subtree)];
	const center = (id: string): Pt => ({ x: pos.get(id)!.x + node(id).width / 2, y: pos.get(id)!.y + node(id).height / 2 });
	const pad = opts.spacing / 2;
	const box = (id: string, grow: number) => {
		const p = pos.get(id)!;
		return { minX: p.x - grow, minY: p.y - grow, maxX: p.x + node(id).width + grow, maxY: p.y + node(id).height + grow };
	};
	const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	const cross = (a: Pt, b: Pt, c: Pt, d: Pt) => {
		const d1 = o(c, d, a);
		const d2 = o(c, d, b);
		const d3 = o(a, b, c);
		const d4 = o(a, b, d);
		return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
	};
	const hitsBox = (p: Pt, q: Pt, b: { minX: number; minY: number; maxX: number; maxY: number }) => {
		if (Math.max(p.x, q.x) < b.minX || Math.min(p.x, q.x) > b.maxX || Math.max(p.y, q.y) < b.minY || Math.min(p.y, q.y) > b.maxY) return false;
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
	};
	// Drawn connectors leave from the cards' sides and curve: keep the lines apart, not just uncrossed.
	const toward = (p: Pt, a: Pt, b: Pt) => {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const l = dx * dx + dy * dy;
		const t = l ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l)) : 0;
		return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
	};
	const apart = (a: Pt, b: Pt, c: Pt, d: Pt) => Math.min(toward(a, c, d), toward(b, c, d), toward(c, a, b), toward(d, a, b));
	const all = [...parent.keys(), root];
	/** Whether the cards in `moved` touch anything (cards, connectors) outside them. */
	const clashes = (moved: Set<string>): boolean => {
		for (const m of moved) {
			const b = box(m, pad);
			for (const other of all) {
				if (moved.has(other)) continue;
				const ob = box(other, 0);
				if (b.minX < ob.maxX && ob.minX < b.maxX && b.minY < ob.maxY && ob.minY < b.maxY) return true;
			}
		}
		const segs = [...parent].map(([to, from]) => ({ from, to, a: center(from), b: center(to) }));
		const touched = segs.filter((s) => moved.has(s.from) || moved.has(s.to));
		for (const s of touched) {
			for (const t of segs) {
				if (s === t || (moved.has(t.from) && moved.has(t.to))) continue;
				if (s.from === t.from || s.from === t.to || s.to === t.from || s.to === t.to) continue;
				if (cross(s.a, s.b, t.a, t.b) || apart(s.a, s.b, t.a, t.b) < CLEARANCE) return true;
			}
			for (const id of all) {
				if (id === s.from || id === s.to || (moved.has(id) && moved.has(s.from) && moved.has(s.to))) continue;
				const b = box(id, CLEARANCE / 2);
				if (hitsBox(s.a, s.b, b)) return true;
			}
		}
		// Connectors elsewhere passing under a moved card.
		for (const t of segs) {
			if (moved.has(t.from) || moved.has(t.to)) continue;
			for (const m of moved) if (hitsBox(t.a, t.b, box(m, CLEARANCE / 2))) return true;
		}
		return false;
	};
	const shift = (ids: string[], dx: number, dy: number) => {
		for (const id of ids) {
			const p = pos.get(id)!;
			pos.set(id, { x: p.x + dx, y: p.y + dy });
		}
	};
	for (const id of order) {
		const p = parent.get(id);
		if (!p) continue;
		const ids = subtree(id);
		const moved = new Set(ids);
		const from = center(p);
		const to = center(id);
		const vx = to.x - from.x;
		const vy = to.y - from.y;
		const len = Math.hypot(vx, vy);
		if (len < 1) continue;
		const ux = vx / len;
		const uy = vy / len;
		// Never closer than the two cards' edges along the connector, plus a little room.
		const reach = (n: string) => (Math.abs(ux) * node(n).width) / 2 + (Math.abs(uy) * node(n).height) / 2;
		const least = reach(p) + reach(id) + opts.levelSpacing * 0.35;
		if (len <= least + 1) continue;
		// The closest clear distance, coarse to fine; the current one is clear.
		let best = len;
		for (const f of [0.2, 0.35, 0.5, 0.65, 0.8, 0.9]) {
			const d = least + (len - least) * f;
			shift(ids, ux * (d - len), uy * (d - len));
			const ok = !clashes(moved);
			shift(ids, -ux * (d - len), -uy * (d - len));
			if (ok) {
				best = d;
				break;
			}
		}
		if (best < len) shift(ids, ux * (best - len), uy * (best - len));
	}
	for (const [id, p] of pos) pos.set(id, { x: Math.round(p.x), y: Math.round(p.y) });
}

/** Condensed radial layout of a forest (see radialLayout for the arguments); trees side by side. */
export function condensedLayout(nodes: TNode[], tree: TEdge[], rootIds: string[], opts: Options, order?: ChildOrder, rtl = false): Positions {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const kids = radialKids(nodes, tree, order, rtl);
	const out: Positions = new Map();
	let offsetX = 0;
	for (const root of rootIds) {
		const pos = layoutTree(byId, kids, root, opts);
		// Right to left: counter-clockwise, the mirror image.
		if (rtl) for (const [id, p] of pos) pos.set(id, { x: -p.x - byId.get(id)!.width, y: p.y });
		const minX = Math.min(...[...pos].map(([, p]) => p.x));
		const maxX = Math.max(...[...pos].map(([id, p]) => p.x + byId.get(id)!.width));
		for (const [id, p] of pos) out.set(id, { x: p.x - minX + offsetX, y: p.y });
		offsetX += maxX - minX + opts.levelSpacing;
	}
	for (const n of nodes) if (!out.has(n.id)) out.set(n.id, { x: n.x, y: n.y });
	return out;
}
