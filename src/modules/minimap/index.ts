import { setIcon, setTooltip, Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { SCHEMA_KEY, type OpcNode } from "../../data/schema";
import { unpack } from "../../geometry/ink";
import type { CanvasLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { pagesHost } from "../pages/api";
import { capturePointer, nodeType, isHiddenNode, renderedZ } from "../shared";
import { cssColor, fitTransform, toMap, toWorld, unionBox, type Box, type MapTransform } from "./logic";

const CORNERS = ["top-start", "top-end", "bottom-start", "bottom-end"] as const;
type Corner = (typeof CORNERS)[number];

interface MinimapSettings {
	visible: boolean;
	corner: Corner;
	width: number;
}

// Top-start is the one corner the core leaves free (controls: top-end, card bar: bottom).
const DEFAULTS: MinimapSettings = { visible: true, corner: "top-start", width: 220 };
const PAD = 8;
/** Above this many cards, strokes are drawn as boxes. */
const DETAIL_LIMIT = 3000;

/** The visible world rectangle, from the transform (getViewportBBox() measures the DOM). */
function viewOf(canvas: CanvasLike, size: { w: number; h: number }): Box {
	const w = size.w / 2 / canvas.scale;
	const h = size.h / 2 / canvas.scale;
	return { minX: canvas.x - w, minY: canvas.y - h, maxX: canvas.x + w, maxY: canvas.y + h };
}

class Minimap {
	readonly el: HTMLElement;
	private readonly cv: HTMLCanvasElement;
	private transform: MapTransform | null = null;
	private timer = 0;
	/** Cards, edges and strokes, re-rendered only when the content changes (not on pan/zoom). */
	private readonly layer = createEl("canvas");
	private contentDirty = true;
	private accent: string | null = null;
	/** The canvas size, observed (reading clientWidth while panning forces a layout). */
	private size = { w: 0, h: 0 };
	private readonly resize: ResizeObserver;

	constructor(
		private readonly ctx: ModuleContext<MinimapSettings>,
		private readonly canvas: CanvasLike,
	) {
		this.el = canvas.wrapperEl.createDiv({ cls: "opc-minimap", attr: { "aria-label": ctx.t("minimap.name"), role: "img" } });
		this.cv = this.el.createEl("canvas");
		this.el.addEventListener("pointerdown", this.onDown);
		this.el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
		this.size = { w: canvas.wrapperEl.clientWidth, h: canvas.wrapperEl.clientHeight };
		this.resize = new ResizeObserver(([entry]) => {
			if (!entry) return;
			this.size = { w: entry.contentRect.width, h: entry.contentRect.height };
			this.schedule();
		});
		this.resize.observe(canvas.wrapperEl);
		this.layout();
		this.draw();
	}


	destroy(): void {
		this.resize.disconnect();
		window.clearTimeout(this.timer);
		this.el.remove();
	}

	layout(): void {
		const s = this.ctx.settings;
		this.el.dataset.corner = s.corner;
		this.el.style.width = `${s.width}px`;
		this.el.style.height = `${Math.round(s.width * 0.68)}px`;
		this.schedule();
	}

	/** The content changed: re-render it on the next redraw. */
	invalidate(): void {
		this.contentDirty = true;
		this.accent = null;
		this.schedule();
	}

	/** Coalesces bursts of changes (drags, zoom) into one redraw. */
	schedule(): void {
		if (this.timer) return;
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			this.draw();
		}, 30);
	}

	draw(): void {
		const canvas = this.canvas;
		const width = this.ctx.settings.width;
		const height = Math.round(width * 0.68);
		const dpr = window.devicePixelRatio || 1;
		if (this.cv.width !== width * dpr || this.cv.height !== height * dpr) {
			this.cv.width = width * dpr;
			this.cv.height = height * dpr;
			this.cv.style.width = `${width}px`;
			this.cv.style.height = `${height}px`;
		}
		const out = this.cv.getContext("2d");
		if (!out) return;
		const view = viewOf(canvas, this.size);
		if (this.contentDirty || this.layer.width !== this.cv.width || this.layer.height !== this.cv.height || canvas.nodes.size === 0) {
			this.contentDirty = false;
			this.layer.width = this.cv.width;
			this.layer.height = this.cv.height;
			this.renderContent(view, width, height, dpr);
		}
		out.setTransform(1, 0, 0, 1, 0, 0);
		out.clearRect(0, 0, this.cv.width, this.cv.height);
		out.drawImage(this.layer, 0, 0);
		out.setTransform(dpr, 0, 0, dpr, 0, 0);
		const t = this.transform!;
		// Cached: reading styles on every pan frame forces a style pass over the whole canvas.
		const accent = (this.accent ??= getComputedStyle(canvas.wrapperEl).getPropertyValue("--color-accent").trim() || "#7c3aed");
		const v1 = toMap(t, view.minX, view.minY);
		const v2 = toMap(t, view.maxX, view.maxY);
		out.fillStyle = accent;
		out.globalAlpha = 0.12;
		out.fillRect(v1.x, v1.y, v2.x - v1.x, v2.y - v1.y);
		out.globalAlpha = 1;
		out.strokeStyle = accent;
		out.lineWidth = 1.5;
		out.strokeRect(v1.x, v1.y, v2.x - v1.x, v2.y - v1.y);
	}

	private renderContent(view: Box, width: number, height: number, dpr: number): void {
		const canvas = this.canvas;
		const g = this.layer.getContext("2d")!;
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, width, height);
		const boxes: Box[] = [];
		const shown = [...canvas.nodes.values()].filter((n) => !isHiddenNode(n));
		for (const n of shown) boxes.push({ minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height });
		// The map frames the content (the view rectangle may run past its edge), so panning and
		// zooming don't change the transform and the cached layer stays valid.
		const world = unionBox(boxes) ?? view;
		const t = (this.transform = fitTransform(world, width, height, PAD));

		const style = getComputedStyle(canvas.wrapperEl);
		const body = getComputedStyle(canvas.wrapperEl.doc.body);
		const presets: Record<string, string> = {};
		for (let i = 1; i <= 6; i++) presets[String(i)] = body.getPropertyValue(`--canvas-color-${i}`);
		const text = style.getPropertyValue("--text-normal").trim() || "#888";
		const faint = style.getPropertyValue("--text-faint").trim() || "#999";
		const dark = canvas.wrapperEl.doc.body.hasClass("theme-dark");
		const ink = (c: string) => (dark && c.toLowerCase() === "#1e1e1e" ? "#e8e8e8" : c);
		const detail = canvas.nodes.size <= DETAIL_LIMIT;

		// Edges: straight, faint.
		g.globalAlpha = 0.35;
		g.strokeStyle = faint;
		g.lineWidth = 1;
		g.beginPath();
		for (const e of canvas.edges.values()) {
			const a = e.from?.node;
			const b = e.to?.node;
			if (!a || !b || isHiddenNode(a) || isHiddenNode(b)) continue;
			const p = toMap(t, a.x + a.width / 2, a.y + a.height / 2);
			const q = toMap(t, b.x + b.width / 2, b.y + b.height / 2);
			g.moveTo(p.x, p.y);
			g.lineTo(q.x, q.y);
		}
		g.stroke();
		g.globalAlpha = 1;

		// Drawing order of the canvas itself: the rendered z-index (layers move it), else the core's.
		const nodes = shown.sort((a, b) => renderedZ(a) - renderedZ(b));
		for (const n of nodes) {
			const extra = (n.unknownData[SCHEMA_KEY] ?? {}) as OpcNode;
			const p = toMap(t, n.x, n.y);
			const w = Math.max(1, n.width * t.scale);
			const h = Math.max(1, n.height * t.scale);
			const color = cssColor(n.color, presets);
			if (nodeType(n) === "group") {
				g.fillStyle = color ?? faint;
				g.globalAlpha = 0.12;
				g.fillRect(p.x, p.y, w, h);
				g.globalAlpha = 0.6;
				g.strokeStyle = color ?? faint;
				g.strokeRect(p.x + 0.5, p.y + 0.5, w - 1, h - 1);
				g.globalAlpha = 1;
				continue;
			}
			if (extra.kind === "ink" && Array.isArray(extra.strokes)) {
				if (!detail) {
					g.fillStyle = faint;
					g.fillRect(p.x, p.y, w, h);
					continue;
				}
				for (const s of extra.strokes) {
					const pts = unpack(s.pts);
					if (pts.length === 0) continue;
					g.strokeStyle = ink(s.color);
					g.globalAlpha = s.tool === "highlighter" ? 0.35 : 1;
					g.lineWidth = Math.max(0.75, s.size * t.scale);
					g.lineCap = "round";
					g.beginPath();
					const first = toMap(t, n.x + pts[0]!.x, n.y + pts[0]!.y);
					g.moveTo(first.x, first.y);
					for (let i = 1; i < pts.length; i += 2) {
						const q = toMap(t, n.x + pts[i]!.x, n.y + pts[i]!.y);
						g.lineTo(q.x, q.y);
					}
					g.stroke();
				}
				g.globalAlpha = 1;
				continue;
			}
			if (extra.kind === "line" && extra.line) {
				g.strokeStyle = color ?? text;
				g.lineWidth = Math.max(1, (extra.strokeWidth ?? 2) * t.scale);
				g.beginPath();
				extra.line.points.forEach(([x, y], i) => {
					const q = toMap(t, n.x + x, n.y + y);
					if (i === 0) g.moveTo(q.x, q.y);
					else g.lineTo(q.x, q.y);
				});
				g.stroke();
				continue;
			}
			g.fillStyle = color ?? faint;
			g.globalAlpha = color ? 0.85 : 0.55;
			if (extra.kind === "shape" && extra.shape === "ellipse") {
				g.beginPath();
				g.ellipse(p.x + w / 2, p.y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
				g.fill();
			} else g.fillRect(p.x, p.y, w, h);
			g.globalAlpha = 1;
		}

	}

	private onDown = (evt: PointerEvent) => {
		if (evt.button !== 0 || !this.transform) return;
		evt.preventDefault();
		evt.stopPropagation();
		capturePointer(this.el, evt.pointerId);
		const t = this.transform;
		const rect = this.cv.getBoundingClientRect();
		const at = (e: PointerEvent) => toWorld(t, e.clientX - rect.left, e.clientY - rect.top);
		// Dragging inside the viewport keeps the grab offset; elsewhere the view jumps there.
		const view = this.canvas.getViewportBBox();
		const start = at(evt);
		const inside = start.x >= view.minX && start.x <= view.maxX && start.y >= view.minY && start.y <= view.maxY;
		const offset = inside ? { x: this.canvas.x - start.x, y: this.canvas.y - start.y } : { x: 0, y: 0 };
		const go = (e: PointerEvent) => {
			const p = at(e);
			this.canvas.panTo(p.x + offset.x, p.y + offset.y);
			this.draw();
		};
		if (!inside) go(evt);
		const up = () => {
			this.el.removeEventListener("pointermove", go);
			this.el.removeEventListener("pointerup", up);
			this.el.removeEventListener("pointercancel", up);
		};
		this.el.addEventListener("pointermove", go);
		this.el.addEventListener("pointerup", up);
		this.el.addEventListener("pointercancel", up);
	};
}

