import { Notice } from "obsidian";
import { syncCanvasRect } from "../../core/canvas-rect";
import { defineModule, type ModuleContext } from "../../core/module";
import type { I18nKey, Translate } from "../../i18n";
import type { Stroke } from "../../data/schema";
import { bounds, eraseFrom, hitsStroke, lassoed, recognize, strokePath, transform, type InkPoint } from "../../geometry/ink";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { attachTarget } from "../free-lines/attach";
import { cornersOf, lineNodeData, shapeNodeData, snapEnds, type P } from "../free-lines/model";
import { capturePointer, claimTool, mutate, nodeType, randomId, releaseTool, selectedNodes } from "../shared";
import { anchorOf, enableAnchors, stickyTargets } from "./anchors";
import { cardUnder } from "./stick";
import { absolutePoints, CARRIER_TEXT, makeStroke, refit, scaleStrokes, shiftStroke } from "./carriers";
import { renderInk } from "./render";
import { DRAWING_DEFAULTS, INK_DEFAULT, InkToolbar, PEN_TOOLS, sanitizePens, type DrawingSettings, type InkTool, type PenTool } from "./toolbar";
import { logError } from "../../core/log";
import { inkHost, type InkSurface } from "./api";

type Ctx = ModuleContext<DrawingSettings>;

function isCarrier(ctx: Ctx, node: CanvasNodeLike): boolean {
	return nodeType(node) === "text" && ctx.data.node(node).get().kind === "ink";
}

