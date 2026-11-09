import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { storedOrder } from "../mindmap/order-store";
import type { TNode } from "../mindmap/tree";
import { pagesHost } from "../pages/api";
import { nodeType } from "../shared";
import { groupEdges, type WalkBox, type WalkEdge } from "./walk";

/** Ink, drawn lines and infinite lines are marks on the board, not cards of a map. */
const DRAWINGS: ReadonlySet<string> = new Set(["ink", "line", "guide"]);

/** Cards (and groups) a view of the map shows. Cards on other pages count: a walk can go there. */
export function shownInMap(node: CanvasNodeLike): boolean {
	const el = node.nodeEl;
	return !node.id.includes("~") && !el.hasClass("opc-hidden-by-collapse") && !el.hasClass("opc-hidden-by-branch") && !el.hasClass("opc-layer-hidden");
}

/**
 * The map as the walk, the column view and the table of contents see it: cards and groups joined
 * by their edges, with groups read as cards (see groupEdges). With `page`, only that page's cards
 * (views that show a page at a time); without it, every page, a card whose branch was moved to a
 * page leading to that page.
 */
export function mapModel(ctx: ModuleContext<object>, canvas: CanvasLike, page?: string) {
	const nodes = new Map<string, TNode>();
	const boxes: WalkBox[] = [];
	const api = pagesHost.api;
	for (const n of canvas.nodes.values()) {
		if (!shownInMap(n) || DRAWINGS.has(ctx.data.node(n).get().kind ?? "")) continue;
		const on = api ? api.pageOf(n) : "";
		if (page !== undefined && api && on !== page) continue;
		const box = { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
		nodes.set(n.id, box);
		boxes.push({ ...box, group: nodeType(n) === "group", page: on });
	}
	const edges: WalkEdge[] = [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id })).filter((e) => nodes.has(e.from) && nodes.has(e.to));
	const pageLinks: WalkEdge[] = [];
	if (page === undefined) for (const link of api?.links(canvas) ?? []) if (nodes.has(link.anchor) && nodes.has(link.root)) pageLinks.push({ from: link.anchor, to: link.root });
	// A page lies in a region of its own: where it is says nothing about the card it hangs from.
	return { nodes, edges: [...groupEdges(boxes, edges), ...pageLinks], order: storedOrder(ctx, canvas) };
}