/**
 * Minimap overlay: cards, groups, shapes, lines, strokes and the current view in a corner of
 * the canvas. Click or drag to navigate. M toggles it; the corner is configurable.
 */
export const minimapModule = defineModule<MinimapSettings>({
	id: "minimap",
	name: "minimap.name",
	description: "minimap.desc",
	group: "navigation",
	defaultEnabled: true,
	defaultSettings: DEFAULTS,
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			...s,
			corner: CORNERS.includes(s.corner) ? s.corner : defaults.corner,
			width: typeof s.width === "number" && s.width >= 120 && s.width <= 480 ? s.width : defaults.width,
		};
	},

	enable(ctx) {
		const maps = new Map<CanvasLike, Minimap>();
		const buttons = new Map<CanvasLike, HTMLElement>();

		const sync = (canvas: CanvasLike) => {
			const map = maps.get(canvas);
			if (ctx.settings.visible && !map) maps.set(canvas, new Minimap(ctx, canvas));
			else if (!ctx.settings.visible && map) {
				map.destroy();
				maps.delete(canvas);
			}
			buttons.get(canvas)?.toggleClass("is-active", ctx.settings.visible);
		};
		const toggle = () => void ctx.updateSettings({ visible: !ctx.settings.visible });

		ctx.onCanvas((canvas) => {
			const controls = canvas.wrapperEl.querySelector(".canvas-controls");
			const group = controls?.createDiv({ cls: "canvas-control-group mod-raised opc-minimap-control" });
			if (group) {
				const item = group.createDiv({ cls: "canvas-control-item", attr: { "aria-label": ctx.t("minimap.toggle"), "data-tooltip-position": "left" } });
				setIcon(item, "map");
				setTooltip(item, ctx.t("minimap.toggle"), { placement: "left" });
				item.addEventListener("click", toggle);
				buttons.set(canvas, item);
			}
			sync(canvas);
			return () => {
				maps.get(canvas)?.destroy();
				maps.delete(canvas);
				group?.remove();
				buttons.delete(canvas);
			};
		});
		ctx.onSettingsChange((next, prev) => {
			for (const canvas of ctx.canvases()) {
				sync(canvas);
				if (next.corner !== prev.corner || next.width !== prev.width) maps.get(canvas)?.layout();
			}
		});

		// Pan and zoom animate over several frames: follow the view every frame.
		const lastView = new WeakMap<CanvasLike, string>();
		const lastPage = new WeakMap<CanvasLike, string>();
		ctx.on("canvas-frame", (canvas) => {
			const map = maps.get(canvas);
			if (!map) return;
			// Another page shown: the map draws only that page.
			const page = pagesHost.api?.current(canvas) ?? "";
			if ((lastPage.get(canvas) ?? "") !== page) map.invalidate();
			lastPage.set(canvas, page);
			const view = `${canvas.x},${canvas.y},${canvas.zoom}`;
			if (lastView.get(canvas) === view) return;
			lastView.set(canvas, view);
			map.schedule();
		});
		const redraw = (canvas: CanvasLike) => maps.get(canvas)?.invalidate();
		ctx.on("node-moved", (n) => redraw(n.canvas));
		ctx.on("node-added", (n) => redraw(n.canvas));
		ctx.on("node-removed", (n) => redraw(n.canvas));
		ctx.on("node-set-data", (n) => redraw(n.canvas));
		ctx.on("node-extra-change", (n) => redraw(n.canvas));
		ctx.on("edge-added", (e) => redraw(e.canvas));
		ctx.on("edge-removed", (e) => redraw(e.canvas));
		ctx.on("data-load", redraw);
		ctx.on("history-apply", redraw);
		ctx.registerEvent(ctx.app.workspace.on("css-change", () => maps.forEach((m) => m.invalidate())));

		ctx.addCanvasKey({ modifiers: [], key: "M", handle: () => (toggle(), true) });
		ctx.addCommand({
			id: "toggle",
			name: ctx.t("minimap.toggle"),
			icon: "map",
			checkCallback: (checking) => {
				if (!ctx.activeCanvas()) return false;
				if (!checking) toggle();
				return true;
			},
		});
		ctx.register(() => {
			for (const m of maps.values()) m.destroy();
			maps.clear();
		});
	},

	renderSettings(el, ctx: ModuleContext<MinimapSettings>) {
		new Setting(el).setName(ctx.t("minimap.corner")).addDropdown((d) =>
			d
				.addOptions(Object.fromEntries(CORNERS.map((c) => [c, ctx.t(`minimap.corner.${c}`)])))
				.setValue(ctx.settings.corner)
				.onChange((v) => ctx.updateSettings({ corner: v as Corner })),
		);
		new Setting(el).setName(ctx.t("minimap.width")).addSlider((s) => s.setLimits(140, 400, 10).setValue(ctx.settings.width).onChange((v) => ctx.updateSettings({ width: v })));
	},
});
