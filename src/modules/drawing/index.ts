import { defineModule, type ModuleContext } from "../../core/module";
import type { Stroke } from "../../data/schema";
import { bounds, eraseFrom, hitsStroke, lassoed, recognize, strokePath, transform, type InkPoint } from "../../geometry/ink";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { attachTarget } from "../free-lines/attach";
import { lineNodeData, shapeNodeData, snapEnds, type P } from "../free-lines/model";
import { capturePointer, mutate, nodeType, randomId } from "../shared";
import { absolutePoints, CARRIER_TEXT, makeStroke, refit, shiftStroke } from "./carriers";
import { renderInk } from "./render";
import { DRAWING_DEFAULTS, INK_DEFAULT, InkToolbar, PEN_TOOLS, type DrawingSettings, type InkTool, type PenTool } from "./toolbar";

type Ctx = ModuleContext<DrawingSettings>;

function isCarrier(ctx: Ctx, node: CanvasNodeLike): boolean {
	return nodeType(node) === "text" && ctx.data.node(node).get().kind === "ink";
}

/** Lines and shapes in the default ink color keep the theme's text color instead. */
const cardColor = (color: string) => (color === INK_DEFAULT ? undefined : color);

/** Converts PointerEvent tilt data (tiltX/Y or altitude/azimuth) to degrees. */
function tiltOf(evt: PointerEvent): { tiltX?: number; tiltY?: number } {
	if (evt.tiltX || evt.tiltY) return { tiltX: evt.tiltX, tiltY: evt.tiltY };
	const e = evt as PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };
	if (typeof e.altitudeAngle === "number" && typeof e.azimuthAngle === "number" && e.altitudeAngle < Math.PI / 2) {
		const tilt = 90 - (e.altitudeAngle * 180) / Math.PI;
		return { tiltX: Math.round(tilt * Math.cos(e.azimuthAngle)), tiltY: Math.round(tilt * Math.sin(e.azimuthAngle)) };
	}
	return {};
}

/** Pen eraser end, or the barrel button held while drawing. */
function eraserInput(evt: PointerEvent): boolean {
	return evt.pointerType === "pen" && ((evt.buttons & 32) !== 0 || evt.button === 5 || (evt.buttons & 2) !== 0);
}

class InkSession {
	private readonly overlay: HTMLElement;
	private readonly preview: SVGSVGElement;
	private readonly hover: SVGCircleElement;
	private readonly toolbar: InkToolbar;
	private current: {
		mode: "draw" | "erase" | "lasso" | "move" | "scale" | "line";
		pointerId: number;
		points: InkPoint[];
		erasing: boolean;
		changed: boolean;
		holdTimer: number;
		lastHold: { x: number; y: number };
		recognized: ReturnType<typeof recognize>;
		origin?: P;
		originals?: Map<CanvasNodeLike, Stroke[]>;
		box?: { minX: number; minY: number; maxX: number; maxY: number };
	} | null = null;
	private penUntil = 0;
	private lastCarrier: CanvasNodeLike | null = null;
	/** Lasso selection: carrier → stroke ids. */
	readonly selection = new Map<CanvasNodeLike, Set<string>>();

	constructor(
		private readonly ctx: Ctx,
		private readonly canvas: CanvasLike,
		private readonly onClose: () => void,
		private readonly rerender: (node: CanvasNodeLike) => void,
	) {
		const wrapper = canvas.wrapperEl;
		this.overlay = wrapper.createDiv({ cls: "opc-ink-overlay" });
		this.preview = canvas.canvasEl.createSvg("svg", { cls: "opc-ink-preview" });
		this.hover = this.preview.createSvg("circle", { cls: "opc-ink-hover" });
		this.toolbar = new InkToolbar(wrapper, {
			t: ctx.t,
			settings: () => ctx.settings,
			update: (patch) => {
				void ctx.updateSettings(patch).then(() => {
					this.toolbar.render();
					this.updateCursor();
				});
			},
			hasSelection: () => this.selection.size > 0,
			lockSelection: () => this.lockSelection(),
			close: () => this.onClose(),
		});
		wrapper.addClass("opc-drawing");
		this.overlay.addEventListener("pointerdown", this.onDown);
		this.overlay.addEventListener("pointermove", this.onMove);
		this.overlay.addEventListener("pointerup", this.onUp);
		this.overlay.addEventListener("pointercancel", this.onUp);
		this.overlay.addEventListener("pointerleave", () => this.hover.setAttribute("r", "0"));
		wrapper.win.addEventListener("keydown", this.onKey, true);
		this.updateCursor();
	}

