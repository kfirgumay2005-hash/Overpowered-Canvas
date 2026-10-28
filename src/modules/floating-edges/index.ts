import { defineModule } from "../../core/module";
import { bestSide } from "../../geometry/routing";
import type { CanvasEdgeLike, CanvasLike, CanvasNodeLike, Point } from "../../internals/types";
import { nodeType } from "../shared";
import { logError } from "../../core/log";

/** The central drop zone: the middle half of the node in both directions. */
function inDropZone(node: CanvasNodeLike, p: Point): boolean {
	const qx = node.width / 4;
	const qy = node.height / 4;
	return p.x > node.x + qx && p.x < node.x + node.width - qx && p.y > node.y + qy && p.y < node.y + node.height - qy;
}

const center = (n: CanvasNodeLike): Point => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });

/**
 * Floating edge ends: drop an edge end on the drop zone in the middle of a card and that end
 * always attaches to the side facing the other end, even after the cards move.
 */
export const floatingEdgesModule = defineModule({
	id: "floating-edges",
	name: "floatingEdges.name",
	description: "floatingEdges.desc",
	group: "edges",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		// Before the core computes the path, re-pick the side of floating ends.
		ctx.intercept("edge-update-path", (edge) => {
			const floating = ctx.data.edge(edge).get().floating;
			if (!floating) return undefined;
			if (floating.from) edge.from.side = bestSide(edge.from.node.getBBox(), center(edge.to.node));
			if (floating.to) edge.to.side = bestSide(edge.to.node.getBBox(), center(edge.from.node));
			return undefined;
		});

		// Moving a node changes which side faces the other end.
		ctx.on("node-moved", (node) => {
			for (const edge of node.canvas.getEdgesForNode(node)) {
				const floating = ctx.data.edge(edge).get().floating;
				if (floating?.from || floating?.to) node.canvas.markMoved(edge);
			}
		});

		// Track connection drags (new edges from a connection point, or dragging an edge end).
		ctx.onCanvas((canvas) => {
			let before: Set<CanvasEdgeLike> | null = null;
			let dragged: CanvasEdgeLike | null = null;
			const onDown = (evt: PointerEvent) => {
				const target = evt.target as Element | null;
				if (!target || canvas.readonly) return;
				if (target.closest(".canvas-node-connection-point")) {
					before = new Set(canvas.edges.values());
					dragged = null;
				} else if (target.closest(".canvas-edges g")) {
					const g = target.closest("g");
					dragged = [...canvas.edges.values()].find((e) => e.lineGroupEl === g) ?? null;
					before = dragged ? new Set(canvas.edges.values()) : null;
				}
			};
			const onUp = (evt: PointerEvent) => {
				if (!before) return;
				const known = before;
				const edgeDragged = dragged;
				before = null;
				dragged = null;
				const pos = canvas.posFromEvt(evt);
				// Let the core finish connecting first.
				window.setTimeout(() => settle(canvas, known, edgeDragged, pos));
			};
			canvas.wrapperEl.addEventListener("pointerdown", onDown, true);
			canvas.wrapperEl.win.addEventListener("pointerup", onUp, true);
			return () => {
				canvas.wrapperEl.removeEventListener("pointerdown", onDown, true);
				canvas.wrapperEl.win.removeEventListener("pointerup", onUp, true);
			};
		});

		const settle = (canvas: CanvasLike, known: Set<CanvasEdgeLike>, dragged: CanvasEdgeLike | null, pos: Point) => {
			const edge = dragged && canvas.edges.has(dragged.id) ? dragged : [...canvas.edges.values()].find((e) => !known.has(e));
			if (!edge) return;
			const target = canvas
				.getIntersectingNodes({ minX: pos.x, minY: pos.y, maxX: pos.x, maxY: pos.y })
				.filter((n) => nodeType(n) !== "group" || n === edge.to.node || n === edge.from.node)
				.find((n) => n === edge.to.node || n === edge.from.node);
			if (!target) return;
			const end = edge.to.node === target ? "to" : "from";
			const floating = { ...ctx.data.edge(edge).get().floating };
			const want = inDropZone(target, pos);
			if (!!floating[end] === want) return;
			if (want) floating[end] = true;
			else delete floating[end];
			try {
				// Joins the core's pending undo step (same debounce window).
				ctx.data.edge(edge).set({ floating: Object.keys(floating).length ? floating : undefined });
				canvas.markMoved(edge);
			} catch (error) {
				logError("[overpowered-canvas] floating edge update failed", error);
			}
		};
	},
});
