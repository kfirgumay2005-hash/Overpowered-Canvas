import { defineModule, type ModuleContext } from "../../core/module";
import type { Point } from "../../data/schema";
import type { CanvasEdgeLike, CanvasLike } from "../../internals/types";
import { capturePointer, mutate, selectedEdges } from "../shared";
import { cubicAt, routeEdge, routingState } from "../edge-routing";
import { insertBend, midpoints, nearestOnPolyline, round, type P } from "./logic";

type Ctx = ModuleContext<object>;

/** The edge's current path as a polyline (a sampled curve for core beziers). */
function pathOf(ctx: Ctx, edge: CanvasEdgeLike): { points: P[]; curved: boolean } {
	const routed = routeEdge(edge, ctx.data.edge(edge).get(), routingState.defaultRoute, 0);
	if (routed) return { points: routed.points, curved: false };
	const bz = edge.bezier;
	if (!bz || bz.from === bz.to) return { points: [], curved: true };
	const pts: P[] = [];
	for (let i = 0; i <= 24; i++) pts.push(cubicAt(i / 24, bz));
	return { points: pts, curved: true };
}

class EdgeHandles {
	private readonly el: HTMLElement;
	private dragging = false;

	constructor(
		private readonly ctx: Ctx,
		private readonly canvas: CanvasLike,
		readonly edge: CanvasEdgeLike,
	) {
		this.el = canvas.canvasEl.createDiv({ cls: "opc-edge-handles" });
		this.render();
	}

	destroy(): void {
		this.el.remove();
	}

	render(): void {
		// While dragging, the handle under the pointer moves itself.
		if (this.dragging) return;
		this.el.empty();
		const extra = this.ctx.data.edge(this.edge).get();
		const { points, curved } = pathOf(this.ctx, this.edge);
		if (points.length < 2) return;
		const waypoints = extra.waypoints ?? [];
		// Existing bend points: drag to move, double-click to remove.
		waypoints.forEach(([x, y], i) => {
			const h = this.handle("opc-edge-bend", { x, y }, this.ctx.t("edgeEditing.bend"));
			h.addEventListener("pointerdown", (e) => this.dragBend(e, i));
			h.addEventListener("dblclick", (e) => {
				e.stopPropagation();
				this.removeBend(i);
			});
		});
		// Pull a new bend out of the middle of each segment (one for a curve).
		const full = curved ? [points[0]!, points[points.length - 1]!] : points;
		const mids = curved ? [points[Math.floor(points.length / 2)]!] : midpoints(full);
		mids.forEach((m, segment) => {
			const h = this.handle("opc-edge-add", m, this.ctx.t("edgeEditing.add"));
			h.addEventListener("pointerdown", (e) => {
				if (e.button !== 0) return;
				const next = insertBend(full, segment, m).map(round);
				this.ctx.data.edge(this.edge).set({ waypoints: next }, { history: false });
				this.edge.updatePath();
				this.dragBend(e, segment);
			});
		});
		// Label position along the path.
		if (this.edge.label) {
			const t = extra.labelT ?? 0.5;
			const at = curved ? cubicAt(t, this.edge.bezier!) : pointOnPolyline(points, t);
			const h = this.handle("opc-edge-label-handle", at, this.ctx.t("edgeEditing.label"));
			h.addEventListener("pointerdown", (e) => this.dragLabel(e));
			h.addEventListener("dblclick", (e) => {
				e.stopPropagation();
				mutate(this.ctx, this.canvas, () => this.ctx.data.edge(this.edge).set({ labelT: undefined }));
				this.edge.updatePath();
			});
		}
	}

	private handle(cls: string, p: P, label: string): HTMLElement {
		const h = this.el.createDiv({ cls: `opc-edge-handle ${cls}`, attr: { "aria-label": label } });
		h.style.left = `${p.x}px`;
		h.style.top = `${p.y}px`;
		return h;
	}

