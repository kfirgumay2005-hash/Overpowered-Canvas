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
	for (let i = 0; i < 60 && (result.total > 2 * Math.PI || anyOverlap(result.pos, nodes, 0)); i++) {
		scale *= 1.1;
		result = place(scale);
	}
	return result.pos;
}

/**
 * Radial layout of a forest. `tree` must be a spanning forest of `nodes` (see spanningTree),
 * `rootIds` its roots in order; trees are placed side by side. Children keep the order of their
 * current angle around their parent (clockwise from the top), so running it again is stable.
 */
export function radialLayout(nodes: TNode[], tree: TEdge[], rootIds: string[], opts: Options): Positions {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const cx = (n: TNode) => n.x + n.width / 2;
	const cy = (n: TNode) => n.y + n.height / 2;
	const kids = new Map<string, string[]>();
	for (const e of tree) (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)!).push(e.to);
	for (const [parent, list] of kids) {
		const p = byId.get(parent)!;
		const angle = (id: string) => {
			const n = byId.get(id)!;
			return (Math.atan2(cx(n) - cx(p), -(cy(n) - cy(p))) + 2 * Math.PI) % (2 * Math.PI);
		};
		const order = new Map(list.map((id) => [id, angle(id)]));
		list.sort((a, b) => order.get(a)! - order.get(b)!);
	}

	const out: Positions = new Map();
	let offsetX = 0;
	for (const root of rootIds) {
		const pos = layoutTree(byId, kids, root, opts);
		const minX = Math.min(...[...pos].map(([, p]) => p.x));
		const maxX = Math.max(...[...pos].map(([id, p]) => p.x + byId.get(id)!.width));
		for (const [id, p] of pos) out.set(id, { x: p.x - minX + offsetX, y: p.y });
		offsetX += maxX - minX + opts.levelSpacing;
	}
	for (const n of nodes) if (!out.has(n.id)) out.set(n.id, { x: n.x, y: n.y });
	return out;
}
