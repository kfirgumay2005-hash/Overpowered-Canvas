/**
 * Auto layout with ELK (elkjs). No Obsidian imports, so it runs in unit tests with the
 * in-thread ELK build; the plugin passes a worker-backed instance.
 */
import { orderChildren, type MapAxis } from "../canvas-markdown/structure";
import { tidyTree } from "../canvas-markdown/tidy";
import type { ChildOrder } from "../mindmap/order";
import { childrenOf, roots, type TEdge, type TNode } from "../mindmap/tree";
import { condensedLayout } from "./condensed";
import { radialLayout } from "./radial";

export interface ElkNode {
	id: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	children?: ElkNode[];
	edges?: { id: string; sources: string[]; targets: string[] }[];
	layoutOptions?: Record<string, string>;
}

export interface ElkLike {
	layout(graph: ElkNode): Promise<ElkNode>;
}

export type Algorithm = "mindmap" | "layered" | "grid";
export type LayoutDirection = "right" | "left" | "down" | "up" | "radial" | "condensed" | "balanced";

export interface LayoutOptions {
	algorithm: Algorithm;
	direction: LayoutDirection;
	/** Gap between sibling nodes. */
	spacing: number;
	/** Gap between levels / layers. */
	levelSpacing: number;
	/** The map's stored sibling order (root x-opc `childOrder`); children it doesn't name follow the board. */
	order?: ChildOrder;
	/**
	 * Right-to-left canvas: siblings read right to left (up / down maps), counter-clockwise
	 * (radial, balanced: the left side first), as everywhere else the order is read or recorded.
	 */
	rtl?: boolean;
	/** How to read each parent's children off the board: the axis of its map's current layout. */
	readAs?: (parent: string) => MapAxis | undefined;
}

export type Positions = Map<string, { x: number; y: number }>;

const ELK_DIR: Record<"right" | "left" | "down" | "up", string> = { right: "RIGHT", left: "LEFT", down: "DOWN", up: "UP" };

/** Keeps only tree edges (first parent wins), so tree algorithms never see cycles. */
export function spanningTree(nodes: TNode[], edges: TEdge[]): TEdge[] {
	const ids = new Set(nodes.map((n) => n.id));
	const inner = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
	const seen = new Set<string>();
	const out: TEdge[] = [];
	// True roots first; then any node still unvisited (cycles have no root), in the given order.
	for (const root of [...roots(nodes, inner), ...nodes.map((n) => n.id)]) {
		if (seen.has(root)) continue;
		seen.add(root);
		const queue = [root];
		while (queue.length) {
			const cur = queue.shift()!;
			for (const c of childrenOf(inner, cur)) {
				if (seen.has(c)) continue;
				seen.add(c);
				out.push({ from: cur, to: c });
				queue.push(c);
			}
		}
	}
	return out;
}

function graph(nodes: TNode[], edges: TEdge[], options: Record<string, string>): ElkNode {
	return {
		id: "root",
		layoutOptions: options,
		children: nodes.map((n) => ({ id: n.id, width: n.width, height: n.height })),
		edges: edges.map((e, i) => ({ id: `e${i}`, sources: [e.from], targets: [e.to] })),
	};
}

function read(result: ElkNode): Positions {
	const out: Positions = new Map();
	for (const c of result.children ?? []) out.set(c.id, { x: c.x ?? 0, y: c.y ?? 0 });
	return out;
}

/** Moves `positions` so that `anchorId` (or the top-left corner) stays where it was. */
function anchor(positions: Positions, nodes: TNode[], anchorId: string | null): Positions {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	let dx: number;
	let dy: number;
	const a = anchorId ? byId.get(anchorId) : undefined;
	const p = anchorId ? positions.get(anchorId) : undefined;
	if (a && p) {
		dx = a.x - p.x;
		dy = a.y - p.y;
	} else {
		dx = Math.min(...nodes.map((n) => n.x)) - Math.min(...[...positions.values()].map((v) => v.x));
		dy = Math.min(...nodes.map((n) => n.y)) - Math.min(...[...positions.values()].map((v) => v.y));
	}
	const out: Positions = new Map();
	for (const [id, v] of positions) out.set(id, { x: Math.round(v.x + dx), y: Math.round(v.y + dy) });
	return out;
}

export async function computeLayout(elk: ElkLike, nodes: TNode[], edges: TEdge[], opts: LayoutOptions): Promise<Positions> {
	if (nodes.length === 0) return new Map();
	const ids = new Set(nodes.map((n) => n.id));
	const inner = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);

	if (opts.algorithm === "grid") {
		const result = await elk.layout(
			graph(nodes, [], {
				"elk.algorithm": "rectpacking",
				"elk.spacing.nodeNode": String(opts.spacing),
				"elk.aspectRatio": "1.6",
			}),
		);
		return anchor(read(result), nodes, null);
	}

	if (opts.algorithm === "layered") {
		const dir = opts.direction === "radial" || opts.direction === "condensed" || opts.direction === "balanced" ? "right" : opts.direction;
		const result = await elk.layout(
			graph(nodes, inner, {
				"elk.algorithm": "layered",
				"elk.direction": ELK_DIR[dir],
				"elk.spacing.nodeNode": String(opts.spacing),
				"elk.layered.spacing.nodeNodeBetweenLayers": String(opts.levelSpacing),
				"elk.spacing.componentComponent": String(opts.levelSpacing),
			}),
		);
		return anchor(read(result), nodes, null);
	}

	// Mind map: tree layouts over a spanning tree.
	const tree = spanningTree(nodes, inner);
	const rootIds = roots(nodes, tree);
	const firstRoot = rootIds[0] ?? null;

	// Radial: our own collision-free layout (ELK's radial ignores card sizes and overlaps them).
	if (opts.direction === "radial") return anchor(radialLayout(nodes, tree, rootIds, opts, opts.order, !!opts.rtl), nodes, firstRoot);
	// Condensed radial: branches close to their parents, filling the space around the root.
	if (opts.direction === "condensed") return anchor(condensedLayout(nodes, tree, rootIds, opts, opts.order, !!opts.rtl), nodes, firstRoot);

	return anchor(orderedTrees(nodes, tree, rootIds, opts.direction, opts), nodes, firstRoot);
}