	destroy(): void {
		this.clearSelection();
		this.canvas.wrapperEl.win.removeEventListener("keydown", this.onKey, true);
		this.overlay.remove();
		this.preview.remove();
		this.toolbar.destroy();
		this.canvas.wrapperEl.removeClass("opc-drawing");
	}

	private get tool(): InkTool {
		return this.ctx.settings.tool;
	}

	private updateCursor(): void {
		this.overlay.dataset.tool = this.tool;
	}

	private size(tool: InkTool): number {
		return (PEN_TOOLS as readonly string[]).includes(tool) ? this.ctx.settings.sizes[tool as PenTool] : this.ctx.settings.sizes.pen;
	}

	// ---------- pointer handling ----------

	private onDown = (evt: PointerEvent) => {
		if (evt.pointerType === "pen") this.penUntil = Date.now() + 800;
		if (evt.pointerType === "touch") {
			// Palm rejection: ignore touches while a pen is in use.
			if (Date.now() < this.penUntil) {
				evt.preventDefault();
				evt.stopPropagation();
				return;
			}
			// Pen-only mode: fingers pan and zoom (the event reaches the canvas).
			if (this.ctx.settings.penOnly) return;
		}
		if (evt.pointerType === "mouse" && evt.button !== 0) return; // middle/right: core panning
		if (this.canvas.readonly || this.current) return;
		evt.preventDefault();
		evt.stopPropagation();
		capturePointer(this.overlay, evt.pointerId);
		const p = this.canvas.posFromEvt(evt);
		const base = { pointerId: evt.pointerId, points: [] as InkPoint[], erasing: false, changed: false, holdTimer: 0, lastHold: { x: evt.clientX, y: evt.clientY }, recognized: null };
		if (this.tool === "eraser" || eraserInput(evt)) {
			this.current = { ...base, mode: "erase", erasing: true };
			this.eraseAt(p);
			return;
		}
		if (this.tool === "select") {
			const box = this.selectionBox();
			const handle = 12 / this.canvas.scale;
			if (box && Math.abs(p.x - box.maxX) < handle && Math.abs(p.y - box.maxY) < handle) return this.startTransform("scale", evt, p, box);
			if (box && p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY) return this.startTransform("move", evt, p, box);
			this.clearSelection();
			this.current = { ...base, mode: "lasso", points: [{ ...p, p: 0.5 }] };
			return;
		}
		if (this.tool === "line" || this.tool === "arrow") {
			this.current = { ...base, mode: "line", points: [{ ...p, p: 0.5 }, { ...p, p: 0.5 }] };
			this.drawPreview();
			return;
		}
		this.current = { ...base, mode: "draw", points: [this.point(evt)] };
		this.armHold(evt);
		this.drawPreview();
	};

	private onMove = (evt: PointerEvent) => {
		if (evt.pointerType === "pen") this.penUntil = Date.now() + 800;
		const p = this.canvas.posFromEvt(evt);
		this.showHover(p, evt);
		const cur = this.current;
		if (!cur || evt.pointerId !== cur.pointerId) return;
		evt.preventDefault();
		const events = typeof evt.getCoalescedEvents === "function" ? evt.getCoalescedEvents() : [evt];
		if (cur.mode === "erase") {
			for (const e of events.length ? events : [evt]) this.eraseAt(this.canvas.posFromEvt(e));
			return;
		}
		if (cur.mode === "move" || cur.mode === "scale") return this.applyTransform(p);
		if (cur.mode === "line") {
			cur.points[1] = { ...p, p: 0.5 };
			this.drawPreview();
			return;
		}
		for (const e of events.length ? events : [evt]) cur.points.push(cur.mode === "lasso" ? { ...this.canvas.posFromEvt(e), p: 0.5 } : this.point(e));
		if (cur.mode === "draw" && Math.hypot(evt.clientX - cur.lastHold.x, evt.clientY - cur.lastHold.y) > 4) {
			cur.recognized = null;
			this.armHold(evt);
		}
		this.drawPreview();
	};

