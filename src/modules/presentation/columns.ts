import { Component, Keymap, MarkdownRenderer, Notice, setIcon, type App } from "obsidian";
import { logError } from "../../core/log";
import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { nodeText } from "../canvas-markdown/structure";
import type { InkSurface } from "../drawing/api";
import { strokeD } from "../drawing/render";
import { nodeType } from "../shared";
import type { MarkSurface } from "../text-highlight/api";
import { columnPositions, keepZoom, zoomAround, type View } from "./column-layout";

export interface Column {
	ids: string[];
	/** The card of this column on the way to the current one; "" in the children's column. */
	active: string;
}

export interface ColumnOptions {
	/** Card text size in px; 0 = as the canvas shows its cards (its CSS classes included). */
	fontSize: number;
	/** Widest a card gets (text wraps), unless cards keep their size on the board. */
	width: number;
	/** Cards at their size on the board, with the ink drawn on them. */
	actualSize: boolean;
}

/** A tool of the column view: drawing, the highlighter, the text color tool. */
export type ColumnTool = "ink" | "highlight" | "color";

export interface ColumnHost {
	/** A card was tapped. */
	open(id: string): void;
	/** A scroll over the columns. */
	sibling(delta: number): void;
	options(): ColumnOptions;
	/** A card's text was edited here: write it to the canvas. */
	save(id: string, text: string): boolean;
	/** Cards can be added and edited (the board is not read-only). */
	editable(): boolean;
	/** Adds a child of the current card, or a sibling after it. */
	add(kind: "child" | "sibling"): void;
	/** A card just added here was left empty: take it away. */
	discard(id: string): void;
	/** The tools offered (by the modules that are on). */
	tools(): ColumnTool[];
	/** A tool button was pressed: turn it on (or off, when it is on). */
	useTool(tool: ColumnTool): void;
}

const TOOL_ICONS: Record<ColumnTool, string> = { ink: "pen-tool", highlight: "highlighter", color: "baseline" };
const TOOL_LABELS = { ink: "drawing.command", highlight: "textHighlight.button", color: "textHighlight.color.button" } as const;
/** How near a card (screen px) a pen press still draws on it. */
const INK_REACH = 12;

const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "bmp", "svg", "webp", "avif"]);
/** Wheel distance that counts as one step along the siblings. */
const WHEEL_STEP = 60;
/** Inertial wheels keep sending events: at most one step in this time. */
const WHEEL_PAUSE = 160;
/** A press that moves farther than this is a drag, not a tap. */
const TAP_MOVE = 6;
/** Two taps on the same card within this time edit it. */
const DOUBLE_TAP_MS = 400;
/** Room between two columns, in px at zoom 1. */
const GAP = 32;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

interface Placed {
	column: HTMLElement;
	/** The card the column is centered on (the way to the current card), if any. */
	card: HTMLElement | null;
	/** Width the next column is shifted by: the active card's in actual size, else the column's. */
	reach: number;
	width: number;
}

/**
 * The map as columns: each ancestor's level to the left, the current card's siblings stacked in
 * the middle, its children to the right, centered on the card they belong to. Pinch or Ctrl/Cmd +
 * wheel zooms, a press-and-drag moves a column up or down (and the columns sideways), a tap on a
 * card goes there, a second tap edits it. The walk drives it.
 */
export class ColumnView {
	private readonly el: HTMLElement;
	private readonly zoomEl: HTMLElement;
	private readonly track: HTMLElement;
	private component = new Component();
	private wheel = 0;
	private lastStep = 0;
	private placed: Placed[] = [];
	private middle = -1;
	/** Zoom and pan of the whole view (screen px). */
	private view: View = { zoom: 1, x: 0, y: 0 };
	/** Extra vertical shift of each column, from dragging it (px at zoom 1). */
	private shifts: number[] = [];
	private pointers = new Map<number, { x: number; y: number }>();
	private press: { id: number; x: number; y: number; column: number; moved: boolean; pinch: boolean } | null = null;
	private pinch: { dist: number; zoom: number } | null = null;
	/** The last tap on a card, for a second tap that edits it. */
	private lastTap = { id: "", at: 0 };
	/** A drag or pinch just ended: a click right after it is not a tap. */
	private swallowUntil = 0;
	private editing: { id: string; input: HTMLTextAreaElement } | null = null;
	private last: { columns: Column[]; current: string; path: string[] } | null = null;
	private readonly resizer: ResizeObserver;
	private readonly toolsEl: HTMLElement;
	/** The tool on, if any. */
	private tool: ColumnTool | null = null;
	/** Drawing shows every card at its size on the board, whatever the setting. */
	private forcedActual = false;
	/** The card a pen gesture draws on (from its press to its release). */
	private inkCard: string | null = null;

