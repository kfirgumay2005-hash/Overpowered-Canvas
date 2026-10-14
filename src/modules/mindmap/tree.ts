/**
 * Mind-map structure derived from edges (pure, unit-tested). Parent → child is the edge
 * direction; nothing about the tree is stored in the file.
 */

export interface TNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface TEdge {
	from: string;
	to: string;
}

export type Dir = "right" | "left" | "down" | "up";

export function childrenOf(edges: TEdge[], id: string): string[] {
	return edges.filter((e) => e.from === id && e.to !== id).map((e) => e.to);
}

export function parentOf(edges: TEdge[], id: string): string | null {
	return edges.find((e) => e.to === id && e.from !== id)?.from ?? null;
}

/** All nodes reachable through outgoing edges (cycle-safe), excluding the root. */
export function descendants(edges: TEdge[], id: string): string[] {
	const seen = new Set<string>([id]);
	const out: string[] = [];
	const queue = [id];
	while (queue.length) {
		const cur = queue.shift()!;
		for (const c of childrenOf(edges, cur)) {
			if (seen.has(c)) continue;
			seen.add(c);
			out.push(c);
			queue.push(c);
		}
	}
	return out;
}

/** Roots of the forest: nodes with outgoing edges but no incoming ones (or the given ids). */
export function roots(nodes: TNode[], edges: TEdge[]): string[] {
	const ids = new Set(nodes.map((n) => n.id));
	const hasParent = new Set(edges.filter((e) => ids.has(e.from) && ids.has(e.to)).map((e) => e.to));
	return nodes.filter((n) => !hasParent.has(n.id)).map((n) => n.id);
}

/** Mirrors left/right for right-to-left canvases. */
export function logical(dir: Dir, rtl: boolean): Dir {
	if (!rtl) return dir;
	return dir === "right" ? "left" : dir === "left" ? "right" : dir;
}

/**
 * Where a new child goes: beside the parent in `dir`, after (below / beside) the existing
 * children on that side, so repeated Tab presses stack children neatly.
 */
export function childPosition(parent: TNode, existing: TNode[], size: { width: number; height: number }, dir: Dir, gap = { main: 80, cross: 30 }): { x: number; y: number } {
	const horizontal = dir === "right" || dir === "left";
	const onSide = existing.filter((c) => {
		if (dir === "right") return c.x >= parent.x + parent.width;
		if (dir === "left") return c.x + c.width <= parent.x;
		if (dir === "down") return c.y >= parent.y + parent.height;
		return c.y + c.height <= parent.y;
	});
	const main = dir === "right" ? parent.x + parent.width + gap.main : dir === "left" ? parent.x - gap.main - size.width : dir === "down" ? parent.y + parent.height + gap.main : parent.y - gap.main - size.height;
	if (horizontal) {
		const y = onSide.length ? Math.max(...onSide.map((c) => c.y + c.height)) + gap.cross : parent.y + (parent.height - size.height) / 2;
		return { x: main, y };
	}
	const x = onSide.length ? Math.max(...onSide.map((c) => c.x + c.width)) + gap.cross : parent.x + (parent.width - size.width) / 2;
	return { x, y: main };
}

/** Position for a sibling: right after `node` along the cross axis of its parent's direction. */
export function siblingPosition(node: TNode, dir: Dir, size: { width: number; height: number }, gap = 30): { x: number; y: number } {
	return dir === "right" || dir === "left" ? { x: node.x, y: node.y + node.height + gap } : { x: node.x + node.width + gap, y: node.y };
}

/** The direction from parent to child, from their centers. */
export function directionBetween(parent: TNode, child: TNode): Dir {
	const dx = child.x + child.width / 2 - (parent.x + parent.width / 2);
	const dy = child.y + child.height / 2 - (parent.y + parent.height / 2);
	if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
	return dy >= 0 ? "down" : "up";
}

/**
 * Nearest node in a direction, for Alt+Arrow navigation: candidates must lie in the 90° cone
 * around the direction; distance is weighted to prefer aligned nodes.
 */
export function neighbor(from: TNode, others: TNode[], dir: Dir): string | null {
	const cx = from.x + from.width / 2;
	const cy = from.y + from.height / 2;
	let best: { id: string; score: number } | null = null;
	for (const n of others) {
		if (n.id === from.id) continue;
		const dx = n.x + n.width / 2 - cx;
		const dy = n.y + n.height / 2 - cy;
		const along = dir === "right" ? dx : dir === "left" ? -dx : dir === "down" ? dy : -dy;
		const across = dir === "right" || dir === "left" ? Math.abs(dy) : Math.abs(dx);
		if (along <= 0 || across > along) continue;
		const score = along + across * 2;
		if (!best || score < best.score) best = { id: n.id, score };
	}
	return best?.id ?? null;
}

/** Splits a root's children into two balanced halves (by subtree size) for the balanced layout. */
export function balance<T>(children: T[], weight: (c: T) => number): [T[], T[]] {
	const a: T[] = [];
	const b: T[] = [];
	let wa = 0;
	let wb = 0;
	for (const c of children) {
		const w = Math.max(1, weight(c));
		if (wa <= wb) {
			a.push(c);
			wa += w;
		} else {
			b.push(c);
			wb += w;
		}
	}
	return [a, b];
}
