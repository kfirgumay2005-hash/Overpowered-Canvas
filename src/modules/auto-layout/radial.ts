/**
 * Collision-free radial tree layout (pure). The root sits in the middle; each level is a ring.
 *
 * Every card is treated as the circle around its box (half its diagonal plus half the spacing),
 * so cards of any width and height fit:
 * - rings are far enough apart that circles of neighbouring levels can't touch;
 * - each card needs an angle on its ring for its circle; a subtree needs the larger of its own
 *   angle and the sum of its children's, and gets a share of its parent's wedge in proportion;
 * - when the tree needs more than a full turn, all rings grow until it fits.
 * A final check against the real boxes grows the rings further if anything still overlaps.
 */
import { followStored, type ChildOrder } from "../mindmap/order";
import type { TEdge, TNode } from "../mindmap/tree";

export type Positions = Map<string, { x: number; y: number }>;

interface Options {
	spacing: number;
	levelSpacing: number;
}

function anyOverlap(pos: Positions, nodes: Map<string, TNode>, gap: number): boolean {
	const boxes = [...pos].map(([id, p]) => ({ ...nodes.get(id)!, ...p }));
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]!;
			const b = boxes[j]!;
			if (a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap) return true;
		}
	return false;
}

/**
 * What still touches in a laid-out tree, as pairs of card ids: two cards overlapping, two
 * connectors crossing (each named by its child card), a connector passing under a card that is
 * neither of its ends. Connectors are taken as the line between the centers of parent and child,
 * which the drawn curve follows; connectors of the same card meet there and don't count.
 */
export function clashingPairs(pos: Positions, nodes: Map<string, TNode>, kids: Map<string, string[]>, root: string, withCards = true): [string, string][] {
	const center = (id: string) => {
		const p = pos.get(id)!;
		const n = nodes.get(id)!;
		return { x: p.x + n.width / 2, y: p.y + n.height / 2 };
	};
	const segs: { a: { x: number; y: number }; b: { x: number; y: number }; from: string; to: string }[] = [];
	const stack = [root];
	const seen = new Set<string>();
	while (stack.length) {
		const id = stack.pop()!;
		if (seen.has(id) || !pos.has(id)) continue;
		seen.add(id);
		for (const k of kids.get(id) ?? []) {
			if (!pos.has(k)) continue;
			segs.push({ a: center(id), b: center(k), from: id, to: k });
			stack.push(k);
		}
	}
	const out: [string, string][] = [];
	const ids = [...seen];
	const box = (id: string, inset = 0) => {
		const p = pos.get(id)!;
		const n = nodes.get(id)!;
		return { minX: p.x + inset, minY: p.y + inset, maxX: p.x + n.width - inset, maxY: p.y + n.height - inset };
	};
	if (withCards)
		for (let i = 0; i < ids.length; i++)
			for (let j = i + 1; j < ids.length; j++) {
				const a = box(ids[i]!);
				const b = box(ids[j]!);
				if (a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY) out.push([ids[i]!, ids[j]!]);
			}
	const o = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	const cross = (s: (typeof segs)[number], t: (typeof segs)[number]) => {
		const d1 = o(t.a, t.b, s.a);
		const d2 = o(t.a, t.b, s.b);
		const d3 = o(s.a, s.b, t.a);
		const d4 = o(s.a, s.b, t.b);
		return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
	};
	for (let i = 0; i < segs.length; i++)
		for (let j = i + 1; j < segs.length; j++) {
			const s = segs[i]!;
			const t = segs[j]!;
			if (s.from === t.from || s.from === t.to || s.to === t.from || s.to === t.to) continue;
			if (cross(s, t)) out.push([s.to, t.to]);
		}
	for (const s of segs)
		for (const id of ids) {
			if (id === s.from || id === s.to) continue;
			if (segmentHitsBox(s.a, s.b, box(id, 4))) out.push([s.to, id]);
		}
	return out;
}

/** Whether a connector of the tree crosses another or passes under a card (see clashingPairs). */
export function connectorsClash(pos: Positions, nodes: Map<string, TNode>, kids: Map<string, string[]>, root: string): boolean {
	return clashingPairs(pos, nodes, kids, root, false).length > 0;
}

function segmentHitsBox(p: { x: number; y: number }, q: { x: number; y: number }, b: { minX: number; minY: number; maxX: number; maxY: number }): boolean {
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
}

