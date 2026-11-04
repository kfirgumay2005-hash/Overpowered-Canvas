/**
 * The map's sibling order on a live canvas (root x-opc `childOrder`, see order.ts): read by
 * layouts and outlines, written by every action that gives a card its place among siblings.
 */
import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { radialKids } from "../auto-layout/radial";
import { axisOf, orderChildren } from "../canvas-markdown/structure";
import { canvasDirection } from "../shared";
import { boardPredecessor, placeChild, pruneOrder, type ChildOrder } from "./order";
import { childrenOf, parentOf, type TEdge, type TNode } from "./tree";

/** What these helpers need from a module: the x-opc data (tutorial demos pass theirs). */
export type OrderHost = Pick<ModuleContext<object>, "data">;

const edgesOf = (canvas: CanvasLike): TEdge[] => [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id }));

/** Cards given a place by an action, with when: a drag that ends in such an action is no hand move. */
const placedAt = new WeakMap<CanvasNodeLike, number>();

export function storedOrder(host: OrderHost, canvas: CanvasLike): ChildOrder {
	return host.data.root(canvas).get().childOrder ?? {};
}

const box = (n: CanvasNodeLike): TNode => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height });

/**
 * `kids` of `parent` as the board shows them, read the way their map grows (its recorded layout:
 * down the side, across, or around for radial maps), else from where they sit.
 */
function onBoard(host: OrderHost, canvas: CanvasLike, parent: CanvasNodeLike, kids: CanvasNodeLike[], stored?: readonly string[]): CanvasNodeLike[] {
	const edges = edgesOf(canvas);
	let root = parent.id;
	const seen = new Set([root]);
	for (let p = parentOf(edges, root); p && !seen.has(p); p = parentOf(edges, root)) {
		seen.add(p);
		root = p;
	}
	const layout = host.data.root(canvas).get().mapLayouts?.[root];
	const rtl = canvasDirection(canvas) === "rtl";
	if (layout === "radial" || layout === "condensed") {
		const up = parentOf(edges, parent.id);
		const above = up ? canvas.nodes.get(up) : undefined;
		const nodes = [parent, ...kids, ...(above ? [above] : [])].map(box);
		const tree = [...(above ? [{ from: above.id, to: parent.id }] : []), ...kids.map((k) => ({ from: parent.id, to: k.id }))];
		const order = radialKids(nodes, tree, stored ? { [parent.id]: stored } : undefined, rtl).get(parent.id) ?? [];
		return order.map((id) => kids.find((k) => k.id === id)!);
	}
	return orderChildren(parent, kids, rtl, stored, axisOf(layout, root === parent.id));
}

/** `parent`'s children (live cards) in map order: stored order first, else as the board shows them. */
export function orderedKids(host: OrderHost, canvas: CanvasLike, parent: CanvasNodeLike, skip?: ReadonlySet<string>): CanvasNodeLike[] {
	const kids = childrenOf(edgesOf(canvas), parent.id)
		.filter((id) => !skip?.has(id))
		.map((id) => canvas.nodes.get(id))
		.filter((n): n is CanvasNodeLike => !!n && n !== parent);
	return onBoard(host, canvas, parent, kids, storedOrder(host, canvas)[parent.id]);
}

/**
 * Records `child`'s place under `parent`: right after `after`, first for null, last for
 * undefined. Call inside the change (transaction) that links it, so one undo takes both back.
 */
export function recordChild(host: OrderHost, canvas: CanvasLike, parent: CanvasNodeLike, child: CanvasNodeLike, after?: string | null): void {
	const current = orderedKids(host, canvas, parent, new Set([child.id])).map((n) => n.id);
	const next = placeChild(storedOrder(host, canvas), parent.id, child.id, current, after);
	host.data.root(canvas).set({ childOrder: pruneOrder(next, (id) => canvas.nodes.has(id)) });
	placedAt.set(child, Date.now());
}

/** `parent`'s children as the board shows them (no stored order). */
export function boardOrder(host: OrderHost, canvas: CanvasLike, parent: CanvasNodeLike): string[] {
	const kids = childrenOf(edgesOf(canvas), parent.id)
		.map((id) => canvas.nodes.get(id))
		.filter((n): n is CanvasNodeLike => !!n && n !== parent);
	return onBoard(host, canvas, parent, kids).map((n) => n.id);
}

/** Whether an action placed `node` since `since` (ms). */
export function placedSince(node: CanvasNodeLike, since: number): boolean {
	return (placedAt.get(node) ?? -Infinity) >= since;
}

/**
 * A card moved by hand (an ordinary drag): when its parent has a stored order, the card takes
 * the place it now shows among its siblings. Parents without one follow the board anyway.
 * Returns whether the order changed.
 */
export function recordHandMove(host: OrderHost, canvas: CanvasLike, parent: CanvasNodeLike, child: CanvasNodeLike): boolean {
	const order = storedOrder(host, canvas);
	if (!order[parent.id]?.length) return false;
	const ordered = orderedKids(host, canvas, parent).map((n) => n.id);
	const byBoard = boardOrder(host, canvas, parent);
	const after = boardPredecessor(ordered.filter((id) => id !== child.id), byBoard, child.id);
	const next = placeChild(order, parent.id, child.id, ordered, after);
	if ((next[parent.id] ?? []).join() === ordered.join()) return false;
	host.data.root(canvas).set({ childOrder: pruneOrder(next, (id) => canvas.nodes.has(id)) });
	return true;
}

/** Writes the whole order (a note's outline, a layout that settled it). */
export function writeOrder(host: OrderHost, canvas: CanvasLike, order: ChildOrder): void {
	host.data.root(canvas).set({ childOrder: pruneOrder(order, (id) => canvas.nodes.has(id)) });
}
