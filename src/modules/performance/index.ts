import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { SCHEMA_KEY, type OpcNode, type Stroke } from "../../data/schema";
import { unpack } from "../../geometry/ink";
import type { CanvasEdgeLike, CanvasLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { cssColor } from "../minimap/logic";
import { nodeType, onHiddenLayer, renderedZ } from "../shared";

interface PerformanceSettings {
	/** Below this zoom level (0 = 100%, -1 = 50%, …) large canvases switch to the fast renderer. */
	zoom: number;
	/** Only canvases with at least this many cards. */
	minNodes: number;
}

const DEFAULTS: PerformanceSettings = { zoom: -1.7, minNodes: 300 };
/** How long the view must stay still before sharp redraws and deferred work run. */
const SETTLE_MS = 150;
/** Largest cached scene bitmap side, in device pixels. */
const CACHE_MAX = 4096;

interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const strokePaths = new WeakMap<Stroke, Path2D>();
function strokePath(s: Stroke): Path2D {
	let p = strokePaths.get(s);
	if (!p) {
		p = new Path2D();
		const pts = unpack(s.pts);
		// Every other point is plenty when zoomed out.
		pts.forEach((pt, i) => {
			if (i === 0) p!.moveTo(pt.x, pt.y);
			else if (i % 2 === 0 || i === pts.length - 1) p!.lineTo(pt.x, pt.y);
		});
		strokePaths.set(s, p);
	}
	return p;
}

const edgePaths = new WeakMap<CanvasEdgeLike, { d: string; path: Path2D }>();
function edgePath(edge: CanvasEdgeLike): Path2D | null {
	const d = edge.path?.display.getAttribute("d");
	if (!d) return null;
	let cached = edgePaths.get(edge);
	if (!cached || cached.d !== d) edgePaths.set(edge, (cached = { d, path: new Path2D(d) }));
	return cached.path;
}

/**
 * Level-of-detail renderer: when a large canvas is zoomed far out, cards, edges and strokes are
 * drawn as simple shapes on one bitmap instead of painting thousands of DOM elements. The DOM
 * stays in place (invisible), so clicking, selecting and dragging keep working.
 */
interface Palette {
	presets: Record<string, string>;
	bg: string;
	border: string;
	text: string;
	faint: string;
	accent: string;
	font: string;
	dark: boolean;
}

class LodLayer {
	private readonly cv: HTMLCanvasElement;
	private active = false;
	private frame = 0;
	/** Theme colors and the wrapper size, read once instead of every frame (reading forces a style/layout pass). */
	private palette: Palette | null = null;
	private size = { w: 0, h: 0 };
	private readonly resize: ResizeObserver;
	/** Bitmap of the whole scene at `scale`, reused while panning and zooming. */
	private cache: { cv: HTMLCanvasElement; scale: number; minX: number; minY: number; version: number } | null = null;
	private version = 0;
	private bounds: Box | null = null;
	private settle = 0;
	/** Setting ctx.font resolves it against computed style (a style pass over the page): only when it changed. */
	private fontSet = "";
	private lastMove = 0;
	private lastView = "";
	private needsDraw = false;
	private virtualizeTimer = 0;
	private moveTimer = 0;

	constructor(
		private readonly ctx: ModuleContext<PerformanceSettings>,
		private readonly canvas: CanvasLike,
	) {
		this.cv = createEl("canvas", { cls: "opc-lod-layer" });
		canvas.wrapperEl.insertBefore(this.cv, canvas.canvasEl);
		this.size = { w: canvas.wrapperEl.clientWidth, h: canvas.wrapperEl.clientHeight };
		this.resize = new ResizeObserver(([entry]) => {
			if (!entry) return;
			this.size = { w: entry.contentRect.width, h: entry.contentRect.height };
			this.schedule();
		});
		this.resize.observe(canvas.wrapperEl);
		this.update();
	}

	/** Theme changed. */
	restyle(): void {
		this.palette = null;
		this.fontSet = "";
		this.version++;
		this.schedule();
	}

	private colors(): Palette {
		if (this.palette) return this.palette;
		const wrapper = this.canvas.wrapperEl;
		const style = getComputedStyle(wrapper);
		const body = getComputedStyle(wrapper.doc.body);
		const presets: Record<string, string> = {};
		for (let i = 1; i <= 6; i++) presets[String(i)] = body.getPropertyValue(`--canvas-color-${i}`);
		const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
		return (this.palette = {
			presets,
			bg: v("--background-primary", "#fff"),
			border: v("--background-modifier-border", "#ccc"),
			text: v("--text-normal", "#222"),
			faint: v("--text-faint", "#999"),
			accent: v("--color-accent", "#7c3aed"),
			font: v("--font-interface", "sans-serif"),
			dark: wrapper.doc.body.hasClass("theme-dark"),
		});
	}

	destroy(): void {
		this.resize.disconnect();
		this.canvas.wrapperEl.win.clearTimeout(this.settle);
		this.canvas.wrapperEl.win.clearTimeout(this.virtualizeTimer);
		this.canvas.wrapperEl.win.clearTimeout(this.moveTimer);
		this.canvas.wrapperEl.removeClass("opc-lod-moving");
		this.cache = null;
		this.canvas.wrapperEl.win.cancelAnimationFrame(this.frame);
		this.cv.remove();
		this.canvas.wrapperEl.removeClass("opc-lod");
	}

	/**
	 * Pan or zoom happened. While a far-out view moves, the (invisible) cards are taken out of
	 * the layout entirely — styling ~1,000 card elements every frame costs more than drawing the
	 * whole scene — and come back, clickable, once the view settles.
	 */
	moved(): void {
		this.lastMove = performance.now();
		this.update();
		if (!this.active) return;
		const wrapper = this.canvas.wrapperEl;
		wrapper.addClass("opc-lod-moving");
		wrapper.win.clearTimeout(this.moveTimer);
		this.moveTimer = wrapper.win.setTimeout(() => wrapper.removeClass("opc-lod-moving"), SETTLE_MS);
	}

	/**
	 * While a far-out view is moving, the core's per-frame virtualize() (attach/detach cards as
	 * they enter or leave the view, plus a DOM measurement) costs more than everything else.
	 * The cards are invisible in LOD mode, so it runs once the view has settled instead.
	 * Returns true when the call should be skipped now.
	 */
	deferVirtualize(): boolean {
		if (!this.active || performance.now() - this.lastMove > SETTLE_MS) return false;
		const win = this.canvas.wrapperEl.win;
		win.clearTimeout(this.virtualizeTimer);
		this.virtualizeTimer = win.setTimeout(() => (this.canvas as CanvasLike & { virtualize(): void }).virtualize(), SETTLE_MS + 10);
		return true;
	}

	/** Every canvas frame: follow the (possibly animating) view and draw in the same frame. */
	onFrame(): void {
		const c = this.canvas;
		const view = `${c.x},${c.y},${c.zoom}`;
		const moved = view !== this.lastView;
		if (moved) {
			this.lastView = view;
			this.moved();
		}
		if (this.active && (moved || this.needsDraw)) {
			c.wrapperEl.win.cancelAnimationFrame(this.frame);
			this.frame = 0;
			this.needsDraw = false;
			this.draw();
		}
	}

	/** Re-checks the zoom threshold (cheap; called on every viewport change). */
	update(): void {
		const s = this.ctx.settings;
		const active = this.canvas.zoom < s.zoom && this.canvas.nodes.size >= s.minNodes;
		if (active !== this.active) {
			this.active = active;
			this.canvas.wrapperEl.toggleClass("opc-lod", active);
			if (!active) this.canvas.wrapperEl.removeClass("opc-lod-moving");
		}
		if (active) this.schedule();
	}

	/** Draw on the next frame (the core's, or our own if the core doesn't render one). */
	schedule(): void {
		if (!this.active) return;
		this.needsDraw = true;
		if (this.frame) return;
		this.frame = this.canvas.wrapperEl.win.requestAnimationFrame(() => {
			this.frame = 0;
			if (!this.needsDraw) return;
			this.needsDraw = false;
			this.draw();
		});
	}

	/** The scene changed (not just the view): the cached bitmap is stale. */
	invalidate(): void {
		this.version++;
		this.bounds = null;
		this.update();
	}

	private draw(): void {
		const canvas = this.canvas;
		const wrapper = canvas.wrapperEl;
		const { w, h } = this.size;
		const dpr = wrapper.win.devicePixelRatio || 1;
		if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) {
			this.cv.width = Math.round(w * dpr);
			this.cv.height = Math.round(h * dpr);
			this.cv.style.width = `${w}px`;
			this.cv.style.height = `${h}px`;
			this.fontSet = ""; // resizing resets the context state
		}
		const g = this.cv.getContext("2d");
		if (!g) return;
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.clearRect(0, 0, this.cv.width, this.cv.height);
		const scale = canvas.scale;
		// World → screen, like the core: screen = (world - center) * scale + size / 2.
		const ox = w / 2 - canvas.x * scale;
		const oy = h / 2 - canvas.y * scale;
		const bounds = this.contentBounds();
		const fits = !!bounds && Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * scale * dpr <= CACHE_MAX;

		if (bounds && fits) {
			// Pan and zoom reuse one bitmap of the whole scene; it is redrawn sharp once the view settles.
			const c = this.cache;
			const stale = !c || c.version !== this.version || c.scale > scale * 2 || c.scale < scale / 2;
			if (stale) this.renderCache(bounds, scale, dpr);
			else if (Math.abs(c.scale - scale) > 1e-9) {
				wrapper.win.clearTimeout(this.settle);
				this.settle = wrapper.win.setTimeout(() => {
					const b = this.contentBounds();
					if (!this.active || !b) return;
					this.renderCache(b, this.canvas.scale, dpr);
					this.schedule();
				}, SETTLE_MS);
			}
			const cache = this.cache!;
			const k = scale / cache.scale;
			g.setTransform(dpr * k, 0, 0, dpr * k, dpr * (ox + cache.minX * scale), dpr * (oy + cache.minY * scale));
			g.imageSmoothingEnabled = true;
			g.drawImage(cache.cv, 0, 0, cache.cv.width / dpr, cache.cv.height / dpr);
		} else {
			// Too big for one bitmap: draw only what is visible.
			g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
			const view = { minX: canvas.x - w / 2 / scale, minY: canvas.y - h / 2 / scale, maxX: canvas.x + w / 2 / scale, maxY: canvas.y + h / 2 / scale };
			this.paint(g, view, 1 / scale);
		}
		this.overlay(g, scale, ox, oy, dpr);
	}

	private contentBounds(): Box | null {
		if (this.bounds) return this.bounds;
		let b: Box | null = null;
		for (const n of this.canvas.nodes.values()) {
			if (!b) b = { minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height };
			else {
				b.minX = Math.min(b.minX, n.x);
				b.minY = Math.min(b.minY, n.y);
				b.maxX = Math.max(b.maxX, n.x + n.width);
				b.maxY = Math.max(b.maxY, n.y + n.height);
			}
		}
		if (b) {
			const pad = 40;
			b = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
		}
		return (this.bounds = b);
	}

	private renderCache(bounds: Box, scale: number, dpr: number): void {
		const cv = this.cache?.cv ?? createEl("canvas");
		cv.width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * scale * dpr));
		cv.height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * scale * dpr));
		const g = cv.getContext("2d")!;
		g.setTransform(dpr * scale, 0, 0, dpr * scale, -bounds.minX * scale * dpr, -bounds.minY * scale * dpr);
		this.paint(g, bounds, 1 / scale);
		this.cache = { cv, scale, minX: bounds.minX, minY: bounds.minY, version: this.version };
	}

	/** Draws the scene in world coordinates (the transform is already set). */
	private paint(g: CanvasRenderingContext2D, view: Box, px: number): void {
		const canvas = this.canvas;
		const visible = (x: number, y: number, ww: number, hh: number) => x < view.maxX && x + ww > view.minX && y < view.maxY && y + hh > view.minY;
		const { presets, bg, border, text, faint, dark } = this.colors();
		const ink = (c: string) => (dark && c.toLowerCase() === "#1e1e1e" ? "#e8e8e8" : c);
		const nodes = [...canvas.nodes.values()].filter((n) => !onHiddenLayer(n) && visible(n.x, n.y, n.width, n.height)).sort((a, b) => renderedZ(a) - renderedZ(b));

		// Groups.
		for (const n of nodes) {
			if (nodeType(n) !== "group") continue;
			const color = cssColor(n.color, presets);
			g.globalAlpha = 0.08;
			g.fillStyle = color ?? faint;
			g.fillRect(n.x, n.y, n.width, n.height);
			g.globalAlpha = 0.7;
			g.strokeStyle = color ?? faint;
			g.lineWidth = 1.5 * px;
			g.strokeRect(n.x, n.y, n.width, n.height);
			g.globalAlpha = 1;
		}

		// Edges, batched by color.
		const byColor = new Map<string, Path2D>();
		for (const e of canvas.edges.values()) {
			const a = e.from?.node;
			const b = e.to?.node;
			if (!a || !b) continue;
			const minX = Math.min(a.x, b.x);
			const minY = Math.min(a.y, b.y);
			if (!visible(minX, minY, Math.max(a.x + a.width, b.x + b.width) - minX, Math.max(a.y + a.height, b.y + b.height) - minY)) continue;
			const path = edgePath(e);
			if (!path) continue;
			const color = cssColor(e.color, presets) ?? faint;
			let batch = byColor.get(color);
			if (!batch) byColor.set(color, (batch = new Path2D()));
			batch.addPath(path);
		}
		g.lineWidth = 1.5 * px;
		for (const [color, path] of byColor) {
			g.strokeStyle = color;
			g.stroke(path);
		}

		// Cards, shapes, lines and ink.
		for (const n of nodes) {
			if (nodeType(n) === "group") continue;
			const extra = (n.unknownData[SCHEMA_KEY] ?? {}) as OpcNode;
			const color = cssColor(n.color, presets);
			if (extra.kind === "ink" && Array.isArray(extra.strokes)) {
				g.save();
				g.translate(n.x, n.y);
				g.lineCap = "round";
				g.lineJoin = "round";
				for (const s of extra.strokes) {
					g.strokeStyle = ink(s.color);
					g.globalAlpha = s.tool === "highlighter" ? 0.35 : 1;
					g.lineWidth = Math.max(s.size, px);
					g.stroke(strokePath(s));
				}
				g.restore();
				continue;
			}
			if (extra.kind === "line" && extra.line) {
				g.strokeStyle = color ?? text;
				g.lineWidth = Math.max(extra.strokeWidth ?? 2, px);
				g.beginPath();
				extra.line.points.forEach(([x, y], i) => (i === 0 ? g.moveTo(n.x + x, n.y + y) : g.lineTo(n.x + x, n.y + y)));
				g.stroke();
				continue;
			}
			const sticky = extra.kind === "sticky";
			g.fillStyle = sticky ? (color ?? "#fde68a") : bg;
			g.strokeStyle = color ?? border;
			g.lineWidth = 2 * px;
			if (extra.kind === "shape" && extra.shape === "ellipse") {
				g.beginPath();
				g.ellipse(n.x + n.width / 2, n.y + n.height / 2, n.width / 2, n.height / 2, 0, 0, Math.PI * 2);
				g.fill();
				g.stroke();
			} else {
				g.fillRect(n.x, n.y, n.width, n.height);
				if (color && !sticky) {
					g.globalAlpha = 0.12;
					g.fillStyle = color;
					g.fillRect(n.x, n.y, n.width, n.height);
					g.globalAlpha = 1;
				}
				g.strokeRect(n.x, n.y, n.width, n.height);
			}
		}
	}

	/** Selection outlines and group labels, drawn live every frame (they change without the scene). */
	private overlay(g: CanvasRenderingContext2D, scale: number, ox: number, oy: number, dpr: number): void {
		const { accent, text, font } = this.colors();
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.strokeStyle = accent;
		g.lineWidth = 2;
		for (const item of this.canvas.selection) {
			const n = item as { x?: number; y?: number; width?: number; height?: number };
			if (typeof n.x === "number" && typeof n.y === "number" && n.width && n.height) g.strokeRect(n.x * scale + ox, n.y * scale + oy, n.width * scale, n.height * scale);
		}
		g.fillStyle = text;
		const wanted = `600 12px ${font}`;
		if (this.fontSet !== wanted) {
			g.font = wanted;
			g.textBaseline = "bottom";
			this.fontSet = wanted;
		}
		for (const n of this.canvas.nodes.values()) {
			if (!n.label || n.width * scale < 60 || nodeType(n) !== "group") continue;
			const x = n.x * scale + ox;
			const y = n.y * scale + oy;
			if (x > this.size.w || y > this.size.h + 20 || x + n.width * scale < 0 || y < 0) continue;
			g.fillText(n.label, x, y - 4, n.width * scale);
		}
	}
}