	private gesture(evt: PointerEvent, onMove: (p: P) => void): void {
		if (evt.button !== 0 || this.canvas.readonly) return;
		evt.preventDefault();
		evt.stopPropagation();
		const target = evt.target as HTMLElement;
		capturePointer(target, evt.pointerId);
		this.dragging = true;
		let changed = false;
		const move = (e: PointerEvent) => {
			const p = this.canvas.posFromEvt(e);
			target.style.left = `${p.x}px`;
			target.style.top = `${p.y}px`;
			onMove(p);
			changed = true;
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
			this.dragging = false;
			if (changed) this.canvas.requestSave(); // one undo step for the gesture
			this.render();
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
		target.addEventListener("pointercancel", up);
	}

	private dragBend(evt: PointerEvent, index: number): void {
		this.gesture(evt, (p) => {
			const wps = (this.ctx.data.edge(this.edge).get().waypoints ?? []).slice();
			wps[index] = round(p);
			this.ctx.data.edge(this.edge).set({ waypoints: wps }, { history: false });
			this.edge.updatePath();
		});
	}

	private removeBend(index: number): void {
		const wps = (this.ctx.data.edge(this.edge).get().waypoints ?? []).filter((_, i) => i !== index);
		mutate(this.ctx, this.canvas, () => this.ctx.data.edge(this.edge).set({ waypoints: wps.length ? (wps as Point[]) : undefined }));
		this.edge.updatePath();
		this.render();
	}

	private dragLabel(evt: PointerEvent): void {
		this.gesture(evt, (p) => {
			const { points, curved } = pathOf(this.ctx, this.edge);
			if (points.length < 2) return;
			const near = nearestOnPolyline(points, p);
			// Curves are sampled evenly by parameter, so the sample position is the parameter.
			const t = curved ? (near.segment + nearestOnPolyline([points[near.segment]!, points[near.segment + 1]!], p).t) / (points.length - 1) : near.t;
			this.ctx.data.edge(this.edge).set({ labelT: Math.round(Math.min(0.98, Math.max(0.02, t)) * 1000) / 1000 }, { history: false });
			this.edge.updatePath();
		});
	}
}

function pointOnPolyline(points: P[], t: number): P {
	let total = 0;
	for (let i = 0; i + 1 < points.length; i++) total += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
	let left = total * t;
	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i]!;
		const b = points[i + 1]!;
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		if (left <= len || i + 2 === points.length) {
			const u = len === 0 ? 0 : Math.min(1, left / len);
			return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
		}
		left -= len;
	}
	return points[0]!;
}

/**
 * Edit edges directly: drag the small dots on a selected edge to add bend points, drag bends
 * to move them, double-click a bend to remove it, and drag the label handle to slide the
 * label along the edge (double-click resets it to the middle).
 */
export const edgeEditingModule = defineModule({
	id: "edge-editing",
	name: "edgeEditing.name",
	description: "edgeEditing.desc",
	group: "edges",
	defaultEnabled: true,
	defaultSettings: {},
	dependsOn: ["edge-routing"],

	enable(ctx) {
		const active = new Map<CanvasLike, EdgeHandles>();
		const update = (canvas: CanvasLike) => {
			const edges = selectedEdges(canvas);
			const edge = edges.length === 1 && canvas.selection.size === 1 && !canvas.readonly ? edges[0]! : null;
			const current = active.get(canvas);
			if (current && current.edge === edge) return current.render();
			current?.destroy();
			active.delete(canvas);
			if (edge) active.set(canvas, new EdgeHandles(ctx, canvas, edge));
		};
		for (const canvas of ctx.canvases()) update(canvas);
		ctx.on("selection-change", update);
		ctx.on("readonly-change", update);
		ctx.on("history-apply", update);
		ctx.on("edge-path", (edge) => {
			const h = active.get(edge.canvas);
			if (h && h.edge === edge) h.render();
		});
		ctx.onCanvas((canvas) => () => {
			active.get(canvas)?.destroy();
			active.delete(canvas);
		});
		ctx.register(() => {
			for (const h of active.values()) h.destroy();
			active.clear();
		});
	},
});