/** Lays out one tree rooted at `root`; positions are top-left corners around (0, 0). */
function layoutTree(nodes: Map<string, TNode>, kids: Map<string, string[]>, root: string, opts: Options): Positions {
	const half = (id: string) => {
		const n = nodes.get(id)!;
		return Math.hypot(n.width, n.height) / 2 + opts.spacing / 2;
	};
	const depth = new Map<string, number>([[root, 0]]);
	const levels: string[][] = [[root]];
	while (true) {
		const next = levels[levels.length - 1]!.flatMap((id) => kids.get(id) ?? []);
		if (!next.length) break;
		for (const id of next) depth.set(id, levels.length);
		levels.push(next);
	}
	const maxHalf = levels.map((ids) => Math.max(...ids.map(half)));
	const base: number[] = [0];
	for (let d = 1; d < levels.length; d++) base[d] = base[d - 1]! + maxHalf[d - 1]! + opts.levelSpacing + maxHalf[d]!;

	const place = (scale: number): { pos: Positions; total: number } => {
		const radius = base.map((r) => r * scale);
		const need = new Map<string, number>();
		const measure = (id: string): number => {
			const sum = (kids.get(id) ?? []).reduce((s, k) => s + measure(k), 0);
			const r = radius[depth.get(id)!]!;
			const h = half(id);
			const own = id === root ? 0 : h >= r ? Math.PI : 2 * Math.asin(h / r);
			need.set(id, Math.max(own, sum));
			return need.get(id)!;
		};
		const total = measure(root);
		const pos: Positions = new Map();
		const spread = (id: string, start: number, wedge: number) => {
			const children = kids.get(id) ?? [];
			const sum = children.reduce((s, k) => s + need.get(k)!, 0);
			let a = start;
			for (const k of children) {
				const w = sum > 0 ? (need.get(k)! / sum) * wedge : wedge / children.length;
				const n = nodes.get(k)!;
				const r = radius[depth.get(k)!]!;
				const mid = a + w / 2;
				pos.set(k, { x: r * Math.cos(mid) - n.width / 2, y: r * Math.sin(mid) - n.height / 2 });
				spread(k, a, w);
				a += w;
			}
		};
		const r0 = nodes.get(root)!;
		pos.set(root, { x: -r0.width / 2, y: -r0.height / 2 });
		// A full turn, with the first child centred at the top.
		const first = kids.get(root)?.[0];
		const firstShare = first && total > 0 ? (need.get(first)! / total) * 2 * Math.PI : 0;
		spread(root, -Math.PI / 2 - firstShare / 2, 2 * Math.PI);
		return { pos, total };
	};

	let scale = 1;
	let result = place(scale);
	for (let i = 0; i < 60 && (result.total > 2 * Math.PI || anyOverlap(result.pos, nodes, 0) || connectorsClash(result.pos, nodes, kids, root)); i++) {
		scale *= 1.1;
		result = place(scale);
	}
	return result.pos;
}

/**
 * Children of every parent in the order a radial map goes around: the stored order (`order`),
 * else clockwise (counter-clockwise right to left) as they sit now. Around a root that starts at
 * 12 o'clock; around any other card it starts from the way back to its parent, so a branch reads
 * the same way round as the whole map, wherever it points.
 */
export function radialKids(nodes: TNode[], tree: TEdge[], order?: ChildOrder, rtl = false): Map<string, string[]> {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const cx = (n: TNode) => n.x + n.width / 2;
	const cy = (n: TNode) => n.y + n.height / 2;
	const kids = new Map<string, string[]>();
	const parentOf = new Map<string, string>();
	for (const e of tree) {
		if (!byId.has(e.from) || !byId.has(e.to)) continue;
		(kids.get(e.from) ?? kids.set(e.from, []).get(e.from)!).push(e.to);
		parentOf.set(e.to, e.from);
	}
	// Clockwise angle from 12 o'clock (counter-clockwise when right to left).
	const turn = (from: TNode, to: TNode) => {
		const dx = cx(to) - cx(from);
		return Math.atan2(rtl ? -dx : dx, -(cy(to) - cy(from)));
	};
	for (const [parent, list] of kids) {
		const p = byId.get(parent)!;
		const up = parentOf.get(parent);
		const start = up ? turn(p, byId.get(up)!) : 0;
		const angle = (id: string) => (((turn(p, byId.get(id)!) - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
		const angles = new Map(list.map((id) => [id, angle(id)]));
		list.sort((a, b) => angles.get(a)! - angles.get(b)!);
		const stored = followStored(list.map((id) => ({ id })), order?.[parent]).map((n) => n.id);
		list.splice(0, list.length, ...stored);
	}
	return kids;
}

/**
 * Radial layout of a forest. `tree` must be a spanning forest of `nodes` (see spanningTree),
 * `rootIds` its roots in order; trees are placed side by side. Children go clockwise from the
 * top (counter-clockwise in right-to-left canvases) in the map's stored order (`order`); those
 * it doesn't name keep the order of their current angle around their parent, so running it
 * again is stable.
 */
export function radialLayout(nodes: TNode[], tree: TEdge[], rootIds: string[], opts: Options, order?: ChildOrder, rtl = false): Positions {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const kids = radialKids(nodes, tree, order, rtl);

	const out: Positions = new Map();
	let offsetX = 0;
	for (const root of rootIds) {
		// Right to left: counter-clockwise, the mirror image of the clockwise layout.
		const pos = layoutTree(byId, kids, root, opts);
		if (rtl) for (const [id, p] of pos) pos.set(id, { x: -p.x - byId.get(id)!.width, y: p.y });
		const minX = Math.min(...[...pos].map(([, p]) => p.x));
		const maxX = Math.max(...[...pos].map(([id, p]) => p.x + byId.get(id)!.width));
		for (const [id, p] of pos) out.set(id, { x: p.x - minX + offsetX, y: p.y });
		offsetX += maxX - minX + opts.levelSpacing;
	}
	for (const n of nodes) if (!out.has(n.id)) out.set(n.id, { x: n.x, y: n.y });
	return out;
}
