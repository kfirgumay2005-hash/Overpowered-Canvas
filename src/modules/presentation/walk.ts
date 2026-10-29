// Walking through a mind map with the arrow keys (pure, unit-tested).
import { orderChildren } from "../canvas-markdown/structure";
import { childrenOf, directionBetween, parentOf, type Dir, type TEdge, type TNode } from "../mindmap/tree";

const OPPOSITE: Record<Dir, Dir> = { right: "left", left: "right", down: "up", up: "down" };
const horizontal = (d: Dir) => d === "right" || d === "left";
const center = (n: TNode) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

/** Children of `parent` on the side `dir`, in order across that side (top to bottom, left to right). */
function onSide(nodes: Map<string, TNode>, edges: TEdge[], parent: TNode, dir: Dir): TNode[] {
	return childrenOf(edges, parent.id)
		.map((id) => nodes.get(id))
		.filter((n): n is TNode => !!n && directionBetween(parent, n) === dir)
		.sort((a, b) => (horizontal(dir) ? center(a).y - center(b).y : center(a).x - center(b).x));
}

/**
 * Where an arrow key leads from `current`, judged by where the cards really are, so maps that grow
 * to either side or downwards work alike: toward the children goes to a child (the one visited last
 * under this card, else the first), the other way goes to the parent, and across the branch goes to
 * the previous or next sibling on the same side of the parent. Returns null at the ends.
 */
export function walkStep(nodes: Map<string, TNode>, edges: TEdge[], current: string, key: Dir, visited: ReadonlyMap<string, string>): string | null {
	const node = nodes.get(current);
	if (!node) return null;
	const kids = onSide(nodes, edges, node, key);
	if (kids.length) {
		const last = visited.get(current);
		return kids.find((k) => k.id === last)?.id ?? kids[0]!.id;
	}
	const parentId = parentOf(edges, current);
	const parent = parentId ? nodes.get(parentId) : undefined;
	if (!parent) return null;
	const axis = directionBetween(parent, node);
	if (key === OPPOSITE[axis]) return parent.id;
	if (horizontal(key) === horizontal(axis)) return null;
	const siblings = onSide(nodes, edges, parent, axis);
	const i = siblings.findIndex((s) => s.id === current);
	const next = siblings[i + (key === "down" || key === "right" ? 1 : -1)];
	return next?.id ?? null;
}

/** The root above `id` (cycle-safe). */
export function rootOf(edges: TEdge[], id: string): string {
	const seen = new Set<string>([id]);
	let root = id;
	for (let p = parentOf(edges, root); p && !seen.has(p); p = parentOf(edges, root)) {
		seen.add(p);
		root = p;
	}
	return root;
}

/** The root of the biggest map: where a walk starts when nothing is selected. */
export function largestRoot(nodes: Map<string, TNode>, edges: TEdge[]): string | null {
	const size = new Map<string, number>();
	for (const id of nodes.keys()) {
		const r = rootOf(edges, id);
		size.set(r, (size.get(r) ?? 0) + 1);
	}
	let best: string | null = null;
	for (const [id, n] of size) if (best === null || n > size.get(best)!) best = id;
	return best;
}

/** The parent a step back leads to: the one we came down from, else the first. */
function treeParent(nodes: Map<string, TNode>, edges: TEdge[], id: string, visited: ReadonlyMap<string, string>): string | null {
	const parents = edges.filter((e) => e.to === id && e.from !== id && nodes.has(e.from)).map((e) => e.from);
	return parents.find((p) => visited.get(p) === id) ?? parents[0] ?? null;
}

/** Children of `id` in reading order (as the outline lists them). */
export function orderedChildren(nodes: Map<string, TNode>, edges: TEdge[], id: string, rtl: boolean): TNode[] {
	const parent = nodes.get(id);
	if (!parent) return [];
	const kids = [...new Set(childrenOf(edges, id))].map((c) => nodes.get(c)).filter((n): n is TNode => !!n);
	return orderChildren(parent, kids, rtl);
}

/**
 * Where an arrow key leads by the map's hierarchy, wherever the cards sit: Right goes into the
 * children (the one visited last under this card, else the first), Left back to the parent, Up
 * and Down to the previous and next sibling, stopping at the first and last. Null at the ends.
 */
export function treeStep(nodes: Map<string, TNode>, edges: TEdge[], current: string, key: Dir, visited: ReadonlyMap<string, string>, rtl = false): string | null {
	if (!nodes.has(current)) return null;
	if (key === "right") {
		const kids = orderedChildren(nodes, edges, current, rtl);
		const last = visited.get(current);
		return kids.find((k) => k.id === last)?.id ?? kids[0]?.id ?? null;
	}
	const parent = treeParent(nodes, edges, current, visited);
	if (key === "left") return parent;
	if (!parent) return null;
	const siblings = orderedChildren(nodes, edges, parent, rtl);
	const i = siblings.findIndex((s) => s.id === current);
	return siblings[i + (key === "down" ? 1 : -1)]?.id ?? null;
}
