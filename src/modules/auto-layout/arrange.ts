/**
 * Steps shared by every automatic re-arrangement (Auto layout, and a map re-arranged after a
 * card is dropped into it): groups move as blocks or grow around their cards, and edges get the
 * sides that give them a clear path.
 */
import type { ModuleContext } from "../../core/module";
import type { EdgeSide } from "../../data/json-canvas";
import { SCHEMA_KEY } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { layoutMap } from "../canvas-markdown/apply";
import { orderChildren } from "../canvas-markdown/structure";
import { childrenOf, directionBetween, parentOf, type Dir, type TEdge, type TNode } from "../mindmap/tree";
import { canvasDirection, nodeType, isHiddenNode } from "../shared";
import { collapseGroups, expandPositions, fitGroups, groupsAround, type BoxNode } from "./blocks";
import { getElk } from "./engine";
import { chooseSides, type SideBox, type SideEdge } from "./sides";

export type SideMode = "clear" | "facing";

/** What these steps need from a module: the x-opc data (tutorial demos pass theirs). */
export type DataHost = Pick<ModuleContext<object>, "data">;

/** The auto layout settings that other modules' re-arrangements follow too. */
export const arrangeState: { sides: SideMode; bend: boolean } = { sides: "clear", bend: true };

const SIDE: Record<Dir, EdgeSide> = { right: "right", left: "left", down: "bottom", up: "top" };
const OPPOSITE: Record<Dir, EdgeSide> = { right: "left", left: "right", down: "top", up: "bottom" };
const DRAWINGS: ReadonlySet<string> = new Set(["ink", "line", "guide"]);

export function isDrawingNode(n: CanvasNodeLike): boolean {
	return nodeType(n) === "text" && DRAWINGS.has(String((n.unknownData?.[SCHEMA_KEY] as { kind?: string } | undefined)?.kind ?? ""));
}

/** Not shown right now: in a collapsed group or branch, on a hidden layer or another page. */
export function isOutOfView(n: CanvasNodeLike): boolean {
	return n.nodeEl.hasClass("opc-hidden-by-collapse") || n.nodeEl.hasClass("opc-hidden-by-branch") || isHiddenNode(n);
}

const boxOf = (n: CanvasNodeLike): BoxNode => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, group: nodeType(n) === "group" });

/** Every node a layout may move or must keep clear of (not portal copies or hidden ones). */
export function layoutNodes(canvas: CanvasLike): CanvasNodeLike[] {
	return [...canvas.nodes.values()].filter((n) => !n.id.includes("~") && !isOutOfView(n));
}

/**
 * Sides for the edges touching `moved` cards. In "clear" mode each edge takes the sides of its
 * shortest path that passes under no card and crosses no other connector (see sides.ts); edges
 * that can't avoid the cards are routed around them when `bend` is on (and go back to a plain
 * curve once a later layout finds them a clear path). In "facing" mode they join the sides
 * facing each other. Floating ends keep theirs. Call inside a transaction.
 */
export function applyEdgeSides(ctx: DataHost, canvas: CanvasLike, moved: ReadonlySet<string>, sameBlock: (a: string, b: string) => boolean = () => false, growth?: (from: CanvasNodeLike, to: CanvasNodeLike) => Dir | null): void {
	const nodes = layoutNodes(canvas);
	const shown = new Set(nodes.map((n) => n.id));
	const touched = [...canvas.edges.values()].filter((e) => {
		const a = e.from.node.id;
		const b = e.to.node.id;
		return a !== b && (moved.has(a) || moved.has(b)) && shown.has(a) && shown.has(b) && !sameBlock(a, b);
	});
	const facing = (from: CanvasNodeLike, to: CanvasNodeLike): Dir => growth?.(from, to) ?? directionBetween(from, to);
	if (arrangeState.sides === "facing") {
		for (const e of touched) {
			const floating = ctx.data.edge(e).get().floating;
			const dir = facing(e.from.node, e.to.node);
			e.update({ ...e.from, side: floating?.from ? e.from.side : SIDE[dir] }, { ...e.to, side: floating?.to ? e.to.side : OPPOSITE[dir] });
		}
		return;
	}
	const cards: SideBox[] = nodes.filter((n) => nodeType(n) !== "group" && !isDrawingNode(n)).map(boxOf);
	const ids = new Set(touched.map((e) => e.id));
	const edges: SideEdge[] = [];
	for (const e of canvas.edges.values()) {
		if (!shown.has(e.from.node.id) || !shown.has(e.to.node.id)) continue;
		const change = ids.has(e.id);
		const floating = change ? ctx.data.edge(e).get().floating : undefined;
		const dir = change ? facing(e.from.node, e.to.node) : null;
		edges.push({
			id: e.id,
			from: e.from.node.id,
			to: e.to.node.id,
			fromSide: e.from.side,
			toSide: e.to.side,
			keepFrom: !!floating?.from,
			keepTo: !!floating?.to,
			change,
			...(dir ? { preferFrom: SIDE[dir], preferTo: OPPOSITE[dir] } : {}),
		});
	}
	const chosen = chooseSides(cards, edges);
	for (const e of touched) {
		const choice = chosen.get(e.id);
		if (!choice) continue;
		if (choice.fromSide !== e.from.side || choice.toSide !== e.to.side) e.update({ ...e.from, side: choice.fromSide }, { ...e.to, side: choice.toSide });
		const extra = ctx.data.edge(e).get();
		// Bends of our own only: a route or bend points the user chose stay.
		if (choice.blocked && arrangeState.bend && !extra.route && !extra.waypoints) ctx.data.edge(e).set({ route: "astar", bent: true });
		else if (extra.bent && (!choice.blocked || !arrangeState.bend)) ctx.data.edge(e).set({ route: undefined, bent: undefined });
		canvas.markDirty(e);
	}
}