/**
 * Directional and balanced mind maps, laid out without ELK: ELK's tree algorithm reorders
 * siblings, so a map the user rearranged by dragging came back in another order. Here children
 * keep the order they show on the board (see siblingOrder), every run of the layout.
 */
function orderedTrees(nodes: TNode[], tree: TEdge[], rootIds: string[], direction: "right" | "left" | "down" | "up" | "balanced", opts: LayoutOptions): Positions {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const kids = siblingOrder(nodes, tree, opts.order, !!opts.rtl, opts.readAs);
	const horizontal = direction !== "down" && direction !== "up";
	const out: Positions = new Map();
	// Several maps: each one keeps its root where it is, then they are stacked across the main
	// axis (in the order their roots sit) so none overlaps the one before.
	const ordered = [...rootIds].sort((a, b) => (horizontal ? byId.get(a)!.y - byId.get(b)!.y : byId.get(a)!.x - byId.get(b)!.x));
	let next = -Infinity;
	for (const root of ordered) {
		const pos = direction === "balanced" ? balancedTree(byId, kids, root, opts) : tidyTree(nodes, kids, root, { direction, spacing: opts.spacing, levelSpacing: opts.levelSpacing, rtl: !!opts.rtl });
		const span = (id: string, p: { x: number; y: number }): [number, number] => (horizontal ? [p.y, p.y + byId.get(id)!.height] : [p.x, p.x + byId.get(id)!.width]);
		const lo = Math.min(...[...pos].map(([id, p]) => span(id, p)[0]));
		const hi = Math.max(...[...pos].map(([id, p]) => span(id, p)[1]));
		const shift = next === -Infinity || lo >= next ? 0 : next - lo;
		for (const [id, p] of pos) out.set(id, horizontal ? { x: p.x, y: p.y + shift } : { x: p.x + shift, y: p.y });
		next = hi + shift + opts.levelSpacing;
	}
	// Nodes outside any tree (no root reached them) keep their place.
	for (const n of nodes) if (!out.has(n.id)) out.set(n.id, { x: n.x, y: n.y });
	return out;
}

/** Children of every parent in the map's order: stored, else as the board shows them (see orderChildren). */
export function siblingOrder(nodes: TNode[], tree: TEdge[], order?: ChildOrder, rtl = false, axis?: (parent: string) => MapAxis | undefined): Map<string, string[]> {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const kids = new Map<string, string[]>();
	for (const e of tree) if (byId.has(e.from) && byId.has(e.to)) (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)!).push(e.to);
	for (const [parent, list] of kids)
		kids.set(
			parent,
			orderChildren(byId.get(parent)!, list.map((id) => byId.get(id)!), rtl, order?.[parent], axis?.(parent)).map((n) => n.id),
		);
	return kids;
}

/**
 * A balanced map: each side keeps as many children as it has now. `kids` of the root read
 * clockwise (the map's order): the right side takes the first ones, top to bottom, the left side
 * the rest, bottom to top (mirrored in right-to-left canvases: the left side first). A map whose
 * children are all on one side (the first balanced run) is split by subtree size, keeping that
 * order.
 */
function balancedTree(byId: Map<string, TNode>, kids: Map<string, string[]>, root: string, opts: LayoutOptions): Positions {
	const r = byId.get(root)!;
	const all = kids.get(root) ?? [];
	const cx = (id: string) => byId.get(id)!.x + byId.get(id)!.width / 2;
	const rtl = !!opts.rtl;
	const onRight = (id: string) => cx(id) >= r.x + r.width / 2;
	// "first": the side the order starts on (top to bottom); "then": the other side, bottom to top.
	const onFirst = all.filter((id) => onRight(id) !== rtl).length;
	let first = all.slice(0, onFirst);
	let then = all.slice(onFirst).reverse();
	if (!first.length || !then.length) {
		const size = (id: string): number => 1 + (kids.get(id) ?? []).reduce((s, k) => s + size(k), 0);
		// The first children (about half the cards) on the first side, the rest on the other.
		const total = all.reduce((s, id) => s + size(id), 0);
		let cut = 0;
		for (let sum = 0; cut < all.length - 1 && sum + size(all[cut]!) / 2 <= total / 2; cut++) sum += size(all[cut]!);
		cut = Math.max(1, cut);
		first = all.slice(0, cut);
		then = all.slice(cut).reverse();
	}
	const nodes = [...byId.values()];
	const base = { spacing: opts.spacing, levelSpacing: opts.levelSpacing, rtl: false };
	const forward = tidyTree(nodes, new Map([...kids, [root, first]]), root, { ...base, direction: rtl ? "left" : "right" });
	const back = tidyTree(nodes, new Map([...kids, [root, then]]), root, { ...base, direction: rtl ? "right" : "left" });
	return new Map([...back, ...forward]);
}

/** Ease-out cubic interpolation of positions, for the animated transition. */
export function interpolate(from: Positions, to: Positions, t: number): Positions {
	const k = 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
	const out: Positions = new Map();
	for (const [id, b] of to) {
		const a = from.get(id) ?? b;
		out.set(id, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
	}
	return out;
}
