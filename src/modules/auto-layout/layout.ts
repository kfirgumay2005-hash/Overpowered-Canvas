/**
 * Auto layout with ELK (elkjs). No Obsidian imports, so it runs in unit tests with the
 * in-thread ELK build; the plugin passes a worker-backed instance.
 */
import { balance, childrenOf, descendants, roots, type TEdge, type TNode } from "../mindmap/tree";

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
export type LayoutDirection = "right" | "left" | "down" | "up" | "radial" | "balanced";

export interface LayoutOptions {
	algorithm: Algorithm;
	direction: LayoutDirection;
	/** Gap between sibling nodes. */
	spacing: number;
	/** Gap between levels / layers. */
	levelSpacing: number;
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

/**
 * ELK's mrtree places siblings along the cross axis; the main axis is then set from the tree
 * depth so levels are exactly `levelSpacing` apart (mrtree has no reliable option for that).
 */
async function treeLayout(elk: ElkLike, nodes: TNode[], edges: TEdge[], dir: "right" | "left" | "down" | "up", opts: LayoutOptions): Promise<Positions> {
	const pos = read(
		await elk.layout(
			graph(nodes, edges, {
				"elk.algorithm": "mrtree",
				"elk.direction": ELK_DIR[dir],
				"elk.spacing.nodeNode": String(opts.spacing),
				"elk.spacing.componentComponent": String(opts.levelSpacing),
			}),
		),
	);
	const horizontal = dir === "right" || dir === "left";
	const sign = dir === "right" || dir === "down" ? 1 : -1;
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const extent = (id: string) => (horizontal ? byId.get(id)?.width : byId.get(id)?.height) ?? 0;
	// Depth of every node from its root.
	const depth = new Map<string, number>();
	for (const root of roots(nodes, edges)) {
		depth.set(root, 0);
		const queue = [root];
		while (queue.length) {
			const cur = queue.shift()!;
			for (const c of childrenOf(edges, cur)) if (!depth.has(c)) {
				depth.set(c, depth.get(cur)! + 1);
				queue.push(c);
			}
		}
	}
	const maxDepth = Math.max(0, ...depth.values());
	const levelSize: number[] = Array.from({ length: maxDepth + 1 }, () => 0);
	for (const [id, d] of depth) levelSize[d] = Math.max(levelSize[d]!, extent(id));
	const offset: number[] = [0];
	for (let d = 1; d <= maxDepth; d++) offset[d] = offset[d - 1]! + levelSize[d - 1]! + opts.levelSpacing;
	for (const [id, p] of pos) {
		const d = depth.get(id) ?? 0;
		// Leading edge of each level lines up; "left"/"up" mirror around the root.
		const main = sign > 0 ? offset[d]! : -offset[d]! - extent(id) + extent(roots(nodes, edges)[0] ?? id);
		pos.set(id, horizontal ? { x: main, y: p.y } : { x: p.x, y: main });
	}
	return pos;
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
		const dir = opts.direction === "radial" || opts.direction === "balanced" ? "right" : opts.direction;
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

	if (opts.direction === "radial") {
		const result = await elk.layout(
			graph(nodes, tree, {
				"elk.algorithm": "radial",
				"elk.spacing.nodeNode": String(opts.spacing),
				"elk.radial.radius": String(opts.levelSpacing + 120),
				"elk.spacing.componentComponent": String(opts.levelSpacing),
			}),
		);
		return anchor(read(result), nodes, firstRoot);
	}

	if (opts.direction === "balanced") {
		// Lay out each tree as two half-trees (right and left) around its root.
		const byId = new Map(nodes.map((n) => [n.id, n]));
		const out: Positions = new Map();
		let offsetY = 0;
		for (const root of rootIds) {
			const kids = childrenOf(tree, root);
			const sizeOf = (id: string) => descendants(tree, id).length + 1;
			const [rightKids, leftKids] = balance(kids, sizeOf);
			const half = async (side: string[], dir: "right" | "left") => {
				const keep = new Set([root, ...side.flatMap((k) => [k, ...descendants(tree, k)])]);
				const sub = nodes.filter((n) => keep.has(n.id));
				return treeLayout(elk, sub, tree.filter((e) => keep.has(e.from) && keep.has(e.to)), dir, opts);
			};
			const right = await half(rightKids, "right");
			const left = await half(leftKids, "left");
			const r0 = right.get(root)!;
			const l0 = left.get(root)!;
			const placed: Positions = new Map();
			for (const [id, p] of right) placed.set(id, { x: p.x - r0.x, y: p.y - r0.y });
			for (const [id, p] of left) if (id !== root) placed.set(id, { x: p.x - l0.x, y: p.y - l0.y });
			const minY = Math.min(...[...placed.values()].map((p) => p.y));
			const maxY = Math.max(...[...placed.entries()].map(([id, p]) => p.y + (byId.get(id)?.height ?? 0)));
			for (const [id, p] of placed) out.set(id, { x: p.x, y: p.y - minY + offsetY });
			offsetY += maxY - minY + opts.levelSpacing;
		}
		// Nodes outside any tree (no root reached them) keep their place.
		for (const n of nodes) if (!out.has(n.id)) out.set(n.id, { x: n.x, y: n.y });
		return anchor(out, nodes, firstRoot);
	}

	return anchor(await treeLayout(elk, nodes, tree, opts.direction, opts), nodes, firstRoot);
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