/** The root above `id` along incoming edges (cycle-safe). */
export function mapRootOf(edges: TEdge[], id: string): string {
	let root = id;
	const seen = new Set<string>([id]);
	for (let p = parentOf(edges, root); p && !seen.has(p); p = parentOf(edges, root)) {
		seen.add(p);
		root = p;
	}
	return root;
}

/**
 * Re-arranges a map that has a recorded layout (auto layout, or built from a note) after a card
 * was added to it. Children keep the order they show on the canvas; `after` puts `start` right
 * after that sibling. Groups inside the map move as blocks with everything in them; a group
 * around the whole map stays put and grows to hold it. The root stays where it is.
 * Joins the current undo step (call right after the change that added the card).
 */
export async function relayoutMap(ctx: DataHost, canvas: CanvasLike, start: CanvasNodeLike, after?: string): Promise<void> {
	const all = layoutNodes(canvas);
	const shown = new Map(all.map((n) => [n.id, n]));
	const edges: TEdge[] = [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id })).filter((e) => shown.has(e.from) && shown.has(e.to));
	const root = mapRootOf(edges, start.id);
	const layout = ctx.data.root(canvas).get().mapLayouts?.[root];
	if (!layout || layout === "grid" || layout.startsWith("layered")) return;
	const rtl = canvasDirection(canvas) === "rtl";
	const kids = new Map<string, string[]>();
	const ids: string[] = [];
	const stack = [root];
	const visited = new Set<string>();
	while (stack.length) {
		const id = stack.pop()!;
		if (visited.has(id)) continue;
		visited.add(id);
		ids.push(id);
		const parentNode = shown.get(id)!;
		let children = orderChildren(parentNode, childrenOf(edges, id).filter((c) => !visited.has(c) && shown.has(c)).map((c) => shown.get(c)!), rtl).map((n) => n.id);
		if (after && children.includes(after) && children.includes(start.id)) {
			children = children.filter((c) => c !== start.id);
			children.splice(children.indexOf(after) + 1, 0, start.id);
		}
		kids.set(id, children);
		stack.push(...children);
	}

	// Groups: cards in a group that is part of the map move with it as one block.
	const boxes = all.map(boxOf);
	const isGroup = (id: string) => nodeType(shown.get(id)!) === "group";
	const cardIds = ids.filter((id) => !isGroup(id));
	// The card just placed is laid out on its own, even when it landed over a group.
	const open = groupsAround(boxes, cardIds.filter((id) => id !== start.id));
	const tree = ids.flatMap((id) => (kids.get(id) ?? []).map((c) => ({ from: id, to: c })));
	const blocks = collapseGroups(boxes, new Set(cardIds), new Set(ids.filter(isGroup)), tree, open, new Set([start.id]));
	const blockOf = (id: string) => blocks.blockOf.get(id) ?? id;
	const blockRoot = blockOf(root);
	const blockKids = new Map<string, string[]>();
	const placed = new Set<string>([blockRoot]);
	const order: string[] = [blockRoot];
	for (const id of ids) {
		for (const c of kids.get(id) ?? []) {
			const p = blockOf(id);
			const q = blockOf(c);
			if (p === q || placed.has(q)) continue;
			placed.add(q);
			order.push(q);
			(blockKids.get(p) ?? blockKids.set(p, []).get(p)!).push(q);
		}
	}
	if (order.length < 2) return;
	const byBlock = new Map(blocks.nodes.map((n) => [n.id, n]));
	const tnodes: TNode[] = order.map((id) => byBlock.get(id) ?? boxes.find((b) => b.id === id)!).map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));
	const tedges = order.flatMap((id) => (blockKids.get(id) ?? []).map((c) => ({ from: id, to: c })));
	const pos = await layoutMap(getElk(), tnodes, tedges, blockRoot, blockKids, layout, { rtl, spacing: 30, levelSpacing: 80 });
	if (canvas.readonly) return;
	// Keep the root where it is.
	const anchorBox = tnodes[0]!;
	const p0 = pos.get(blockRoot);
	if (!p0) return;
	const shifted = new Map([...pos].map(([id, p]) => [id, { x: Math.round(p.x + anchorBox.x - p0.x), y: Math.round(p.y + anchorBox.y - p0.y) }]));
	const positions = expandPositions(blocks, shifted, new Map(boxes.map((b) => [b.id, b])));
	const grown = fitGroups(boxes, open, positions);
	const horizontal = layout === "right" || layout === "left" || layout === "balanced";
	try {
		for (const [id, p] of positions) shown.get(id)?.moveTo(p);
		for (const [id, r] of grown) shown.get(id)?.moveAndResize(r);
		// In a map growing sideways (or down), parent → child edges join on those sides by default.
		const inMap = new Set(ids);
		const growth = (from: CanvasNodeLike, to: CanvasNodeLike): Dir | null => {
			if (!inMap.has(from.id) || !inMap.has(to.id)) return null;
			const d = directionBetween(from, to);
			if (horizontal) return d === "right" || d === "left" ? d : from.x + from.width / 2 <= to.x + to.width / 2 ? "right" : "left";
			return d;
		};
		applyEdgeSides(ctx, canvas, new Set(positions.keys()), (a, b) => blocks.blockOf.get(a) !== undefined && blocks.blockOf.get(a) === blocks.blockOf.get(b), growth);
	} finally {
		// Part of the step that added or linked the card: one undo takes both back.
		canvas.requestPushHistory.cancel();
		canvas.overrideHistory();
	}
}