	constructor(
		private readonly app: App,
		private readonly ctx: ModuleContext<object>,
		private readonly canvas: CanvasLike,
		private readonly host: ColumnHost,
	) {
		this.el = canvas.wrapperEl.createDiv({ cls: "opc-columns" });
		this.zoomEl = this.el.createDiv({ cls: "opc-columns-zoom" });
		// The root is always on the left, as the arrows expect; card text keeps its own direction.
		this.track = this.zoomEl.createDiv({ cls: "opc-columns-track", attr: { dir: "ltr" } });
		this.el.addEventListener("pointerdown", this.onDown);
		this.el.addEventListener("pointermove", this.onMove);
		this.el.addEventListener("pointerup", this.onUp);
		this.el.addEventListener("pointercancel", this.onCancel);
		this.el.addEventListener("click", this.onClick, true);
		this.el.addEventListener("wheel", this.onWheel, { passive: false });
		const release = () => (this.inkCard = null);
		this.el.addEventListener("pointerup", release, true);
		this.el.addEventListener("pointercancel", release, true);
		this.toolsEl = this.el.createDiv({ cls: "opc-columns-tools", attr: { role: "toolbar" } });
		// The view's own size (window, split, a tablet turned): the columns stay centered.
		this.resizer = new ResizeObserver(() => {
			this.view = keepZoom(this.view.zoom, this.size());
			this.layout(false);
		});
		this.resizer.observe(this.el);
		this.component.load();
	}

	// ---------- drawing ----------

	/** `keep`: the same zoom, scroll and dragged columns (the board changed, not the card). */
	show(columns: Column[], current: string, path: string[], keep = false): void {
		this.last = { columns, current, path };
		this.editing = null;
		this.component.unload();
		this.component = new Component();
		this.component.load();
		this.track.empty();
		const asked = { ...this.host.options() };
		if (this.forcedActual) asked.actualSize = true;
		// A column never takes more than about three quarters of the view (phones), so the next shows.
		const room = this.el.clientWidth ? Math.max(160, Math.round(this.el.clientWidth * 0.72)) : asked.width;
		const opts = { ...asked, width: Math.min(asked.width, room) };
		this.el.toggleClass("is-actual-size", opts.actualSize);
		const canvasFont = this.canvasFontSize();
		const columnFont = opts.fontSize > 0 ? opts.fontSize : canvasFont;
		this.el.setCssProps({ "--opc-columns-font-size": `${columnFont}px`, "--opc-columns-width": `${opts.width}px` });
		this.renderTools();
		const editable = this.host.editable();
		const onPath = new Set(path);
		const source = this.canvas.view.file?.path ?? "";
		const pending: Promise<void>[] = [];
		this.placed = [];
		this.middle = -1;
		for (const column of columns) {
			const columnEl = this.track.createDiv({ cls: "opc-columns-column" });
			let activeCard: HTMLElement | null = null;
			let widest = 0;
			let activeWidth = 0;
			for (const id of column.ids) {
				const node = this.canvas.nodes.get(id);
				if (!node) continue;
				const card = columnEl.createDiv({ cls: "opc-columns-card", attr: { dir: "auto", "data-id": id } });
				card.toggleClass("is-current", id === current);
				card.toggleClass("is-path", onPath.has(id) && id !== current);
				card.toggleClass("is-child", !column.active);
				card.toggleClass("is-group", nodeType(node) === "group");
				card.toggleClass("is-editable", nodeType(node) === "text");
				this.colorCard(card, node);
				if (id === column.active) activeCard = card;
				if (id === current) this.middle = this.placed.length;
				// A group is its name: at its size on the board it would be a big empty box.
				const actual = opts.actualSize && nodeType(node) !== "group";
				const width = actual ? node.width : opts.width;
				card.toggleClass("is-actual", actual);
				const text = nodeText(node.getData());
				const image = actual ? this.imageOf(node) : null;
				if (actual && nodeType(node) === "text") {
					// Laid out by the board's own styles, so handwriting lands on the same words.
					const sizer = this.textReplica(this.replica(card, node), node);
					pending.push(MarkdownRenderer.render(this.app, text, sizer, source, this.component).then(() => wrapBlocks(sizer)));
				} else if (image) {
					const content = this.replica(card, node).createDiv({ cls: "canvas-node-content media-embed image-embed is-loaded" });
					content.createEl("img", { attr: { src: image, draggable: "false" } });
				} else {
					const body = card.createDiv({ cls: "opc-columns-body markdown-preview-view markdown-rendered" });
					pending.push(MarkdownRenderer.render(this.app, text, body, source, this.component));
				}
				if (actual) {
					card.setCssProps({ "--opc-card-width": `${node.width}px`, "--opc-card-height": `${node.height}px` });
					this.drawInk(card, node);
				}
				// A card with its own text size keeps it, in proportion to the column's size.
				const own = this.ctx.data.node(node).get().fontSize;
				if (own && !actual) card.setCssStyles({ fontSize: `${Math.round((columnFont * own) / canvasFont)}px` });
				if (id === current && editable) this.addButtons(card, path.length > 1);
				widest = Math.max(widest, width);
				if (id === column.active) activeWidth = width;
			}
			columnEl.setCssProps({ "--opc-column-width": `${widest}px` });
			this.placed.push({ column: columnEl, card: activeCard, reach: opts.actualSize && activeWidth ? activeWidth : widest, width: widest });
		}
		if (keep) {
			const before = this.shifts;
			this.shifts = this.placed.map((_, i) => before[i] ?? 0);
		} else {
			this.shifts = this.placed.map(() => 0);
			this.el.removeClass("is-moved");
			this.view = keepZoom(this.view.zoom, this.size());
		}
		this.layout(!keep);
		// Rendered text and images change the heights the columns are centered by.
		Promise.all(pending).then(
			() => this.layout(!keep),
			(e) => logError("[overpowered-canvas] columns: render", e),
		);
	}

