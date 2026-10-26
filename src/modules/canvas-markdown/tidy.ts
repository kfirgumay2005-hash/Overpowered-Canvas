/**
 * Order-preserving tree layout (pure). ELK's tree algorithm reorders siblings, which would
 * shuffle an outline on its way to the canvas and back, so directional and balanced maps are
 * laid out here: children keep their outline order along the cross axis, each parent centered
 * on its children, levels aligned on the main axis.
 */
import type { TNode } from "../mindmap/tree";

export type TidyDirection = "right" | "left" | "down" | "up" | "balanced";

export interface TidyOptions {
	direction: TidyDirection;
	/** Gap between siblings. */
	spacing: number;
	/** Gap between levels. */
	levelSpacing: number;
	/** Right-to-left: siblings of down/up maps run right to left. */
	rtl: boolean;
}

type Positions = Map<string, { x: number; y: number }>;

/** Lays out the tree under `root` (children in the given order); the root stays where it is. */
export function tidyTree(nodes: TNode[], children: Map<string, string[]>, root: string, opts: TidyOptions): Positions {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const r = byId.get(root)!;
	if (opts.direction === "balanced") {
		const kids = children.get(root) ?? [];
		const half = Math.ceil(kids.length / 2);
		// Clockwise reading: the forward side top to bottom, then the other side bottom to top.
		const forward = translate(side(byId, new Map([...children, [root, kids.slice(0, half)]]), root, opts.rtl ? "left" : "right", opts), r);
		const back = translate(side(byId, new Map([...children, [root, kids.slice(half).reverse()]]), root, opts.rtl ? "right" : "left", opts), r);
		return new Map([...back, ...forward]);
	}
	return translate(side(byId, children, root, opts.direction, opts), r);
}

/** Moves positions so the root lands on its current place. */
function translate(pos: Positions, root: TNode): Positions {
	const p = pos.get(root.id)!;
	const dx = root.x - p.x;
	const dy = root.y - p.y;
	const out: Positions = new Map();
	for (const [id, v] of pos) out.set(id, { x: Math.round(v.x + dx), y: Math.round(v.y + dy) });
	return out;
}

function side(byId: Map<string, TNode>, children: Map<string, string[]>, root: string, dir: "right" | "left" | "down" | "up", opts: TidyOptions): Positions {
	const horizontal = dir === "right" || dir === "left";
	const main = (n: TNode) => (horizontal ? n.width : n.height);
	const cross = (n: TNode) => (horizontal ? n.height : n.width);
	const kidsOf = (id: string) => (children.get(id) ?? []).filter((k) => byId.has(k));

	// Level offsets along the main axis: every level starts after the widest card of the one before.
	const depth = new Map<string, number>([[root, 0]]);
	const levelSize: number[] = [];
	const order = [root];
	for (let i = 0; i < order.length; i++) {
		const id = order[i]!;
		const d = depth.get(id)!;
		levelSize[d] = Math.max(levelSize[d] ?? 0, main(byId.get(id)!));
		for (const k of kidsOf(id))
			if (!depth.has(k)) {
				depth.set(k, d + 1);
				order.push(k);
			}
	}
	const offset: number[] = [0];
	for (let d = 1; d < levelSize.length; d++) offset[d] = offset[d - 1]! + levelSize[d - 1]! + opts.levelSpacing;

	// Cross axis: subtree extents, children stacked in order, parent centered on them.
	const extent = new Map<string, number>();
	const measure = (id: string): number => {
		const kids = kidsOf(id).filter((k) => depth.get(k) === depth.get(id)! + 1);
		const block = kids.reduce((sum, k) => sum + measure(k), 0) + Math.max(0, kids.length - 1) * opts.spacing;
		const e = Math.max(cross(byId.get(id)!), block);
		extent.set(id, e);
		return e;
	};
	measure(root);
	const flip = !horizontal && opts.rtl;
	const crossPos = new Map<string, number>();
	const place = (id: string, start: number) => {
		const n = byId.get(id)!;
		const kids = kidsOf(id).filter((k) => depth.get(k) === depth.get(id)! + 1);
		const e = extent.get(id)!;
		const block = kids.reduce((sum, k) => sum + extent.get(k)!, 0) + Math.max(0, kids.length - 1) * opts.spacing;
		crossPos.set(id, start + (e - cross(n)) / 2);
		let cur = start + (e - block) / 2;
		for (const k of flip ? [...kids].reverse() : kids) {
			place(k, cur);
			cur += extent.get(k)! + opts.spacing;
		}
	};
	place(root, 0);

	const rootMain = main(byId.get(root)!);
	const out: Positions = new Map();
	for (const [id, c] of crossPos) {
		const n = byId.get(id)!;
		const d = depth.get(id)!;
		const forward = dir === "right" || dir === "down";
		const m = forward ? offset[d]! : rootMain - offset[d]! - main(n);
		out.set(id, horizontal ? { x: m, y: c } : { x: c, y: m });
	}
	return out;
}
