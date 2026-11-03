import { Component, Keymap, MarkdownRenderer, Notice, type App } from "obsidian";
import { logError } from "../../core/log";
import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { nodeText } from "../canvas-markdown/structure";
import { strokeD } from "../drawing/render";
import { pagesHost } from "../pages/api";
import { withoutLink } from "../pages/logic";
import { nodeType } from "../shared";
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

export interface ColumnHost {
	/** A card was tapped. */
	open(id: string): void;
	/** A scroll over the columns. */
	sibling(delta: number): void;
	options(): ColumnOptions;
	/** A card's text was edited here: write it to the canvas. */
	save(id: string, text: string): boolean;
}

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
	/** A drag or pinch just ended: the click that follows is not a tap. */
	private swallowClick = false;
	private editing: { id: string; input: HTMLTextAreaElement } | null = null;
	private last: { columns: Column[]; current: string; path: string[] } | null = null;
	private readonly resizer: ResizeObserver;

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
		// The view's own size (window, split, a tablet turned): the columns stay centered.
		this.resizer = new ResizeObserver(() => {
			this.view = keepZoom(this.view.zoom, this.size());
			this.layout(false);
		});
		this.resizer.observe(this.el);
		this.component.load();
	}

	// ---------- drawing ----------

	show(columns: Column[], current: string, path: string[]): void {
		this.last = { columns, current, path };
		this.editing = null;
		this.component.unload();
		this.component = new Component();
		this.component.load();
		this.track.empty();
		const opts = this.host.options();
		this.el.toggleClass("is-actual-size", opts.actualSize);
		this.el.setCssProps({ "--opc-columns-font-size": `${opts.fontSize > 0 ? opts.fontSize : this.canvasFontSize()}px`, "--opc-columns-width": `${opts.width}px` });
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
				const body = card.createDiv({ cls: "opc-columns-body markdown-preview-view markdown-rendered" });
				pending.push(MarkdownRenderer.render(this.app, this.textOf(id, nodeText(node.getData())), body, source, this.component));
				// A group is its name: at its size on the board it would be a big empty box.
				const actual = opts.actualSize && nodeType(node) !== "group";
				const width = actual ? node.width : opts.width;
				card.toggleClass("is-actual", actual);
				if (actual) {
					card.setCssProps({ "--opc-card-width": `${node.width}px`, "--opc-card-height": `${node.height}px` });
					this.drawInk(card, node);
				}
				widest = Math.max(widest, width);
				if (id === column.active) activeWidth = width;
			}
			columnEl.setCssProps({ "--opc-column-width": `${widest}px` });
			this.placed.push({ column: columnEl, card: activeCard, reach: opts.actualSize && activeWidth ? activeWidth : widest, width: widest });
		}
		this.shifts = this.placed.map(() => 0);
		this.view = keepZoom(this.view.zoom, this.size());
		this.layout(true);
		// Rendered text and images change the heights the columns are centered by.
		Promise.all(pending).then(
			() => this.layout(true),
			(e) => logError("[overpowered-canvas] columns: render", e),
		);
	}

	/** Columns back where the current card puts them (after dragging), keeping the zoom. */
	recenter(): void {
		this.shifts = this.placed.map(() => 0);
		this.view = keepZoom(this.view.zoom, this.size());
		this.layout(true);
	}

	/** Draws the walk again, keeping zoom (after an edit or a change on the board). */
	redraw(): void {
		if (this.last) this.show(this.last.columns, this.last.current, this.last.path);
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
		const shown = [...this.canvas.nodes.values()].find((n) => n.nodeEl.isConnected && nodeType(n) === "text" && n.contentEl?.querySelector(".markdown-preview-view")?.isConnected);
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

	/** A card's text without the links between it and its page: the columns cross pages anyway. */
	private textOf(id: string, text: string): string {
		let out = text;
		for (const link of pagesHost.api?.links(this.canvas) ?? []) {
			if (link.anchor === id) out = withoutLink(out, link.root);
			if (link.root === id) out = withoutLink(out, link.anchor);
		}
		return out;
	}

	// ---------- touch, mouse and wheel ----------

	private columnAt(target: EventTarget | null): number {
		const el = (target as HTMLElement | null)?.closest?.(".opc-columns-column");
		return el ? this.placed.findIndex((p) => p.column === el) : -1;
	}

	private onDown = (evt: PointerEvent) => {
		evt.stopPropagation();
		if (this.editing && (evt.target as HTMLElement).closest(".opc-columns-editor")) return;
		// A drag by touch fires no click: the flag only ever covers the click right after a drag.
		if (this.pointers.size === 0) this.swallowClick = false;
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
		if (press.moved || press.pinch) this.swallowClick = true;
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
		if (target.closest(".opc-columns-editor")) return;
		evt.preventDefault();
		evt.stopPropagation();
		if (this.swallowClick) {
			this.swallowClick = false;
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
			this.startEditing(id);
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

	private startEditing(id: string): void {
		const node = this.canvas.nodes.get(id);
		const card = this.track.querySelector<HTMLElement>(`.opc-columns-card[data-id="${CSS.escape(id)}"]`);
		if (!node || !card || nodeType(node) !== "text" || this.editing) return;
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
