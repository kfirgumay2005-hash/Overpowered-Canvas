import { defineModule, type ModuleContext } from "../../core/module";
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
		});
		// Pull a new bend out of the middle of each segment (one for a curve).
		const full = curved ? [points[0]!, points[points.length - 1]!] : points;
		const mids = curved ? [points[Math.floor(points.length / 2)]!] : midpoints(full);
		mids.forEach((m, segment) => {
			const h = this.handle("opc-edge-add", m, this.ctx.t("edgeEditing.add"));
			// The bend appears once the pointer moves: a tap (or the first click of a double-click
			// on the label under this dot) changes nothing.
			h.addEventListener("pointerdown", (e) => {
				let added = false;
				this.gesture(e, (p) => {
					const wps = added ? (this.ctx.data.edge(this.edge).get().waypoints ?? []).slice() : insertBend(full, segment, m).map(round);
					added = true;
					wps[segment] = round(p);
					this.ctx.data.edge(this.edge).set({ waypoints: wps }, { history: false });
					this.edge.updatePath();
				});
			});
		});
		// Label position along the path.
		if (this.edge.label) {
			const t = extra.labelT ?? 0.5;
			const at = curved ? cubicAt(t, this.edge.bezier!) : pointOnPolyline(points, t);
			const h = this.handle("opc-edge-label-handle", at, this.ctx.t("edgeEditing.label"));
			h.addEventListener("pointerdown", (e) => this.dragLabel(e));
		}
	}

	/**
	 * Dots in the middle of the edge sit on its label. A double-click there edits the label, as it
	 * would without the dots. The dots are hidden first so the core puts the caret in the label
	 * text, not in a dot that the next render removes.
	 */
	private editLabelAt(evt: MouseEvent): boolean {
		const label = this.edge.labelElement;
		const text = label?.textareaEl;
		if (!label?.focus || !text) return false;
		const r = text.getBoundingClientRect();
		if (evt.clientX < r.left || evt.clientX > r.right || evt.clientY < r.top || evt.clientY > r.bottom) return false;
		evt.preventDefault();
		this.el.hide();
		try {
			label.focus({ x: evt.clientX, y: evt.clientY });
		} finally {
			this.el.show();
		}
		return true;
	}

	private handle(cls: string, p: P, label: string): HTMLElement {
		const h = this.el.createDiv({ cls: `opc-edge-handle ${cls}`, attr: { "aria-label": label } });
		h.style.left = `${p.x}px`;
		h.style.top = `${p.y}px`;
		return h;
	}

	/**
	 * A press on a dot: drags it once the pointer moves. Dots are drawn again after every press,
	 * so the browser never sees two clicks on the same one and sends no dblclick: a second press
	 * in the same spot is the double-click. On the label it edits the label (the first click
	 * selected the edge and brought the dots up over it); elsewhere it runs `onDouble`.
	 */
	private gesture(evt: PointerEvent, onMove: (p: P) => void, onDouble?: () => void): void {
		if (evt.button !== 0 || this.canvas.readonly) return;
		if (secondPress.get(this.canvas)) {
			if (this.editLabelAt(evt)) {
				evt.stopPropagation();
				return;
			}
			if (onDouble) {
				evt.preventDefault();
				evt.stopPropagation();
				onDouble();
				return;
			}
		}
		evt.preventDefault();
		evt.stopPropagation();
		const target = evt.target as HTMLElement;
		capturePointer(target, evt.pointerId);
		this.dragging = true;
		let changed = false;
		const start = { x: evt.clientX, y: evt.clientY };
		const move = (e: PointerEvent) => {
			// A click is not a drag: ignore the jitter of a press.
			if (!changed && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
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
		this.gesture(
			evt,
			(p) => {
				const wps = (this.ctx.data.edge(this.edge).get().waypoints ?? []).slice();
				wps[index] = round(p);
				this.ctx.data.edge(this.edge).set({ waypoints: wps }, { history: false });
				this.edge.updatePath();
			},
			() => this.removeBend(index),
		);
	}

	private removeBend(index: number): void {
		const wps = (this.ctx.data.edge(this.edge).get().waypoints ?? []).filter((_, i) => i !== index);
		mutate(this.ctx, this.canvas, () => this.ctx.data.edge(this.edge).set({ waypoints: wps.length ? wps : undefined }));
		this.edge.updatePath();
		this.render();
	}

	private dragLabel(evt: PointerEvent): void {
		this.gesture(
			evt,
			(p) => {
				const { points, curved } = pathOf(this.ctx, this.edge);
				if (points.length < 2) return;
				const near = nearestOnPolyline(points, p);
				// Curves are sampled evenly by parameter, so the sample position is the parameter.
				const t = curved ? (near.segment + nearestOnPolyline([points[near.segment]!, points[near.segment + 1]!], p).t) / (points.length - 1) : near.t;
				this.ctx.data.edge(this.edge).set({ labelT: Math.round(Math.min(0.98, Math.max(0.02, t)) * 1000) / 1000 }, { history: false });
				this.edge.updatePath();
			},
			() => {
				mutate(this.ctx, this.canvas, () => this.ctx.data.edge(this.edge).set({ labelT: undefined }));
				this.edge.updatePath();
				this.render();
			},
		);
	}
}

/** Whether the latest press on a canvas came right after another one in the same spot. */
const secondPress = new WeakMap<CanvasLike, boolean>();
const DOUBLE_PRESS_MS = 500;
const DOUBLE_PRESS_PX = 8;
/** On the canvas element while an edge label has the focus. */
const LABEL_EDITING = "opc-edge-label-editing";

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
		ctx.onCanvas((canvas) => {
			let last = { t: -Infinity, x: 0, y: 0 };
			const onDown = (e: PointerEvent) => {
				secondPress.set(canvas, e.timeStamp - last.t < DOUBLE_PRESS_MS && Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_PRESS_PX);
				last = { t: e.timeStamp, x: e.clientX, y: e.clientY };
			};
			canvas.wrapperEl.addEventListener("pointerdown", onDown, true);
			return () => canvas.wrapperEl.removeEventListener("pointerdown", onDown, true);
		});
		// While a label is being typed in, the dots step aside (a class, not a :has() selector).
		ctx.onCanvas((canvas) => {
			const isLabel = (el: EventTarget | null) => el instanceof HTMLElement && el.matches(".canvas-path-label");
			const onIn = (e: FocusEvent) => canvas.canvasEl.toggleClass(LABEL_EDITING, isLabel(e.target));
			const onOut = (e: FocusEvent) => canvas.canvasEl.toggleClass(LABEL_EDITING, isLabel(e.relatedTarget));
			canvas.canvasEl.addEventListener("focusin", onIn);
			canvas.canvasEl.addEventListener("focusout", onOut);
			return () => {
				canvas.canvasEl.removeEventListener("focusin", onIn);
				canvas.canvasEl.removeEventListener("focusout", onOut);
				canvas.canvasEl.removeClass(LABEL_EDITING);
			};
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
