/**
 * Groups as rigid blocks for auto layout (pure). A group taking part in a layout becomes one
 * node the size of the group; everything inside it moves with it by the same offset, so the
 * cards keep their exact places inside the group.
 */
import type { TEdge, TNode } from "../mindmap/tree";

export interface BoxNode extends TNode {
	group: boolean;
}

export interface Blocks {
	/** What the layout engine arranges: loose cards and one node per block. */
	nodes: TNode[];
	edges: TEdge[];
	/** Block id → every node inside it (cards, drawings, nested groups). */
	members: Map<string, string[]>;
	/** Node id → the block it belongs to. */
	blockOf: Map<string, string>;
}

function inside(outer: TNode, inner: TNode): boolean {
	return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/**
 * Groups that hold every one of `ids`: the map lives inside them, so they are not blocks — the
 * cards inside are arranged and the group grows to fit them (see `fitGroups`).
 */
export function groupsAround(all: BoxNode[], ids: Iterable<string>): Set<string> {
	const byId = new Map(all.map((n) => [n.id, n]));
	const members = [...ids].map((id) => byId.get(id)).filter((n): n is BoxNode => !!n && !n.group);
	if (members.length === 0) return new Set();
	return new Set(all.filter((g) => g.group && members.every((m) => inside(g, m))).map((g) => g.id));
}

/**
 * `all`: every node of the canvas; `targets`: the cards to arrange; `groups`: groups chosen
 * directly (selected, or all of them for a whole-canvas layout). A target inside a group makes
 * its outermost group a block. Groups in `open` are never blocks (the next group inside them
 * can be). Nodes in `loose` never belong to a group (a card just dropped onto one).
 */
export function collapseGroups(all: BoxNode[], targets: Set<string>, groups: Set<string>, edges: TEdge[], open: ReadonlySet<string> = new Set(), loose: ReadonlySet<string> = new Set()): Blocks {
	// Outermost group around each node (largest first, so the first hit is the outermost).
	const byArea = all.filter((n) => n.group && !open.has(n.id)).sort((a, b) => b.width * b.height - a.width * a.height);
	const outer = new Map<string, string>();
	for (const n of all) {
		if (loose.has(n.id)) continue;
		const g = byArea.find((g) => g.id !== n.id && inside(g, n) && !(n.group && g.width * g.height <= n.width * n.height));
		if (g) outer.set(n.id, g.id);
	}
	const blocks = new Set<string>();
	for (const id of targets) {
		const g = outer.get(id);
		if (g) blocks.add(g);
	}
	for (const id of groups) if (!open.has(id)) blocks.add(outer.get(id) ?? id);

	const members = new Map<string, string[]>([...blocks].map((b) => [b, []]));
	const blockOf = new Map<string, string>();
	for (const n of all) {
		const b = outer.get(n.id);
		if (b && blocks.has(b)) {
			members.get(b)!.push(n.id);
			blockOf.set(n.id, b);
		}
	}
	const byId = new Map(all.map((n) => [n.id, n]));
	const nodes: TNode[] = [];
	for (const id of targets) if (!blockOf.has(id) && !blocks.has(id) && byId.has(id)) nodes.push(strip(byId.get(id)!));
	for (const b of blocks) nodes.push(strip(byId.get(b)!));
	const ids = new Set(nodes.map((n) => n.id));
	const seen = new Set<string>();
	const out: TEdge[] = [];
	for (const e of edges) {
		const from = blockOf.get(e.from) ?? e.from;
		const to = blockOf.get(e.to) ?? e.to;
		const key = `${from}\u0000${to}`;
		if (from === to || !ids.has(from) || !ids.has(to) || seen.has(key)) continue;
		seen.add(key);
		out.push({ from, to });
	}
	return { nodes, edges: out, members, blockOf };
}

function strip(n: TNode): TNode {
	return { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
}

/** New top-left position of every moved node: blocks carry their members along. */
export function expandPositions(blocks: Blocks, positions: Map<string, { x: number; y: number }>, all: Map<string, TNode>): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	for (const [id, p] of positions) {
		out.set(id, p);
		const memberIds = blocks.members.get(id);
		if (!memberIds) continue;
		const group = all.get(id)!;
		const dx = p.x - group.x;
		const dy = p.y - group.y;
		for (const m of memberIds) {
			const n = all.get(m)!;
			out.set(m, { x: n.x + dx, y: n.y + dy });
		}
	}
	return out;
}

/** Room kept between a group's border and the cards it was grown around. */
const GROUP_PAD = 40;

/**
 * New rectangles for the `open` groups after a layout: each keeps its old area and grows to hold
 * the cards that were inside it before. Groups that need no change are left out.
 */
export function fitGroups(all: BoxNode[], open: ReadonlySet<string>, positions: Map<string, { x: number; y: number }>): Map<string, { x: number; y: number; width: number; height: number }> {
	const out = new Map<string, { x: number; y: number; width: number; height: number }>();
	for (const g of all) {
		if (!open.has(g.id)) continue;
		let minX = g.x;
		let minY = g.y;
		let maxX = g.x + g.width;
		let maxY = g.y + g.height;
		for (const n of all) {
			if (n.id === g.id || !inside(g, n)) continue;
			const p = positions.get(n.id);
			if (!p) continue;
			minX = Math.min(minX, p.x - GROUP_PAD);
			minY = Math.min(minY, p.y - GROUP_PAD);
			maxX = Math.max(maxX, p.x + n.width + GROUP_PAD);
			maxY = Math.max(maxY, p.y + n.height + GROUP_PAD);
		}
		if (minX < g.x || minY < g.y || maxX > g.x + g.width || maxY > g.y + g.height) out.set(g.id, { x: minX, y: minY, width: maxX - minX, height: maxY - minY });
	}
	return out;
}