/** Names the palette colors for people; other colors stay as they are. */
const COLOR_KEYS: Record<string, I18nKey> = {
	[INK_DEFAULT]: "drawing.color.black",
	"#e03131": "drawing.color.red",
	"#f08c00": "drawing.color.orange",
	"#ffd43b": "drawing.color.yellow",
	"#2f9e44": "drawing.color.green",
	"#1971c2": "drawing.color.blue",
	"#7048e8": "drawing.color.purple",
	"#ffffff": "drawing.color.white",
};
function colorName(t: Translate, color: string): string {
	const key = COLOR_KEYS[color.toLowerCase()];
	return key ? t(key) : color;
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

/** Pen samples closer than this (screen px) to the previous one replace it instead of adding a point. */
const MERGE_PX = 0.5;

/**
 * Adds a pen sample to a stroke. Pens report 120–240 samples a second, many of them less than a
 * pixel apart. The last point is provisional: while the pen stays within `merge` of the point
 * before it, each new sample replaces it (the stroke still ends exactly under the pen); once it
 * gets farther, the sample is added. Kept points are thus at least `merge` apart, slow strokes
 * keep their shape, and the live preview and the stored stroke use the same points, so what is
 * drawn on pen-up is exactly what was shown. The first point always stays.
 */
export function addPoint(points: InkPoint[], next: InkPoint, merge: number): void {
	const kept = points[points.length - 2];
	if (kept && merge > 0 && Math.hypot(next.x - kept.x, next.y - kept.y) < merge) points[points.length - 1] = next;
	else points.push(next);
}

/** Two frames: what was rendered now is on screen. */
function nextPaint(win: Window): Promise<void> {
	return new Promise((resolve) => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
}

/** The board as a surface to draw on. */
function boardSurface(canvas: CanvasLike): InkSurface {
	return {
		host: canvas.wrapperEl,
		toCanvas: (x, y) => canvas.posFromEvt({ clientX: x, clientY: y } as MouseEvent),
		scale: () => canvas.scale,
		placePreview: (svg) => {
			// Last in the board, above every card (see styles.css), and as big as the part of the
			// board on screen (and around it): a tiny layer with overflowing content is not seen as
			// covering cards that have a compositing layer of their own (iPad: cards whose text
			// scrolls), and the stroke would be painted under them.
			if (svg.parentElement !== canvas.canvasEl || svg.nextElementSibling) canvas.canvasEl.appendChild(svg);
			coverView(canvas, svg);
		},
		pan: (dx, dy) => canvas.setViewport(canvas.x - dx / canvas.scale, canvas.y - dy / canvas.scale, canvas.zoom),
		settled: () => nextPaint(canvas.wrapperEl.win),
	};
}

/**
 * Sizes the preview layer to the board area on screen, twice as wide and high around it (the
 * view may move while drawing), in board units; its viewBox keeps board coordinates.
 */
function coverView(canvas: CanvasLike, svg: SVGSVGElement): void {
	// The core's own measure of the view: reading the wrapper's size here would force a layout
	// on every pen move and press.
	const w = canvas.canvasRect?.width || 1000;
	const h = canvas.canvasRect?.height || 1000;
	const scale = canvas.scale || 1;
	const bw = (w / scale) * 2;
	const bh = (h / scale) * 2;
	const x = Math.floor(canvas.x - bw / 2);
	const y = Math.floor(canvas.y - bh / 2);
	const key = `${x},${y},${Math.ceil(bw)},${Math.ceil(bh)}`;
	if (svg.dataset.cover === key) return;
	svg.dataset.cover = key;
	svg.setAttribute("viewBox", `${x} ${y} ${Math.ceil(bw)} ${Math.ceil(bh)}`);
	svg.setCssProps({ "--opc-preview-x": `${x}px`, "--opc-preview-y": `${y}px`, "--opc-preview-w": `${Math.ceil(bw)}px`, "--opc-preview-h": `${Math.ceil(bh)}px` });
}

class InkSession {
	private readonly overlay: HTMLElement;
	private readonly preview: SVGSVGElement;
	/** What the preview draws in: board coordinates. */
	private readonly layer: SVGGElement;
	private readonly hover: SVGCircleElement;
	private readonly toolbar: InkToolbar;
	private current: {
		mode: "draw" | "erase" | "lasso" | "move" | "scale" | "line" | "pan";
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
		/** Line tool: Shift held, draw a straight line. */
		straight?: boolean;
		/** Pen strokes: board distance under which a new sample replaces the last one. */
		merge?: number;
	} | null = null;
	private penUntil = 0;
	/** The drag button: until it is pressed again or a tool is picked, input moves the view. */
	private panning = false;
	private lastCarrier: CanvasNodeLike | null = null;
	/** Lasso selection: carrier → stroke ids. */
	readonly selection = new Map<CanvasNodeLike, Set<string>>();

	constructor(
		private readonly ctx: Ctx,
		private readonly canvas: CanvasLike,
		private readonly surface: InkSurface,
		private readonly onClose: () => void,
		private readonly rerender: (node: CanvasNodeLike) => void,
	) {
		const host = surface.host;
		// A hovering pen shows its brush before any press.
		syncCanvasRect(canvas);
		this.overlay = host.createDiv({ cls: "opc-ink-overlay" });
		this.preview = host.createSvg("svg", { cls: "opc-ink-preview" });
		this.layer = this.preview.createSvg("g");
		surface.placePreview(this.preview, this.layer, Number.NaN, Number.NaN);
		this.hover = this.layer.createSvg("circle", { cls: "opc-ink-hover" });
		this.toolbar = new InkToolbar(host, {
			t: ctx.t,
			settings: () => ctx.settings,
			update: (patch, render = true) => {
				if (patch.tool) this.panning = false;
				void ctx.updateSettings(patch).then(() => {
					if (render) this.toolbar.render();
					this.updateCursor();
				});
			},
			hasSelection: () => this.selection.size > 0,
			lockSelection: () => this.lockSelection(),
			panning: () => this.panning,
			togglePan: () => {
				this.panning = !this.panning;
				this.hover.setAttribute("r", "0");
				this.toolbar.render();
				this.updateCursor();
			},
			close: () => this.onClose(),
			colorName: (color) => colorName(ctx.t, color),
			hiddenTools: surface.inkOnly ? ["line", "arrow"] : [],
		});
		host.addClass("opc-drawing");
		this.overlay.addEventListener("pointerdown", this.onDown);
		this.overlay.addEventListener("pointermove", this.onMove);
		this.overlay.addEventListener("pointerup", this.onUp);
		this.overlay.addEventListener("pointercancel", this.onUp);
		this.overlay.addEventListener("pointerleave", () => this.hover.setAttribute("r", "0"));
		host.win.addEventListener("keydown", this.onKey, true);
		this.updateCursor();
	}

	destroy(): void {
		this.clearSelection();
		this.surface.host.win.removeEventListener("keydown", this.onKey, true);
		this.overlay.remove();
		this.preview.remove();
		this.toolbar.destroy();
		this.surface.host.removeClass("opc-drawing");
	}

	private get tool(): InkTool {
		const tool = this.ctx.settings.tool;
		// Lines and arrows are cards of their own, which a surface for ink only doesn't show.
		return this.surface.inkOnly && (tool === "line" || tool === "arrow") ? "pen" : tool;
	}

	/** The board point under the pointer (inside a gesture, always one). */
	private pos(evt: { clientX: number; clientY: number }): P {
		return this.surface.toCanvas(evt.clientX, evt.clientY, false) ?? { x: 0, y: 0 };
	}

	private updateCursor(): void {
		this.overlay.dataset.tool = this.panning ? "pan" : this.tool;
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
			// Palm navigation or the drag button: fingers pan and zoom (the event reaches the canvas).
			if (this.ctx.settings.penOnly || this.panning) return;
		}
		if (evt.pointerType === "mouse" && evt.button !== 0) return; // middle/right: core panning
		// A pen or mouse can't press twice: the last stroke lost its release (it happens on
		// tablets). Finish it instead of ignoring the pen from now on.
		const stale = this.current;
		if (stale && evt.pointerType !== "touch" && evt.pointerId !== stale.pointerId) this.onUp(new PointerEvent("pointerup", { pointerId: stale.pointerId }));
		if (this.canvas.readonly || this.current) return;
		// Pressing where nothing can be drawn (between the cards of another view): left to it.
		const p = this.panning ? { x: 0, y: 0 } : this.surface.toCanvas(evt.clientX, evt.clientY, true);
		if (!p) return;
		evt.preventDefault();
		evt.stopPropagation();
		capturePointer(this.overlay, evt.pointerId);
		this.surface.placePreview(this.preview, this.layer, evt.clientX, evt.clientY);
		const base = { pointerId: evt.pointerId, points: [] as InkPoint[], erasing: false, changed: false, holdTimer: 0, lastHold: { x: evt.clientX, y: evt.clientY }, recognized: null };
		if (this.panning) {
			this.current = { ...base, mode: "pan" };
			return;
		}
		if (this.tool === "eraser" || eraserInput(evt)) {
			this.current = { ...base, mode: "erase", erasing: true };
			this.eraseAt(p);
			return;
		}
		if (this.tool === "select") {
			const box = this.selectionBox();
			const handle = 12 / this.surface.scale();
			if (box && Math.abs(p.x - box.maxX) < handle && Math.abs(p.y - box.maxY) < handle) return this.startTransform("scale", evt, p, box);
			if (box && p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY) return this.startTransform("move", evt, p, box);
			this.clearSelection();
			this.current = { ...base, mode: "lasso", points: [{ ...p, p: 0.5 }] };
			return;
		}
		if (this.tool === "line" || this.tool === "arrow") {
			this.current = { ...base, mode: "line", points: [{ ...p, p: 0.5 }] };
			this.drawPreview();
			return;
		}
		// Samples closer than about half a screen pixel to the last one replace it (see addPoint).
		this.current = { ...base, mode: "draw", points: [this.point(evt)], merge: MERGE_PX / Math.max(1e-6, this.surface.scale()) };
		this.armHold(evt);
		this.drawPreview();
	};

	private onMove = (evt: PointerEvent) => {
		if (evt.pointerType === "pen") this.penUntil = Date.now() + 800;
		const cur = this.current;
		if (!cur) this.surface.placePreview(this.preview, this.layer, evt.clientX, evt.clientY);
		const over = this.surface.toCanvas(evt.clientX, evt.clientY, false);
		if (over) this.showHover(over, evt);
		else this.hover.setAttribute("r", "0");
		if (!cur || evt.pointerId !== cur.pointerId) return;
		const p = over ?? this.pos(evt);
		evt.preventDefault();
		if (cur.mode === "pan") {
			this.surface.pan(evt.clientX - cur.lastHold.x, evt.clientY - cur.lastHold.y);
			cur.lastHold = { x: evt.clientX, y: evt.clientY };
			return;
		}
		const events = typeof evt.getCoalescedEvents === "function" ? evt.getCoalescedEvents() : [evt];
		if (cur.mode === "erase") {
			for (const e of events.length ? events : [evt]) this.eraseAt(this.pos(e));
			return;
		}
		if (cur.mode === "move" || cur.mode === "scale") return this.applyTransform(p);
		if (cur.mode === "line") {
			// The whole trail: its corners become the line's bend points (Shift: straight).
			for (const e of events.length ? events : [evt]) cur.points.push({ ...this.pos(e), p: 0.5 });
			cur.straight = evt.shiftKey;
			this.drawPreview();
			return;
		}
		if (cur.mode === "lasso") for (const e of events.length ? events : [evt]) cur.points.push({ ...this.pos(e), p: 0.5 });
		else for (const e of events.length ? events : [evt]) addPoint(cur.points, this.point(e), cur.merge ?? 0);
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
		// A drawn stroke's preview stays until the surface shows the committed stroke (no blink).
		if (cur.mode === "draw" && !cur.recognized) this.holdUntilSettled();
		this.layer.querySelectorAll(".opc-ink-live").forEach((el) => el.remove());
		try {
			if (cur.mode === "draw") this.commitStroke(cur.points, cur.recognized);
			else if (cur.mode === "line") this.commitLine(cur.points, !!cur.straight);
			else if (cur.mode === "lasso") this.finishLasso(cur.points);
			else if ((cur.mode === "erase" || cur.mode === "move" || cur.mode === "scale") && cur.changed) {
				// One undo step for the whole gesture.
				this.canvas.requestSave();
				if (cur.mode === "erase") this.ctx.events.emit("strokes-erased", this.canvas, 1);
			}
		} catch (error) {
			logError("[overpowered-canvas] drawing failed", error);
		}
		this.renderSelection();
	};

	/**
	 * Moves the live stroke into a copy of the preview layer that stays where it is until the
	 * surface has drawn the committed stroke (the next stroke may start meanwhile, even on
	 * another card of another view: the copy doesn't follow the preview).
	 */
	private holdUntilSettled(): void {
		const live = Array.from(this.layer.querySelectorAll(".opc-ink-live"));
		const parent = this.preview.parentElement;
		if (!live.length || !parent) return;
		const ghost = this.preview.cloneNode(false) as SVGSVGElement;
		ghost.addClass("opc-ink-settling");
		const layer = this.layer.cloneNode(false) as SVGGElement;
		ghost.appendChild(layer);
		for (const el of live) {
			el.removeClass("opc-ink-live");
			layer.appendChild(el);
		}
		parent.insertBefore(ghost, this.preview);
		const done = () => ghost.remove();
		const win = this.surface.host.win;
		const fallback = win.setTimeout(done, 1500);
		const settled = this.surface.settled?.() ?? nextPaint(win);
		void settled.then(() => {
			win.clearTimeout(fallback);
			done();
		}, done);
	}

	private onKey = (evt: KeyboardEvent) => {
		if ((evt.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable=true]")) return;
		if (this.ctx.isShortcut("drawing.done", evt)) {
			evt.preventDefault();
			evt.stopPropagation();
			// Esc ends drawing only (not the walk or the view it draws on).
			evt.stopImmediatePropagation();
			if (this.selection.size) this.clearSelection();
			else this.onClose();
		} else if (this.selection.size && this.ctx.isShortcut("drawing.delete", evt)) {
			evt.preventDefault();
			evt.stopPropagation();
			this.deleteSelection();
		}
	};

	private point(evt: PointerEvent): InkPoint {
		const p = this.pos(evt);
		const pressure = evt.pointerType === "mouse" ? 0.5 : evt.pressure || 0.5;
		return { x: p.x, y: p.y, p: pressure, ...tiltOf(evt) };
	}

	private armHold(evt: PointerEvent): void {
		const cur = this.current;
		if (!cur || !this.ctx.settings.recognize || this.surface.inkOnly) return;
		window.clearTimeout(cur.holdTimer);
		cur.lastHold = { x: evt.clientX, y: evt.clientY };
		cur.holdTimer = window.setTimeout(() => {
			if (this.current !== cur) return;
			cur.recognized = recognize(cur.points);
			this.drawPreview();
		}, this.ctx.settings.holdMs);
	}

	private showHover(p: P, evt: PointerEvent): void {
		if (evt.pointerType === "touch" || this.panning) return;
		const r = this.tool === "eraser" || eraserInput(evt) ? this.ctx.settings.eraserSize / 2 / this.surface.scale() : this.tool === "select" ? 0 : this.size(this.tool) / 2;
		this.hover.setAttribute("cx", String(p.x));
		this.hover.setAttribute("cy", String(p.y));
		this.hover.setAttribute("r", String(Math.max(0, r)));
		this.hover.style.setProperty("--opc-hover-color", this.tool === "eraser" ? "var(--text-muted)" : this.ctx.settings.color);
	}

	// ---------- preview ----------

	private drawPreview(): void {
		const cur = this.current;
		this.layer.querySelectorAll(".opc-ink-live").forEach((el) => el.remove());
		if (!cur) return;
		const s = this.ctx.settings;
		if (cur.mode === "lasso") {
			const pl = this.layer.createSvg("polyline", { cls: ["opc-ink-live", "opc-ink-lasso"] });
			pl.setAttribute("points", cur.points.map((p) => `${p.x},${p.y}`).join(" "));
			return;
		}
		if (cur.mode === "line") {
			const l = this.layer.createSvg("polyline", { cls: ["opc-ink-live", "opc-ink-line-preview"] });
			const pts = this.lineCorners(cur.points, !!cur.straight);
			l.setAttrs({ points: pts.map((q) => `${q.x},${q.y}`).join(" "), stroke: s.color, "stroke-width": s.sizes.pen, fill: "none" });
			return;
		}
		if (cur.mode !== "draw") return;
		if (cur.recognized) {
			const r = cur.recognized;
			const el =
				r.kind === "line" || r.kind === "arrow"
					? this.layer.createSvg("line", { cls: ["opc-ink-live", "opc-ink-recognized"], attr: { x1: r.from.x, y1: r.from.y, x2: r.to.x, y2: r.to.y } })
					: r.kind === "ellipse"
						? this.layer.createSvg("ellipse", { cls: ["opc-ink-live", "opc-ink-recognized"], attr: { cx: (r.box.minX + r.box.maxX) / 2, cy: (r.box.minY + r.box.maxY) / 2, rx: (r.box.maxX - r.box.minX) / 2, ry: (r.box.maxY - r.box.minY) / 2 } })
						: this.layer.createSvg("rect", { cls: ["opc-ink-live", "opc-ink-recognized"], attr: { x: r.box.minX, y: r.box.minY, width: r.box.maxX - r.box.minX, height: r.box.maxY - r.box.minY } });
			el.setAttribute("stroke", s.color);
			return;
		}
		const tool = this.tool as PenTool;
		const path = this.layer.createSvg("path", { cls: tool === "highlighter" ? ["opc-ink-live", "is-highlighter"] : "opc-ink-live" });
		path.setAttribute("d", strokePath(cur.points, tool, this.size(tool), s.smoothing, !s.pressure));
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
		const style = { tool, color: s.color, size: this.size(tool), smoothing: s.smoothing, uniform: !s.pressure };
		const box = bounds(points, style.size);
		// Drawn on a card: the stroke sticks to it, in that card's own ink.
		const anchor = s.stickToCards ? cardUnder(points, stickyTargets(this.ctx, this.canvas)) : null;
		mutate(this.ctx, this.canvas, () => {
			// Each stroke is its own drawing, unless strokes are set to join the drawing nearby.
			const near = s.groupStrokes ? this.carriersNear(box, 60).filter((c) => (anchorOf(this.ctx, c) ?? null) === anchor) : [];
			const carrier = this.lastCarrier && near.includes(this.lastCarrier) ? this.lastCarrier : near.sort((a, b) => b.zIndex - a.zIndex)[0];
			const id = randomId(8);
			if (!carrier) {
				const origin = { x: box.minX, y: box.minY };
				const fit = refit([makeStroke(id, points, origin, style)], origin)!;
				const created = this.canvas.importData({ nodes: [{ id: randomId(), type: "text", text: CARRIER_TEXT, ...fit.box, "x-opc": { kind: "ink", strokes: fit.strokes, ...(anchor ? { anchor } : {}) } }], edges: [] }, false);
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

	/** The drawn trail as a line: its ends and the corners where it turns. */
	private lineCorners(trail: P[], straight: boolean): P[] {
		const a = trail[0]!;
		const b = trail[trail.length - 1]!;
		if (straight || trail.length < 3) return [a, b];
		const box = (n: CanvasNodeLike | null) => n && { x: n.x, y: n.y, width: n.width, height: n.height };
		return cornersOf(trail, 14 / this.surface.scale(), box(attachTarget(this.ctx, this.canvas, a)), box(attachTarget(this.ctx, this.canvas, b)));
	}

	private commitLine(trail: P[], straight: boolean): void {
		const a = trail[0]!;
		const b = trail[trail.length - 1]!;
		if (trail.length < 2 || Math.hypot(a.x - b.x, a.y - b.y) < 4) return;
		const s = this.ctx.settings;
		const from = attachTarget(this.ctx, this.canvas, a);
		const to = attachTarget(this.ctx, this.canvas, b);
		const points = this.lineCorners(trail, straight);
		mutate(this.ctx, this.canvas, () => {
			this.canvas.importData({ nodes: [lineNodeData(randomId(), snapEnds(points, from, to), { from: from?.id, to: to?.id }, { color: cardColor(s.color), strokeWidth: Math.max(2, Math.round(s.sizes.pen / 2)), ...(this.tool === "arrow" ? { endArrow: "triangle" } : {}) })], edges: [] }, false);
		});
	}

	// ---------- eraser ----------

	private eraseAt(p: P): void {
		const cur = this.current;
		if (!cur) return;
		const r = this.ctx.settings.eraserSize / 2 / this.surface.scale();
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
				logError("[overpowered-canvas] erase failed", error);
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
		this.layer.querySelectorAll(".opc-ink-selection").forEach((el) => el.remove());
		const box = this.selectionBox();
		if (!box) return;
		const rect = this.layer.createSvg("rect", { cls: "opc-ink-selection", attr: { x: box.minX, y: box.minY, width: box.maxX - box.minX, height: box.maxY - box.minY } });
		rect.style.strokeWidth = `${1.5 / this.surface.scale()}px`;
		const h = 10 / this.surface.scale();
		this.layer.createSvg("rect", { cls: ["opc-ink-selection", "opc-ink-handle"], attr: { x: box.maxX - h / 2, y: box.maxY - h / 2, width: h, height: h } });
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
 * palm navigation (fingers pan), a drag button (any input pans) and the pen's eraser end are
 * supported. P toggles, Esc exits.
 */
export const drawingModule = defineModule<DrawingSettings>({
	id: "drawing",
	name: "drawing.name",
	description: "drawing.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: DRAWING_DEFAULTS,
	overlapsWith: ["canvas-kit"],
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return { ...s, pressure: typeof s.pressure === "boolean" ? s.pressure : defaults.pressure, pens: sanitizePens((raw as { pens?: unknown } | undefined)?.pens, defaults.pens) };
	},

	enable(ctx) {
		const sessions = new Map<CanvasLike, InkSession>();
		/** Drawings being resized by hand → the size their strokes are laid out for. */
		const resizing = new Map<CanvasNodeLike, { width: number; height: number }>();
		const rerender = (node: CanvasNodeLike) => {
			const extra = ctx.data.node(node).get();
			if (extra.kind === "ink") renderInk(node, extra.strokes ?? [], sessions.get(node.canvas)?.selectedOf(node) ?? new Set(), forward(node), resizing.get(node));
		};
		/** Clicking ink selects / drags its carrier like a card (the card box itself is click-through). */
		const forward = (node: CanvasNodeLike) => (evt: PointerEvent) => (node as unknown as { onPointerdown(e: PointerEvent): void }).onPointerdown(evt);

		/**
		 * Performance with a lot of handwriting: each stroke is a card of its own, and while the
		 * view zooms or pans the core detaches every card that leaves the view. Before detaching,
		 * `preDetach()` saves the scroll and focus state of the card's content, which reads layout
		 * (`offsetParent`, `scrollTop`) in between the DOM changes of the same frame: one forced
		 * layout per card. Drawings have no content to save (their text is empty), so they skip it.
		 */
		const patchedProtos = new WeakSet<object>();
		const patchedBreakpoints = new WeakSet<object>();
		const isInkEl = (n: CanvasNodeLike) => n.nodeEl.getAttribute("data-opc-kind") === "ink";
		const patchDetach = (node: CanvasNodeLike) => {
			for (let proto = Object.getPrototypeOf(node) as object | null; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
				if (Object.prototype.hasOwnProperty.call(proto, "preDetach") && !patchedProtos.has(proto)) {
					patchedProtos.add(proto);
					ctx.patch("node.preDetach (drawing)", proto as CanvasNodeLike & { preDetach(): void }, {
						preDetach: (next) =>
							function (this: CanvasNodeLike) {
								if (isInkEl(this)) return;
								return next.call(this);
							},
					});
				}
				// A drawing's card never shows its (empty) text: its content stays unmounted at every
				// zoom, so zooming past the content breakpoint mounts and lays out nothing for it.
				if (Object.prototype.hasOwnProperty.call(proto, "updateBreakpoint") && !patchedBreakpoints.has(proto)) {
					patchedBreakpoints.add(proto);
					ctx.patch("node.updateBreakpoint (drawing)", proto as CanvasNodeLike & { updateBreakpoint(show: boolean): void }, {
						updateBreakpoint: (next) =>
							function (this: CanvasNodeLike, show: boolean) {
								return next.call(this, isInkEl(this) ? false : show);
							},
					});
				}
			}
		};

		ctx.decorateNodes({
			apply: (node, extra) => {
				patchDetach(node);
				if (extra.kind === "ink" && nodeType(node) === "text") renderInk(node, extra.strokes ?? [], sessions.get(node.canvas)?.selectedOf(node) ?? new Set(), forward(node), resizing.get(node));
				else if (node.nodeEl.getAttribute("data-opc-kind") === "ink") renderInk(node, undefined, new Set(), forward(node));
			},
			clear: (node) => {
				if (node.nodeEl.getAttribute("data-opc-kind") === "ink") renderInk(node, undefined, new Set(), forward(node));
			},
		});
		enableAnchors(ctx);

		// Resizing a drawing's card stretches the strokes with it: live while dragging (the
		// drawing is scaled to the box), written into the strokes when the handle is let go.
		ctx.on("node-moved", (node) => {
			if (resizing.has(node)) rerender(node);
		});
		ctx.onCanvas((canvas) => {
			const win = canvas.wrapperEl.win;
			const onDown = (evt: PointerEvent) => {
				const handle = (evt.target as Element | null)?.closest(".canvas-node-resizer");
				if (!handle || canvas.readonly) return;
				const layer = canvas.nodeInteractionLayer;
				const nodes = layer && handle.parentElement === layer.interactionEl ? (layer.target ? [layer.target] : []) : selectedNodes(canvas);
				for (const n of nodes) if (isCarrier(ctx, n) && !ctx.data.node(n).get().locked) resizing.set(n, { width: n.width, height: n.height });
			};
			const onUp = () => {
				const mine = [...resizing].filter(([n]) => n.canvas === canvas);
				if (!mine.length) return;
				// Let the core finish the resize first.
				win.setTimeout(() => {
					const changed: [CanvasNodeLike, { width: number; height: number }][] = [];
					for (const [node, from] of mine) {
						resizing.delete(node);
						if (Math.abs(node.width - from.width) > 0.5 || Math.abs(node.height - from.height) > 0.5) changed.push([node, from]);
						else rerender(node);
					}
					if (!changed.length) return;
					try {
						// Joins the core's pending undo step for the resize.
						for (const [node, from] of changed) {
							const strokes = ctx.data.node(node).get().strokes ?? [];
							const fit = refit(scaleStrokes(strokes, from, node), node);
							if (!fit) continue;
							node.moveAndResize(fit.box);
							ctx.data.node(node).set({ strokes: fit.strokes });
							rerender(node);
						}
						canvas.requestSave();
					} catch (error) {
						logError("[overpowered-canvas] drawing: resizing a drawing failed", error);
					}
				});
			};
			canvas.wrapperEl.addEventListener("pointerdown", onDown, true);
			win.addEventListener("pointerup", onUp, true);
			win.addEventListener("pointercancel", onUp, true);
			return () => {
				canvas.wrapperEl.removeEventListener("pointerdown", onDown, true);
				win.removeEventListener("pointerup", onUp, true);
				win.removeEventListener("pointercancel", onUp, true);
			};
		});

		// Drawings saved with many strokes in one card: split them into one drawing per stroke.
		const split = (canvas: CanvasLike) => {
			const chosen = selectedNodes(canvas).filter((n) => isCarrier(ctx, n));
			const carriers = (chosen.length ? chosen : [...canvas.nodes.values()].filter((n) => isCarrier(ctx, n))).filter((c) => !ctx.data.node(c).get().locked && (ctx.data.node(c).get().strokes ?? []).length > 1);
			let count = 0;
			mutate(ctx, canvas, () => {
				for (const carrier of carriers) {
					const extra = ctx.data.node(carrier).get();
					const [first, ...rest] = extra.strokes ?? [];
					if (!first) continue;
					for (const stroke of rest) {
						const fit = refit([stroke], carrier);
						if (!fit) continue;
						canvas.importData({ nodes: [{ id: randomId(), type: "text", text: CARRIER_TEXT, ...fit.box, "x-opc": { kind: "ink", strokes: fit.strokes, ...(extra.anchor ? { anchor: extra.anchor } : {}) } }], edges: [] }, false);
						count++;
					}
					const keep = refit([first], carrier)!;
					carrier.moveAndResize(keep.box);
					ctx.data.node(carrier).set({ strokes: keep.strokes });
				}
			});
			new Notice(ctx.t("drawing.split.done", { count: String(count) }));
		};
		ctx.addCommand({
			id: "split-ink",
			name: ctx.t("drawing.split"),
			icon: "ungroup",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) split(canvas);
				return true;
			},
		});
		// Ink cards are not text to edit.
		ctx.intercept("node-start-editing", (node) => (isCarrier(ctx, node) ? true : undefined));

		const ended = new Map<CanvasLike, () => void>();
		const stop = (canvas: CanvasLike) => {
			releaseTool(canvas, "drawing");
			const session = sessions.get(canvas);
			if (!session) return;
			sessions.delete(canvas);
			session.destroy();
			ctx.events.emit("drawing-mode-changed", canvas, null);
			const onEnd = ended.get(canvas);
			ended.delete(canvas);
			onEnd?.();
		};
		const start = (canvas: CanvasLike, surface: InkSurface = boardSurface(canvas), onEnd?: () => void) => {
			if (sessions.has(canvas)) stop(canvas);
			if (canvas.readonly) return;
			// The lasso or the highlighter ends first.
			claimTool(canvas, "drawing", () => stop(canvas));
			canvas.deselectAll();
			sessions.set(canvas, new InkSession(ctx, canvas, surface, () => stop(canvas), rerender));
			if (onEnd) ended.set(canvas, onEnd);
			ctx.events.emit("drawing-mode-changed", canvas, ctx.settings.tool);
		};
		const toggle = (canvas: CanvasLike) => (sessions.has(canvas) ? stop(canvas) : start(canvas));
		inkHost.api = { start, stop, active: (canvas) => sessions.has(canvas) };

		ctx.addCanvasKey({ shortcut: "drawing.toggle", handle: (canvas) => (canvas.readonly ? false : (toggle(canvas), true)) });
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
			inkHost.api = null;
			for (const canvas of [...sessions.keys()]) stop(canvas);
		});
	},
});