	private onUp = (evt: PointerEvent) => {
		const cur = this.current;
		if (!cur || evt.pointerId !== cur.pointerId) return;
		this.current = null;
		window.clearTimeout(cur.holdTimer);
		this.preview.querySelectorAll(".opc-ink-live").forEach((el) => el.remove());
		try {
			if (cur.mode === "draw") this.commitStroke(cur.points, cur.recognized);
			else if (cur.mode === "line") this.commitLine(cur.points[0]!, cur.points[1]!);
			else if (cur.mode === "lasso") this.finishLasso(cur.points);
			else if ((cur.mode === "erase" || cur.mode === "move" || cur.mode === "scale") && cur.changed) {
				// One undo step for the whole gesture.
				this.canvas.requestSave();
				if (cur.mode === "erase") this.ctx.events.emit("strokes-erased", this.canvas, 1);
			}
		} catch (error) {
			console.error("[overpowered-canvas] drawing failed", error);
		}
		this.renderSelection();
	};

	private onKey = (evt: KeyboardEvent) => {
		if ((evt.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable=true]")) return;
		if (evt.key === "Escape") {
			evt.preventDefault();
			evt.stopPropagation();
			if (this.selection.size) this.clearSelection();
			else this.onClose();
		} else if ((evt.key === "Delete" || evt.key === "Backspace") && this.selection.size) {
			evt.preventDefault();
			evt.stopPropagation();
			this.deleteSelection();
		}
	};

	private point(evt: PointerEvent): InkPoint {
		const p = this.canvas.posFromEvt(evt);
		const pressure = evt.pointerType === "mouse" ? 0.5 : evt.pressure || 0.5;
		return { x: p.x, y: p.y, p: pressure, ...tiltOf(evt) };
	}

	private armHold(evt: PointerEvent): void {
		const cur = this.current;
		if (!cur || !this.ctx.settings.recognize) return;
		window.clearTimeout(cur.holdTimer);
		cur.lastHold = { x: evt.clientX, y: evt.clientY };
		cur.holdTimer = window.setTimeout(() => {
			if (this.current !== cur) return;
			cur.recognized = recognize(cur.points);
			this.drawPreview();
		}, this.ctx.settings.holdMs);
	}

	private showHover(p: P, evt: PointerEvent): void {
		if (evt.pointerType === "touch") return;
		const r = this.tool === "eraser" || eraserInput(evt) ? this.ctx.settings.eraserSize / 2 / this.canvas.scale : this.tool === "select" ? 0 : this.size(this.tool) / 2;
		this.hover.setAttribute("cx", String(p.x));
		this.hover.setAttribute("cy", String(p.y));
		this.hover.setAttribute("r", String(Math.max(0, r)));
		this.hover.style.setProperty("--opc-hover-color", this.tool === "eraser" ? "var(--text-muted)" : this.ctx.settings.color);
	}

	// ---------- preview ----------

	private drawPreview(): void {
		const cur = this.current;
		this.preview.querySelectorAll(".opc-ink-live").forEach((el) => el.remove());
		if (!cur) return;
		const s = this.ctx.settings;
		if (cur.mode === "lasso") {
			const pl = this.preview.createSvg("polyline", { cls: ["opc-ink-live", "opc-ink-lasso"] });
			pl.setAttribute("points", cur.points.map((p) => `${p.x},${p.y}`).join(" "));
			return;
		}
		if (cur.mode === "line") {
			const [a, b] = cur.points;
			const l = this.preview.createSvg("line", { cls: ["opc-ink-live", "opc-ink-line-preview"] });
			l.setAttrs({ x1: a!.x, y1: a!.y, x2: b!.x, y2: b!.y, stroke: s.color, "stroke-width": s.sizes.pen });
			return;
		}
		if (cur.mode !== "draw") return;
		if (cur.recognized) {
			const r = cur.recognized;
			const el =
				r.kind === "line" || r.kind === "arrow"
					? this.preview.createSvg("line", { cls: ["opc-ink-live", "opc-ink-recognized"], attr: { x1: r.from.x, y1: r.from.y, x2: r.to.x, y2: r.to.y } })
					: r.kind === "ellipse"
						? this.preview.createSvg("ellipse", { cls: ["opc-ink-live", "opc-ink-recognized"], attr: { cx: (r.box.minX + r.box.maxX) / 2, cy: (r.box.minY + r.box.maxY) / 2, rx: (r.box.maxX - r.box.minX) / 2, ry: (r.box.maxY - r.box.minY) / 2 } })
						: this.preview.createSvg("rect", { cls: ["opc-ink-live", "opc-ink-recognized"], attr: { x: r.box.minX, y: r.box.minY, width: r.box.maxX - r.box.minX, height: r.box.maxY - r.box.minY } });
			el.setAttribute("stroke", s.color);
			return;
		}
		const tool = this.tool as PenTool;
		const path = this.preview.createSvg("path", { cls: tool === "highlighter" ? ["opc-ink-live", "is-highlighter"] : "opc-ink-live" });
		path.setAttribute("d", strokePath(cur.points, tool, this.size(tool), s.smoothing));
		path.setAttribute("fill", s.color);
		path.style.opacity = tool === "highlighter" ? "0.35" : tool === "pencil" ? "0.85" : "1";
	}

	// ---------- committing ----------

	private carriersNear(box: { minX: number; minY: number; maxX: number; maxY: number }, margin = 0): CanvasNodeLike[] {
		return this.canvas
			.getIntersectingNodes({ minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin })
			.filter((n) => isCarrier(this.ctx, n) && !this.ctx.data.node(n).get().locked && !n.id.includes("~"));
	}

	private commitStroke(points: InkPoint[], recognized: ReturnType<typeof recognize>): void {
		if (points.length === 0) return;
		const s = this.ctx.settings;
		const tool = this.tool as PenTool;
		if (recognized) return this.commitShape(recognized);
		if (points.length === 1) points.push({ ...points[0]!, x: points[0]!.x + 0.1 });
		const style = { tool, color: s.color, size: this.size(tool), smoothing: s.smoothing };
		const box = bounds(points, style.size);
		mutate(this.ctx, this.canvas, () => {
			const near = this.carriersNear(box, 60);
			const carrier = this.lastCarrier && near.includes(this.lastCarrier) ? this.lastCarrier : near.sort((a, b) => b.zIndex - a.zIndex)[0];
			const id = randomId(8);
			if (!carrier) {
				const origin = { x: box.minX, y: box.minY };
				const fit = refit([makeStroke(id, points, origin, style)], origin)!;
				const created = this.canvas.importData({ nodes: [{ id: randomId(), type: "text", text: CARRIER_TEXT, ...fit.box, "x-opc": { kind: "ink", strokes: fit.strokes } }], edges: [] }, false);
				this.lastCarrier = created ? [...created][0] ?? null : null;
			} else {
				const origin = { x: carrier.x, y: carrier.y };
				const strokes = [...(this.ctx.data.node(carrier).get().strokes ?? []), makeStroke(id, points, origin, style)];
				const fit = refit(strokes, origin)!;
				carrier.moveAndResize(fit.box);
				this.ctx.data.node(carrier).set({ strokes: fit.strokes });
				this.lastCarrier = carrier;
			}
			if (this.lastCarrier) this.ctx.events.emit("stroke-added", this.canvas, this.lastCarrier, id);
		});
	}

	private commitShape(r: NonNullable<ReturnType<typeof recognize>>): void {
		const s = this.ctx.settings;
		mutate(this.ctx, this.canvas, () => {
			const id = randomId();
			if (r.kind === "line" || r.kind === "arrow") {
				this.canvas.importData({ nodes: [lineNodeData(id, [r.from, r.to], {}, { color: cardColor(s.color), strokeWidth: Math.max(2, Math.round(s.sizes.pen / 2)), ...(r.kind === "arrow" ? { endArrow: "triangle" } : {}) })], edges: [] }, false);
			} else {
				const shape = r.kind === "ellipse" ? "ellipse" : r.kind === "triangle" ? "triangle" : "rectangle";
				this.canvas.importData({ nodes: [shapeNodeData(id, shape, { x: r.box.minX, y: r.box.minY, width: r.box.maxX - r.box.minX, height: r.box.maxY - r.box.minY }, { color: cardColor(s.color), strokeWidth: Math.max(2, Math.round(s.sizes.pen / 2)) })], edges: [] }, false);
			}
			const node = this.canvas.nodes.get(id);
			if (node) this.ctx.events.emit("shape-created", this.canvas, node);
		});
	}

	private commitLine(a: P, b: P): void {
		if (Math.hypot(a.x - b.x, a.y - b.y) < 4) return;
		const s = this.ctx.settings;
		const from = attachTarget(this.ctx, this.canvas, a);
		const to = attachTarget(this.ctx, this.canvas, b);
		mutate(this.ctx, this.canvas, () => {
			this.canvas.importData({ nodes: [lineNodeData(randomId(), snapEnds([a, b], from, to), { from: from?.id, to: to?.id }, { color: cardColor(s.color), strokeWidth: Math.max(2, Math.round(s.sizes.pen / 2)), ...(this.tool === "arrow" ? { endArrow: "triangle" } : {}) })], edges: [] }, false);
		});
	}

	// ---------- eraser ----------

	private eraseAt(p: P): void {
		const cur = this.current;
		if (!cur) return;
		const r = this.ctx.settings.eraserSize / 2 / this.canvas.scale;
		const partial = this.ctx.settings.eraserMode === "partial";
		for (const carrier of this.carriersNear({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y }, r)) {
			const origin = { x: carrier.x, y: carrier.y };
			const strokes = this.ctx.data.node(carrier).get().strokes ?? [];
			let changed = false;
			const next: Stroke[] = [];
			for (const s of strokes) {
				const pts = absolutePoints(s, origin);
				if (s.locked || !hitsStroke(p, r, pts, s.size)) {
					next.push(s);
					continue;
				}
				changed = true;
				if (partial) for (const run of eraseFrom(pts, p, r + s.size / 2)) next.push(makeStroke(randomId(8), run, origin, s));
			}
			if (!changed) continue;
			cur.changed = true;
			try {
				if (next.length === 0) {
					this.canvas.removeNode(carrier);
					if (this.lastCarrier === carrier) this.lastCarrier = null;
					continue;
				}
				const fit = refit(next, origin)!;
				carrier.moveAndResize(fit.box);
				this.ctx.data.node(carrier).set({ strokes: fit.strokes }, { history: false });
			} catch (error) {
				console.error("[overpowered-canvas] erase failed", error);
			}
		}
	}

	// ---------- lasso selection ----------

	private finishLasso(lasso: InkPoint[]): void {
		if (lasso.length < 3) return;
		const box = bounds(lasso);
		for (const carrier of this.carriersNear(box)) {
			const origin = { x: carrier.x, y: carrier.y };
			const ids = new Set<string>();
			for (const s of this.ctx.data.node(carrier).get().strokes ?? []) if (lassoed(absolutePoints(s, origin), lasso)) ids.add(s.id);
			if (ids.size) this.selection.set(carrier, ids);
		}
		for (const c of this.selection.keys()) this.rerender(c);
		this.toolbar.render();
	}

	selectedOf(carrier: CanvasNodeLike): ReadonlySet<string> {
		return this.selection.get(carrier) ?? new Set();
	}

	private selectionBox(): { minX: number; minY: number; maxX: number; maxY: number } | null {
		const pts: P[] = [];
		for (const [carrier, ids] of this.selection) {
			if (!this.canvas.nodes.has(carrier.id)) continue;
			for (const s of this.ctx.data.node(carrier).get().strokes ?? []) if (ids.has(s.id)) pts.push(...absolutePoints(s, carrier));
		}
		return pts.length ? bounds(pts, 6) : null;
	}

	private renderSelection(): void {
		this.preview.querySelectorAll(".opc-ink-selection").forEach((el) => el.remove());
		const box = this.selectionBox();
		if (!box) return;
		const rect = this.preview.createSvg("rect", { cls: "opc-ink-selection", attr: { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY } });
		rect.style.strokeWidth = `${1.5 / this.canvas.scale}px`;
		const h = 10 / this.canvas.scale;
		this.preview.createSvg("rect", { cls: ["opc-ink-selection", "opc-ink-handle"], attr: { x: box.maxX - h / 2, y: box.maxY - h / 2, width: h, height: h } });
	}

	private clearSelection(): void {
		const carriers = [...this.selection.keys()];
		this.selection.clear();
		for (const c of carriers) this.rerender(c);
		this.renderSelection();
		this.toolbar?.render();
	}

	private startTransform(mode: "move" | "scale", evt: PointerEvent, p: P, box: { minX: number; minY: number; maxX: number; maxY: number }): void {
		const originals = new Map<CanvasNodeLike, Stroke[]>();
		for (const carrier of this.selection.keys()) originals.set(carrier, this.ctx.data.node(carrier).get().strokes ?? []);
		this.current = { mode, pointerId: evt.pointerId, points: [], erasing: false, changed: false, holdTimer: 0, lastHold: { x: 0, y: 0 }, recognized: null, origin: p, originals, box };
	}

	private applyTransform(p: P): void {
		const cur = this.current;
		if (!cur?.origin || !cur.originals || !cur.box) return;
		const box = cur.box;
		let dx = p.x - cur.origin.x;
		let dy = p.y - cur.origin.y;
		let scale = 1;
		if (cur.mode === "scale") {
			const w = Math.max(1, box.maxX - box.minX);
			const h = Math.max(1, box.maxY - box.minY);
			scale = Math.max(0.05, Math.max((box.maxX + dx - box.minX) / w, (box.maxY + dy - box.minY) / h));
			dx = 0;
			dy = 0;
		}
		for (const [carrier, strokes] of cur.originals) {
			const ids = this.selection.get(carrier);
			if (!ids) continue;
			const origin = { x: carrier.x, y: carrier.y };
			const next = strokes.map((s) => {
				if (!ids.has(s.id) || s.locked) return s;
				const pts = transform(absolutePoints(s, origin), dx, dy, scale, { x: box.minX, y: box.minY });
				return { ...makeStroke(s.id, pts, origin, s), ...(s.locked ? { locked: true } : {}), size: Math.max(0.5, Math.round(s.size * scale * 10) / 10) };
			});
			const fit = refit(next, origin);
			if (!fit) continue;
			carrier.moveAndResize(fit.box);
			this.ctx.data.node(carrier).set({ strokes: fit.strokes }, { history: false });
			// The next frame's originals are relative to the moved carrier.
			cur.originals.set(carrier, strokes.map((s) => shiftStroke(s, origin.x - fit.box.x, origin.y - fit.box.y)));
			cur.changed = true;
		}
		this.renderSelection();
	}

	private deleteSelection(): void {
		mutate(this.ctx, this.canvas, () => {
			for (const [carrier, ids] of this.selection) {
				const strokes = (this.ctx.data.node(carrier).get().strokes ?? []).filter((s) => !ids.has(s.id) || s.locked);
				if (strokes.length === 0) this.canvas.removeNode(carrier);
				else {
					const fit = refit(strokes, carrier)!;
					carrier.moveAndResize(fit.box);
					this.ctx.data.node(carrier).set({ strokes: fit.strokes });
				}
			}
		});
		this.selection.clear();
		this.renderSelection();
		this.toolbar.render();
	}

	private lockSelection(): void {
		const lockedAll = [...this.selection].every(([c, ids]) => (this.ctx.data.node(c).get().strokes ?? []).filter((s) => ids.has(s.id)).every((s) => s.locked));
		mutate(this.ctx, this.canvas, () => {
			for (const [carrier, ids] of this.selection) {
				const strokes = (this.ctx.data.node(carrier).get().strokes ?? []).map((s) => {
					if (!ids.has(s.id)) return s;
					const { locked: _l, ...rest } = s;
					return lockedAll ? rest : { ...rest, locked: true };
				});
				this.ctx.data.node(carrier).set({ strokes });
			}
		});
		for (const c of this.selection.keys()) this.rerender(c);
	}
}

/**
 * Freehand drawing layer: pen, pencil, marker, highlighter, eraser (whole strokes or partial),
 * lasso to select / move / scale / delete / lock strokes, lines and arrows, and shape
 * recognition (hold still at the end of a stroke). Stylus pressure and tilt, palm rejection,
 * pen-only mode (fingers pan) and the pen's eraser end are supported. P toggles, Esc exits.
 */
export const drawingModule = defineModule<DrawingSettings>({
	id: "drawing",
	name: "drawing.name",
	description: "drawing.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: DRAWING_DEFAULTS,
	overlapsWith: ["canvas-kit"],
	sanitizeSettings: (raw, defaults) => mergeWithDefaults(raw, defaults),

	enable(ctx) {
		const sessions = new Map<CanvasLike, InkSession>();
		const rerender = (node: CanvasNodeLike) => {
			const extra = ctx.data.node(node).get();
			if (extra.kind === "ink") renderInk(node, extra.strokes ?? [], sessions.get(node.canvas)?.selectedOf(node) ?? new Set(), forward(node));
		};
		/** Clicking ink selects / drags its carrier like a card (the card box itself is click-through). */
		const forward = (node: CanvasNodeLike) => (evt: PointerEvent) => (node as unknown as { onPointerdown(e: PointerEvent): void }).onPointerdown(evt);

		ctx.decorateNodes({
			apply: (node, extra) => {
				if (extra.kind === "ink" && nodeType(node) === "text") renderInk(node, extra.strokes ?? [], sessions.get(node.canvas)?.selectedOf(node) ?? new Set(), forward(node));
				else if (node.nodeEl.getAttribute("data-opc-kind") === "ink") renderInk(node, undefined, new Set(), forward(node));
			},
			clear: (node) => {
				if (node.nodeEl.getAttribute("data-opc-kind") === "ink") renderInk(node, undefined, new Set(), forward(node));
			},
		});
		// Ink cards are not text to edit.
		ctx.intercept("node-start-editing", (node) => (isCarrier(ctx, node) ? true : undefined));

		const stop = (canvas: CanvasLike) => {
			const session = sessions.get(canvas);
			if (!session) return;
			sessions.delete(canvas);
			session.destroy();
			ctx.events.emit("drawing-mode-changed", canvas, null);
		};
		const start = (canvas: CanvasLike) => {
			if (sessions.has(canvas) || canvas.readonly) return;
			canvas.deselectAll();
			sessions.set(canvas, new InkSession(ctx, canvas, () => stop(canvas), rerender));
			ctx.events.emit("drawing-mode-changed", canvas, ctx.settings.tool);
		};
		const toggle = (canvas: CanvasLike) => (sessions.has(canvas) ? stop(canvas) : start(canvas));

		ctx.addCanvasKey({ modifiers: [], key: "P", handle: (canvas) => (canvas.readonly ? false : (toggle(canvas), true)) });
		ctx.onCanvas((canvas) => () => stop(canvas));
		ctx.on("readonly-change", (canvas) => canvas.readonly && stop(canvas));

		ctx.addCommand({
			id: "toggle-drawing",
			name: ctx.t("drawing.command"),
			icon: "pen-tool",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) toggle(canvas);
				return true;
			},
		});
		ctx.addCardMenuButton({
			id: "drawing",
			icon: "pen-tool",
			tooltip: () => ctx.t("drawing.command"),
			order: 120,
			onClick: (canvas) => toggle(canvas),
		});
		ctx.register(() => {
			for (const canvas of [...sessions.keys()]) stop(canvas);
		});
	},
});