	/** Columns back where the current card puts them (after dragging), keeping the zoom. */
	recenter(): void {
		this.el.removeClass("is-moved");
		this.shifts = this.placed.map(() => 0);
		this.view = keepZoom(this.view.zoom, this.size());
		this.layout(true);
	}

	/** Draws the walk again, keeping zoom (after an edit or a change on the board). */
	redraw(keep = false): void {
		if (this.last) this.show(this.last.columns, this.last.current, this.last.path, keep);
	}

	/** Draws the ink of the cards again (strokes added, erased or moved), nothing else. */
	refreshInk(): void {
		for (const card of Array.from(this.track.querySelectorAll<HTMLElement>(".opc-columns-card.is-actual"))) {
			const node = card.dataset.id ? this.canvas.nodes.get(card.dataset.id) : undefined;
			if (!node) continue;
			card.querySelector(".opc-columns-ink")?.remove();
			this.drawInk(card, node);
			// The pen's live preview stays on top.
			const preview = card.querySelector(":scope > svg.opc-ink-preview");
			if (preview) card.appendChild(preview);
		}
	}

	// ---------- tools and new cards ----------

	/** The tool buttons at the side of the view (drawing, highlighter, text color). */
	private renderTools(): void {
		this.toolsEl.empty();
		const tools = this.host.tools();
		this.toolsEl.toggle(tools.length > 0);
		for (const tool of tools) {
			const b = this.toolsEl.createEl("button", { cls: "clickable-icon opc-columns-tool", attr: { "aria-label": this.ctx.t(TOOL_LABELS[tool]), "data-tool": tool } });
			setIcon(b, TOOL_ICONS[tool]);
			b.toggleClass("is-active", this.tool === tool);
			b.addEventListener("pointerdown", (e) => e.stopPropagation());
			b.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.host.useTool(tool);
			});
		}
	}

	/** The tool now on (null: none). Drawing shows the cards at their size on the board. */
	setTool(tool: ColumnTool | null): void {
		this.tool = tool;
		this.el.toggleClass("has-tool", !!tool);
		this.el.toggleClass("is-marking", tool === "highlight" || tool === "color");
		const force = tool === "ink" && !this.host.options().actualSize;
		if (force !== this.forcedActual) {
			this.forcedActual = force;
			this.redraw(true);
		} else this.renderTools();
	}

	/** "+" buttons on the current card: a child (beside it) and a sibling (below it). */
	private addButtons(card: HTMLElement, sibling: boolean): void {
		const button = (kind: "child" | "sibling", label: string) => {
			const b = card.createEl("button", { cls: `clickable-icon opc-columns-add is-${kind}`, attr: { "aria-label": label } });
			setIcon(b, "plus");
			b.addEventListener("pointerdown", (e) => e.stopPropagation());
			b.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.host.add(kind);
			});
		};
		button("child", this.ctx.t("presentation.columns.addChild"));
		if (sibling) button("sibling", this.ctx.t("presentation.columns.addSibling"));
	}

	private cardEl(id: string): HTMLElement | null {
		return this.track.querySelector<HTMLElement>(`.opc-columns-card[data-id="${CSS.escape(id)}"]`);
	}

	/** The card shown at its board size under (or right next to) a screen point. */
	private actualCardAt(x: number, y: number): string | null {
		let best: { id: string; d: number } | null = null;
		for (const card of Array.from(this.track.querySelectorAll<HTMLElement>(".opc-columns-card.is-actual"))) {
			const r = card.getBoundingClientRect();
			const dx = Math.max(r.left - x, 0, x - r.right);
			const dy = Math.max(r.top - y, 0, y - r.bottom);
			const d = Math.hypot(dx, dy);
			if (d <= INK_REACH && card.dataset.id && (!best || d < best.d)) best = { id: card.dataset.id, d };
		}
		return best?.id ?? null;
	}

	/** The board point a screen point over card `id` stands for. */
	private toBoard(id: string, x: number, y: number): { x: number; y: number } | null {
		const node = this.canvas.nodes.get(id);
		const r = this.cardEl(id)?.getBoundingClientRect();
		if (!node || !r || !r.width) return null;
		const k = node.width / r.width;
		return { x: node.x + (x - r.left) * k, y: node.y + (y - r.top) * k };
	}

	/**
	 * Where the pen draws in this view: on the cards at their board size, in board coordinates
	 * (strokes land on the board exactly where they show here). Ink only: lines and shapes are
	 * cards of their own, which the columns don't show.
	 */
	inkSurface(): InkSurface {
		return {
			host: this.el,
			inkOnly: true,
			toCanvas: (x, y, press) => {
				if (press) this.inkCard = this.actualCardAt(x, y);
				const id = this.inkCard ?? this.actualCardAt(x, y);
				return id ? this.toBoard(id, x, y) : null;
			},
			scale: () => {
				const id = this.inkCard ?? this.last?.current ?? "";
				const node = this.canvas.nodes.get(id);
				const r = this.cardEl(id)?.getBoundingClientRect();
				return node && r?.width ? r.width / node.width : this.view.zoom;
			},
			placePreview: (svg, layer, x, y) => {
				const id = this.inkCard ?? (Number.isFinite(x) ? this.actualCardAt(x, y) : null);
				const card = id ? this.cardEl(id) : null;
				const node = id ? this.canvas.nodes.get(id) : undefined;
				if (!card || !node) return;
				if (svg.parentElement !== card) card.appendChild(svg);
				layer.setAttribute("transform", `translate(${-node.x} ${-node.y})`);
			},
			pan: (dx, dy) => {
				this.el.addClass("is-moved");
				this.view = { ...this.view, x: this.view.x + dx, y: this.view.y + dy };
				this.applyView();
			},
		};
	}

	/** Where the highlighter and the text color tool mark words in this view. */
	markSurface(): MarkSurface {
		return {
			host: this.el,
			cardAt: (x, y) => {
				const card = this.el.doc.elementFromPoint(x, y)?.closest<HTMLElement>(".opc-columns-card");
				const node = card?.dataset.id ? this.canvas.nodes.get(card.dataset.id) : undefined;
				if (!card || !node || card.hasClass("is-editing")) return null;
				const root = card.querySelector<HTMLElement>(".markdown-preview-sizer") ?? card.querySelector<HTMLElement>(".opc-columns-body");
				return root ? { node, root } : null;
			},
		};
	}

	private size(): { width: number; height: number } {
		return { width: this.el.clientWidth, height: this.el.clientHeight };
	}

	/**
	 * Places the columns: side by side, each one shifted by the width of the card it continues
	 * from; the current card's column in the middle of the screen; each column's card on the way
	 * at mid-height and the children's block centered on their parent.
	 */
	private layout(animate: boolean): void {
		const { width, height } = this.size();
		// Hidden (a background tab, a minimized window): placed when it shows again.
		if (width === 0 || height === 0) return;
		this.el.toggleClass("is-settling", animate);
		const xs = columnPositions(this.placed.map((p) => p.reach), GAP);
		const mid = this.placed[this.middle];
		const cur = mid?.column.querySelector<HTMLElement>(".opc-columns-card.is-current");
		const centerX = mid ? xs[this.middle]! + (cur ? cur.offsetWidth : mid.width) / 2 : 0;
		this.track.style.transform = `translateX(${Math.round(width / 2 - centerX)}px)`;
		this.placed.forEach((p, i) => {
			p.column.style.left = `${xs[i]}px`;
			const cards = p.column.children;
			const first = cards[0] as HTMLElement | undefined;
			const lastCard = cards[cards.length - 1] as HTMLElement | undefined;
			// The children's block: its middle, so it sits level with its parent.
			const anchor = p.card ? p.card.offsetTop + p.card.offsetHeight / 2 : first && lastCard ? (first.offsetTop + lastCard.offsetTop + lastCard.offsetHeight) / 2 : 0;
			p.column.style.transform = `translateY(${Math.round(height / 2 - anchor + (this.shifts[i] ?? 0))}px)`;
		});
		this.applyView();
	}

	private applyView(): void {
		this.zoomEl.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.zoom})`;
		this.el.toggleClass("is-zoomed", Math.abs(this.view.zoom - 1) > 0.01);
	}

	/** Zooms by `factor` around a screen point (default: the middle). */
	zoomBy(factor: number, at?: { x: number; y: number }): void {
		const { width, height } = this.size();
		const r = this.el.getBoundingClientRect();
		const point = at ? { x: at.x - r.left, y: at.y - r.top } : { x: width / 2, y: height / 2 };
		this.view = zoomAround(this.view, Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.zoom * factor)), point);
		this.applyView();
	}

	/** Text size of the canvas's cards, so the columns read like the board (its CSS classes too). */
	private canvasFontSize(): number {
		const shown = [...this.canvas.nodes.values()].find((n) => n.nodeEl.isConnected && nodeType(n) === "text" && !n.nodeEl.hasAttribute("data-opc-font-size") && n.contentEl?.querySelector(".markdown-preview-view")?.isConnected);
		const el = shown?.contentEl?.querySelector<HTMLElement>(".markdown-preview-view");
		const read = (e: HTMLElement) => Number.parseFloat(getComputedStyle(e).fontSize);
		if (el) {
			const size = read(el);
			if (size > 0) return size;
		}
		// No card on screen: a hidden card-like element inside the board tells.
		const probe = this.canvas.canvasEl.createDiv({ cls: "canvas-node opc-columns-probe" });
		const view = probe.createDiv({ cls: "canvas-node-container" }).createDiv({ cls: "canvas-node-content markdown-embed" }).createDiv({ cls: "markdown-embed-content" }).createDiv({ cls: "markdown-preview-view markdown-rendered" });
		const size = read(view);
		probe.remove();
		return size > 0 ? size : 16;
	}

	/**
	 * A text card built like the board builds it (the same nested elements, classes, data
	 * attributes and color variables as its card there), so the board's styles, the theme's and
	 * other modules' (alignment, fonts, colors) lay its content out exactly as on the board.
	 * Returns its container, for the content.
	 */
	private replica(card: HTMLElement, node: CanvasNodeLike): HTMLElement {
		card.addClass("is-replica");
		const src = node.nodeEl;
		const shell = card.createDiv({ cls: "opc-columns-replica" });
		for (const cls of Array.from(src.classList)) if (keepClass(cls)) shell.addClass(cls);
		shell.addClass("canvas-node");
		for (const attr of Array.from(src.attributes)) if (attr.name.startsWith("data-")) shell.setAttribute(attr.name, attr.value);
		const vars: Record<string, string> = {};
		for (let i = 0; i < src.style.length; i++) {
			const key = src.style.item(i);
			if (key.startsWith("--") && !key.startsWith("--canvas-node-")) vars[key] = src.style.getPropertyValue(key);
		}
		shell.setCssProps({ ...vars, "--canvas-node-width": `${node.width}px`, "--canvas-node-height": `${node.height}px` });
		return shell.createDiv({ cls: "canvas-node-container" });
	}

	/** The reading view inside a replica's container; returns where the Markdown goes. */
	private textReplica(container: HTMLElement, node: CanvasNodeLike): HTMLElement {
		const embed = container.createDiv({ cls: "canvas-node-content markdown-embed" }).createDiv({ cls: "markdown-embed-content" });
		const live = node.contentEl?.querySelector<HTMLElement>(".markdown-preview-view");
		const view = embed.createDiv({ cls: "markdown-preview-view markdown-rendered" });
		for (const cls of live ? Array.from(live.classList) : ["show-indentation-guide", "allow-fold-headings", "allow-fold-lists"]) if (cls !== "node-insert-event") view.addClass(cls);
		const sizer = view.createDiv({ cls: "markdown-preview-sizer markdown-preview-section" });
		sizer.createDiv({ cls: "markdown-preview-pusher" });
		return sizer;
	}

	/** The address of the image a file card shows, if it shows one. */
	private imageOf(node: CanvasNodeLike): string | null {
		const data = node.getData();
		if (data.type !== "file" || typeof data.file !== "string" || data.subpath) return null;
		const file = this.app.vault.getFileByPath(data.file);
		return file && IMAGE_EXTENSIONS.has(file.extension.toLowerCase()) ? this.app.vault.getResourcePath(file) : null;
	}

	/** The card's canvas color on its border. */
	private colorCard(card: HTMLElement, node: CanvasNodeLike): void {
		if (!node.color) return;
		const color = getComputedStyle(node.nodeEl).getPropertyValue("--canvas-color").trim() || (node.color.startsWith("#") ? node.color : "");
		if (!color) return;
		card.addClass("has-color");
		// A bare r, g, b triple (older themes) becomes a color.
		card.setCssProps({ "--opc-card-color": /^\d+\s*,\s*\d+\s*,\s*\d+$/.test(color) ? `rgb(${color})` : color });
	}

	/** Ink drawn on the card (stuck to it, or lying on it) at its place on the card. */
	private drawInk(card: HTMLElement, node: CanvasNodeLike): void {
		const carriers = [...this.canvas.nodes.values()].filter((n) => {
			if (nodeType(n) !== "text") return false;
			const extra = this.ctx.data.node(n).get();
			if (extra.kind !== "ink" || !extra.strokes?.length) return false;
			if (extra.anchor) return extra.anchor === node.id;
			const cx = n.x + n.width / 2;
			const cy = n.y + n.height / 2;
			return cx >= node.x && cx <= node.x + node.width && cy >= node.y && cy <= node.y + node.height;
		});
		if (!carriers.length) return;
		const minX = Math.min(node.x, ...carriers.map((c) => c.x));
		const minY = Math.min(node.y, ...carriers.map((c) => c.y));
		const maxX = Math.max(node.x + node.width, ...carriers.map((c) => c.x + c.width));
		const maxY = Math.max(node.y + node.height, ...carriers.map((c) => c.y + c.height));
		const svg = card.createSvg("svg", { cls: "opc-columns-ink" });
		svg.setAttribute("viewBox", `0 0 ${maxX - minX} ${maxY - minY}`);
		svg.setAttribute("width", String(maxX - minX));
		svg.setAttribute("height", String(maxY - minY));
		svg.setCssProps({ "--opc-ink-left": `${minX - node.x}px`, "--opc-ink-top": `${minY - node.y}px` });
		for (const carrier of carriers) {
			const g = svg.createSvg("g");
			g.setAttribute("transform", `translate(${carrier.x - minX} ${carrier.y - minY})`);
			for (const s of this.ctx.data.node(carrier).get().strokes ?? []) {
				const path = g.createSvg("path");
				path.setAttribute("d", strokeD(s));
				path.setAttribute("fill", s.color);
				path.style.opacity = String(s.opacity ?? (s.tool === "highlighter" ? 0.35 : s.tool === "pencil" ? 0.85 : 1));
			}
		}
	}

	// ---------- touch, mouse and wheel ----------

	private columnAt(target: EventTarget | null): number {
		const el = (target as HTMLElement | null)?.closest?.(".opc-columns-column");
		return el ? this.placed.findIndex((p) => p.column === el) : -1;
	}

	private onDown = (evt: PointerEvent) => {
		evt.stopPropagation();
		if (this.editing && (evt.target as HTMLElement).closest(".opc-columns-editor")) return;
		// A drag by touch fires no click: only a click right after a drag is dropped.
		if (this.pointers.size === 0) this.swallowUntil = 0;
		this.pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
		if (this.pointers.size === 2) {
			// A second finger: pinch to zoom.
			const [a, b] = [...this.pointers.values()];
			this.pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, zoom: this.view.zoom };
			if (this.press) this.press.pinch = true;
			return;
		}
		if (this.pointers.size > 2) return;
		if (evt.pointerType === "mouse" && evt.button !== 0) return;
		this.press = { id: evt.pointerId, x: evt.clientX, y: evt.clientY, column: this.columnAt(evt.target), moved: false, pinch: false };
	};

	private onMove = (evt: PointerEvent) => {
		const prev = this.pointers.get(evt.pointerId);
		if (!prev) return;
		const now = { x: evt.clientX, y: evt.clientY };
		this.pointers.set(evt.pointerId, now);
		if (this.pinch && this.pointers.size >= 2) {
			evt.preventDefault();
			const [a, b] = [...this.pointers.values()];
			const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
			const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (this.pinch.zoom * dist) / this.pinch.dist));
			this.zoomBy(target / this.view.zoom, { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 });
			return;
		}
		const press = this.press;
		if (!press || press.id !== evt.pointerId || press.pinch) return;
		if (!press.moved && Math.hypot(now.x - press.x, now.y - press.y) < TAP_MOVE) return;
		if (!press.moved) {
			press.moved = true;
			this.el.addClass("is-dragging");
			this.el.removeClass("is-settling");
			try {
				this.el.setPointerCapture(evt.pointerId);
			} catch {
				// Synthetic or ended pointers can't be captured; the drag still works over the view.
			}
		}
		evt.preventDefault();
		// Up and down: that column only (to reach what a big card hides); sideways: all columns.
		const dy = (now.y - prev.y) / this.view.zoom;
		if (press.column >= 0) this.shifts[press.column] = (this.shifts[press.column] ?? 0) + dy;
		this.el.addClass("is-moved");
		this.view = { ...this.view, x: this.view.x + (now.x - prev.x) };
		this.layout(false);
	};

	private onUp = (evt: PointerEvent) => {
		this.pointers.delete(evt.pointerId);
		if (this.pointers.size < 2) this.pinch = null;
		const press = this.press;
		if (press?.id !== evt.pointerId) return;
		this.press = null;
		this.el.removeClass("is-dragging");
		if (press.moved || press.pinch) this.swallowUntil = performance.now() + 300;
	};

	private onCancel = (evt: PointerEvent) => {
		this.pointers.delete(evt.pointerId);
		if (this.pointers.size < 2) this.pinch = null;
		if (this.press?.id === evt.pointerId) this.press = null;
		this.el.removeClass("is-dragging");
	};

	private onWheel = (evt: WheelEvent) => {
		evt.preventDefault();
		evt.stopPropagation();
		if (evt.ctrlKey || evt.metaKey) {
			this.zoomBy(Math.exp(-evt.deltaY / 300), { x: evt.clientX, y: evt.clientY });
			return;
		}
		this.wheel += evt.deltaY;
		const now = performance.now();
		if (Math.abs(this.wheel) < WHEEL_STEP || now - this.lastStep < WHEEL_PAUSE) return;
		this.host.sibling(this.wheel);
		this.wheel = 0;
		this.lastStep = now;
	};

	/** Links open, a tap on a card goes there, a second tap on it edits it. */
	private onClick = (evt: MouseEvent) => {
		const target = evt.target as HTMLElement;
		// The bars of the tools and the buttons on the card take their own clicks.
		if (target.closest(".opc-columns-editor, .opc-columns-add") || !target.closest(".opc-columns-zoom")) return;
		evt.preventDefault();
		evt.stopPropagation();
		if (performance.now() < this.swallowUntil) {
			this.swallowUntil = 0;
			return;
		}
		const link = target.closest<HTMLAnchorElement>("a");
		if (link && this.openLink(link, evt)) return;
		const card = target.closest<HTMLElement>(".opc-columns-card");
		const id = card?.dataset.id;
		if (!card || !id) return;
		const now = Date.now();
		const twice = this.lastTap.id === id && now - this.lastTap.at < DOUBLE_TAP_MS;
		this.lastTap = { id, at: now };
		if (twice && card.hasClass("is-current")) {
			this.lastTap = { id: "", at: 0 };
			this.edit(id);
		} else if (card.hasClass("is-current")) this.recenter();
		else this.host.open(id);
	};

	private openLink(link: HTMLAnchorElement, evt: MouseEvent): boolean {
		if (link.hasClass("internal-link")) {
			const href = link.dataset.href ?? link.getAttribute("href") ?? "";
			const card = this.cardLinkTarget(href);
			if (card) this.host.open(card);
			else void this.app.workspace.openLinkText(href, this.canvas.view.file?.path ?? "", Keymap.isModEvent(evt));
			return true;
		}
		const href = link.getAttribute("href") ?? "";
		if (link.hasClass("external-link") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
			window.open(href, "_blank");
			return true;
		}
		return false;
	}

	/** The card of this canvas a link points to (as page links do), if any. */
	private cardLinkTarget(href: string): string | null {
		const hash = href.indexOf("#");
		if (hash < 0) return null;
		const path = href.slice(0, hash);
		const file = this.canvas.view.file;
		const dest = path ? this.app.metadataCache.getFirstLinkpathDest(path, file?.path ?? "") : file;
		const id = href.slice(hash + 1).replace(/^\^/, "");
		return dest && dest === file && this.canvas.nodes.has(id) ? id : null;
	}

	// ---------- editing ----------

	/** Edits a text card in place; `fresh`: a card just added, taken away again if left empty. */
	edit(id: string, fresh = false): void {
		const node = this.canvas.nodes.get(id);
		const card = this.cardEl(id);
		if (!node || !card || nodeType(node) !== "text" || this.editing || !this.host.editable()) return;
		const before = node.text ?? "";
		const body = card.querySelector<HTMLElement>(".opc-columns-body");
		body?.hide();
		card.addClass("is-editing");
		const input = card.createEl("textarea", { cls: "opc-columns-editor", attr: { dir: "auto", rows: "1" } });
		input.value = before;
		const fit = () => {
			input.setCssProps({ height: "auto" });
			input.setCssProps({ height: `${input.scrollHeight + 2}px` });
		};
		let cancelled = false;
		input.addEventListener("input", fit);
		input.addEventListener("pointerdown", (e) => e.stopPropagation());
		input.addEventListener("keydown", (e) => {
			e.stopPropagation();
			if (e.key === "Escape") {
				cancelled = true;
				input.blur();
			} else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) input.blur();
		});
		input.addEventListener("blur", () => {
			this.editing = null;
			card.removeClass("is-editing");
			if (fresh && (cancelled || !input.value.trim())) {
				this.host.discard(id);
				return;
			}
			if (cancelled || input.value === before) {
				input.remove();
				body?.show();
				return;
			}
			if (!this.host.save(id, input.value)) new Notice(this.ctx.t("presentation.columns.saveFailed"));
			this.redraw();
		});
		this.editing = { id, input };
		input.focus();
		fit();
	}

	/** True while a card is being edited here (keys go to the editor). */
	isEditing(): boolean {
		return !!this.editing;
	}

	destroy(): void {
		this.resizer.disconnect();
		this.editing?.input.blur();
		this.component.unload();
		this.el.remove();
	}
}

/** Classes of a board card that describe it, not its state on the board (selected, hidden…). */
function keepClass(cls: string): boolean {
	if (cls === "canvas-node" || cls === "opc-walk-current" || cls === "opc-hl-open") return false;
	if (cls.startsWith("is-") && cls !== "is-themed") return false;
	return !/^opc-(hidden|page-hidden|layer-hidden)/.test(cls);
}

/**
 * Rendered Markdown made to look like the board's reading view of a card: each top-level block
 * in its own wrapper, list bullets and fold arrows as elements of their own (they take room).
 */
export function wrapBlocks(sizer: HTMLElement): void {
	const view = sizer.parentElement;
	const foldHeadings = !!view?.hasClass("allow-fold-headings");
	const foldLists = !!view?.hasClass("allow-fold-lists");
	for (const child of Array.from(sizer.children)) {
		if (child.hasClass("markdown-preview-pusher")) continue;
		const wrap = sizer.createDiv({ cls: `el-${child.tagName.toLowerCase()}` });
		sizer.insertBefore(wrap, child);
		wrap.appendChild(child);
		if (foldHeadings && /^H[1-6]$/.test(child.tagName)) child.prepend(foldArrow("heading-collapse-indicator"));
		// The reading view gives a table the direction of its first letter, and each cell its own.
		if (child.tagName === "TABLE") {
			wrap.setAttribute("dir", firstStrongDir(child.textContent ?? ""));
			for (const cell of Array.from(child.querySelectorAll("th, td"))) cell.setAttribute("dir", firstStrongDir(cell.textContent ?? ""));
		}
	}
	for (const ul of Array.from(sizer.querySelectorAll("ul"))) {
		ul.addClass("has-list-bullet");
		for (const li of Array.from(ul.children)) if (li.tagName === "LI" && !li.querySelector(":scope > .list-bullet")) li.prepend(createSpan({ cls: "list-bullet" }));
	}
	if (foldLists) for (const li of Array.from(sizer.querySelectorAll("li"))) if (li.querySelector(":scope > ul, :scope > ol")) li.prepend(foldArrow("list-collapse-indicator"));
}

const RTL_CHAR = /[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefc]/;
const LETTER = /\p{L}/u;

/** The direction of the first letter in `text` (left-to-right when there is none). */
export function firstStrongDir(text: string): "ltr" | "rtl" {
	for (const ch of text) {
		if (RTL_CHAR.test(ch)) return "rtl";
		if (LETTER.test(ch)) return "ltr";
	}
	return "ltr";
}

function foldArrow(cls: string): HTMLElement {
	const span = createSpan({ cls: [cls, "collapse-indicator", "collapse-icon"] });
	setIcon(span, "right-triangle");
	return span;
}
