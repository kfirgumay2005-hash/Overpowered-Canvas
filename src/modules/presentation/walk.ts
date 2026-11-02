// Walking through a mind map with the arrow keys (pure, unit-tested).
import { orderChildren, readingOrder } from "../canvas-markdown/structure";
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

/** An edge of the walk. `inside`: from a group to a card in it that no arrow leads to. */
export interface WalkEdge extends TEdge {
	inside?: boolean;
}

/**
 * Children of `id` in reading order (as the outline lists them). A group lists the cards it holds
 * first, then where its own arrows lead.
 */
export function orderedChildren(nodes: Map<string, TNode>, edges: WalkEdge[], id: string, rtl: boolean): TNode[] {
	const parent = nodes.get(id);
	if (!parent) return [];
	const seen = new Set<string>();
	const held: TNode[] = [];
	const linked: TNode[] = [];
	for (const e of edges) {
		if (e.from !== id || e.to === id || seen.has(e.to)) continue;
		seen.add(e.to);
		const n = nodes.get(e.to);
		if (n) (e.inside ? held : linked).push(n);
	}
	// What a group holds reads like a page: top to bottom, then along the reading direction.
	return [...held.sort(readingOrder(rtl)), ...orderChildren(parent, linked, rtl)];
}

export interface WalkBox extends TNode {
	group?: boolean;
	/** "" for the main page. */
	page?: string;
}

function holds(outer: TNode, inner: TNode): boolean {
	return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/**
 * The edges a walk follows through groups: each card (or group) that no arrow leads to hangs from
 * the smallest group around it on the same page, so a group reads as a card with its name whose
 * children are what it holds, followed by where its own arrows lead. Nested groups nest.
 */
export function groupEdges(nodes: Iterable<WalkBox>, edges: TEdge[]): WalkEdge[] {
	const list = [...nodes];
	const hasParent = new Set(edges.filter((e) => e.from !== e.to).map((e) => e.to));
	const groups = list.filter((n) => n.group).sort((a, b) => a.width * a.height - b.width * b.height);
	const out: WalkEdge[] = [];
	for (const n of list) {
		if (hasParent.has(n.id)) continue;
		const g = groups.find((g) => g.id !== n.id && holds(g, n) && g.width * g.height > n.width * n.height && (g.page ?? "") === (n.page ?? ""));
		if (g) out.push({ from: g.id, to: n.id, inside: true });
	}
	return out;
}

/**
 * Where an arrow key leads by the map's hierarchy, wherever the cards sit: Right goes into the
 * children (the one visited last under this card, else the first), Left back to the parent, Up
 * and Down to the previous and next sibling, stopping at the first and last. Null at the ends.
 */
export function treeStep(nodes: Map<string, TNode>, edges: WalkEdge[], current: string, key: Dir, visited: ReadonlyMap<string, string>, rtl = false): string | null {
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

export interface Rect {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * The arrow a tap beside a card stands for: above, below, left or right of it, whichever way the
 * tap lies furthest beyond the card's edges. Null on the card itself.
 */
export function tapDirection(card: Rect, x: number, y: number): Dir | null {
	const across = x < card.left ? card.left - x : x > card.right ? x - card.right : 0;
	const along = y < card.top ? card.top - y : y > card.bottom ? y - card.bottom : 0;
	if (across === 0 && along === 0) return null;
	if (along >= across) return y < card.top ? "up" : "down";
	return x < card.left ? "left" : "right";
}

/** The cards from the top of the map down to `id`, along the way it was reached (cycle-safe). */
export function pathTo(nodes: Map<string, TNode>, edges: TEdge[], id: string, visited: ReadonlyMap<string, string>): string[] {
	const path = [id];
	const seen = new Set(path);
	for (let p = treeParent(nodes, edges, id, visited); p && !seen.has(p); p = treeParent(nodes, edges, p, visited)) {
		seen.add(p);
		path.unshift(p);
	}
	return path;
}