/**
 * Performance: a level-of-detail renderer for large canvases zoomed far out (see LodLayer).
 * Measured numbers are in docs/BENCHMARKS.md.
 */
export const performanceModule = defineModule<PerformanceSettings>({
	id: "performance",
	name: "performance.name",
	description: "performance.desc",
	group: "core",
	defaultEnabled: true,
	defaultSettings: DEFAULTS,
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			zoom: typeof s.zoom === "number" && s.zoom >= -6 && s.zoom <= 0 ? s.zoom : defaults.zoom,
			minNodes: typeof s.minNodes === "number" && s.minNodes >= 0 ? Math.round(s.minNodes) : defaults.minNodes,
		};
	},

	enable(ctx) {
		const layers = new Map<CanvasLike, LodLayer>();

		ctx.onCanvas((canvas) => {
			layers.set(canvas, new LodLayer(ctx, canvas));
			return () => {
				layers.get(canvas)?.destroy();
				layers.delete(canvas);
			};
		});

		ctx.on("canvas-frame", (canvas) => layers.get(canvas)?.onFrame());
		ctx.intercept("canvas-virtualize", (canvas) => (layers.get(canvas)?.deferVirtualize() ? true : undefined));
		const changed = (canvas: CanvasLike) => layers.get(canvas)?.invalidate();
		ctx.on("node-moved", (n) => changed(n.canvas));
		ctx.on("node-added", (n) => changed(n.canvas));
		ctx.on("node-removed", (n) => changed(n.canvas));
		ctx.on("node-set-data", (n) => changed(n.canvas));
		ctx.on("node-extra-change", (n) => changed(n.canvas));
		ctx.on("edge-set-data", (e) => changed(e.canvas));
		ctx.on("edge-added", (e) => changed(e.canvas));
		ctx.on("edge-removed", (e) => changed(e.canvas));
		ctx.on("data-load", changed);
		ctx.on("history-apply", changed);
		// Selection is drawn live on top of the cached scene.
		ctx.on("selection-change", (canvas) => layers.get(canvas)?.schedule());
		ctx.onSettingsChange(() => layers.forEach((l) => l.invalidate()));
		ctx.registerEvent(ctx.app.workspace.on("css-change", () => layers.forEach((l) => l.restyle())));
		ctx.register(() => {
			layers.forEach((l) => l.destroy());
			layers.clear();
		});
	},

	renderSettings(el, ctx: ModuleContext<PerformanceSettings>) {
		new Setting(el)
			.setName(ctx.t("performance.zoom.name"))
			.setDesc(ctx.t("performance.zoom.desc"))
			.addSlider((s) => s.setLimits(-4, 0, 0.1).setValue(ctx.settings.zoom).onChange((v) => ctx.updateSettings({ zoom: v })));
		new Setting(el)
			.setName(ctx.t("performance.minNodes.name"))
			.addSlider((s) => s.setLimits(0, 2000, 50).setValue(ctx.settings.minNodes).onChange((v) => ctx.updateSettings({ minNodes: v })));
	},
});
