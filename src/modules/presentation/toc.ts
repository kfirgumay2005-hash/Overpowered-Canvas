import { Component, Keymap, Menu, Notice, setIcon, type App, type EventRef } from "obsidian";
import type { ModuleContext } from "../../core/module";
import { logError } from "../../core/log";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { nodeText } from "../canvas-markdown/structure";
import { cssColor } from "../minimap/logic";
import { pagesHost } from "../pages/api";
import { canvasDirection, mutate, nodeType } from "../shared";
import { joinTopLane, LANE_RANK } from "../../ui/top-lane";
import { renderTitle, titleMarkdown } from "../../ui/card-title";
import { CardFaces } from "./card-face";
import { zoomAround, type View } from "./column-layout";
import { mapModel } from "./map-model";
import { cardsOf, isGroup, moveIn, normalize, recolor, simpleArrangement, ungroup, type Side, type TocArrangement, type TocDrop, type TocMoving, type TocTree } from "./toc-layout";
import { orderedChildren, treeParent } from "./walk";

export type TocMode = "simple" | "free";

export interface TocOptions {
	/** Simple: rows of `perRow` cells. Free: cells can be dragged into rows and cell groups. */
	mode: TocMode;
	perRow: number;
	/** Widest a cell gets (text wraps), unless cards keep their size on the board. */
	cellWidth: number;
	/** Cells at their size on the board, with the handwriting on them. */
	actualSize: boolean;
	/** Text size in px; 0 = as the canvas shows its cards. */
	fontSize: number;
}

/** What the table of contents shows: the children of `parent` on `page` ("" = the page's top cards). */
interface Level {
	page: string;
	parent: string;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** A press that moves farther than this is a drag, not a tap. */
const DRAG_START = 8;
const DOUBLE_TAP_MS = 400;
/** Board changes are shown this long after the last one. */
const REFRESH_MS = 80;
/** Canvas colors offered for a group's outline, with their names. */
const COLOR_NAMES = { "1": "drawing.color.red", "2": "drawing.color.orange", "3": "drawing.color.yellow", "4": "drawing.color.green", "5": "drawing.color.blue", "6": "drawing.color.purple" } as const;

/** The key under which a level's arrangement is stored (see OpcRoot.tocLayouts). */
export function tocKey(level: Level): string {
	return level.parent || `page:${level.page}`;
}

interface Press {
	id: number;
	x: number;
	y: number;
	moved: boolean;
	/** What a drag of this press moves (free arrangement), if anything. */
	target: TocMoving | null;
	/** The card pressed, for taps. */
	card: string | null;
	grip: string | null;
}

interface Drag {
	moving: TocMoving;
	ghost: HTMLElement;
	dx: number;
	dy: number;
	drop: TocDrop | null;
}

/**
 * The table of contents: the children of one card shown together as cells of a grid, inside a
 * box named after the card. A cell whose card has children has an arrow that opens its own grid;
 * the back button goes up a level. Simple grid: rows of N cells. Free arrangement: drag cells
 * beside or below each other into cell groups (colored outlines), move groups, start new rows;
 * the arrangement is stored with the canvas. A view of the same board: edits show everywhere.
 */
export class TocView {
	private readonly el: HTMLElement;
	private readonly zoomEl: HTMLElement;
	private readonly sheet: HTMLElement;
	private readonly guide: HTMLElement;
	private readonly backEl: HTMLElement;
	private readonly controls: HTMLElement;
	private readonly faces: CardFaces;
	private readonly resizer: ResizeObserver;
	private component = new Component();
	private view: View = { zoom: 1, x: 0, y: 0 };
	private level: Level;
	private arrangement: TocArrangement = { rows: [] };
	private children: string[] = [];
	private pointers = new Map<number, { x: number; y: number }>();
	private press: Press | null = null;
	private pinch: { dist: number; zoom: number; mid: { x: number; y: number } } | null = null;
	private drag: Drag | null = null;
	private lastTap = { id: "", at: 0 };
	private editing: HTMLTextAreaElement | null = null;
	private timer = 0;
	private readonly leaveLane: () => void;

	constructor(
		private readonly app: App,
		private readonly ctx: ModuleContext<object>,
		private readonly canvas: CanvasLike,
		private readonly options: () => TocOptions,
		private readonly setOptions: (patch: Partial<TocOptions>) => void,
		private readonly onClose: () => void,
		start: Level,
	) {
		this.level = start;
		this.faces = new CardFaces(app, ctx, canvas);
		this.el = canvas.wrapperEl.createDiv({ cls: "opc-toc", attr: { dir: "ltr" } });
		this.zoomEl = this.el.createDiv({ cls: "opc-toc-zoom" });
		this.sheet = this.zoomEl.createDiv({ cls: "opc-toc-sheet" });
		this.guide = this.el.createDiv({ cls: "opc-toc-guide" });
		this.guide.hide();
		// The way back up, always at hand whatever the zoom (top right, below the pages bar).
		this.backEl = this.el.createEl("button", { cls: "clickable-icon opc-toc-back is-fixed", attr: { "aria-label": ctx.t("presentation.toc.back") } });
		setIcon(this.backEl, "corner-left-up");
		this.backEl.addEventListener("pointerdown", (e) => e.stopPropagation());
		this.backEl.addEventListener("click", (e) => {
			e.preventDefault();
			this.back();
		});
		this.leaveLane = joinTopLane(this.el, this.backEl, LANE_RANK.palette);
		this.controls = this.el.createDiv({ cls: "opc-toc-controls" });
		this.el.addEventListener("pointerdown", this.onDown);
		this.el.addEventListener("pointermove", this.onMove);
		this.el.addEventListener("pointerup", this.onUp);
		this.el.addEventListener("pointercancel", this.onCancel);
		this.el.addEventListener("wheel", this.onWheel, { passive: false });
		this.el.addEventListener("click", this.onClick, true);
		this.resizer = new ResizeObserver(() => this.applyView());
		this.resizer.observe(this.el);
		this.component.load();
		this.render(false);
	}

	destroy(): void {
		this.el.win.clearTimeout(this.timer);
		this.resizer.disconnect();
		this.editing?.blur();
		this.leaveLane();
		this.component.unload();
		this.el.remove();
	}

	isEditing(): boolean {
		return !!this.editing;
	}

	/** The board changed: draw again soon (not while a card is edited or a cell dragged). */
	schedule(): void {
		const win = this.el.win;
		win.clearTimeout(this.timer);
		this.timer = win.setTimeout(() => {
			if (this.editing || this.drag) return this.schedule();
			this.render(true);
		}, REFRESH_MS);
	}

	/** Another page shown on the board: its top level. */
	pageShown(page: string): void {
		if (page === this.level.page) return;
		this.level = { page, parent: "" };
		this.render(false);
	}

	shownPage(): string {
		return this.level.page;
	}

	// ---------- levels ----------

	private model() {
		const { nodes, edges, order } = mapModel(this.ctx, this.canvas, this.level.page);
		const rtl = canvasDirection(this.canvas) === "rtl";
		const kids = (id: string) => orderedChildren(nodes, edges, id, rtl, order).map((n) => n.id);
		const roots = () =>
			[...nodes.values()]
				.filter((n) => !edges.some((e) => e.to === n.id))
				.sort((a, b) => a.y - b.y || a.x - b.x)
				.map((n) => n.id);
		return { nodes, edges, kids, roots };
	}

	/** Pages: a card whose branch is on a page of its own leads there. */
	private pageOfAnchor(id: string): { page: string; root: string } | null {
		const info = (this.ctx.data.root(this.canvas).get().pages ?? []).find((p) => p.anchor === id);
		return info && this.canvas.nodes.has(info.root) ? { page: info.id, root: info.root } : null;
	}

	private go(level: Level, keepView = false): void {
		// The level first: showing its page on the board tells this view (pageShown) it is there.
		this.level = level;
		const api = pagesHost.api;
		if (api && level.page !== api.current(this.canvas)) api.show(this.canvas, level.page);
		this.render(keepView);
	}

	/** Into the grid of a cell's children (on its page, for a card that leads to a page). */
	enter(id: string): void {
		const link = this.pageOfAnchor(id);
		if (link) this.go({ page: link.page, parent: link.root });
		else this.go({ page: this.level.page, parent: id });
	}

	/** One level up: the parent's parent's grid; from a page's first card, back to its page's parent. */
	back(): void {
		const { parent, page } = this.level;
		if (!parent) {
			// The top of a page: the level its anchor is on.
			const info = (this.ctx.data.root(this.canvas).get().pages ?? []).find((p) => p.id === page);
			if (info) return this.backToAnchor(info.anchor, info.parent ?? "");
			return;
		}
		const info = (this.ctx.data.root(this.canvas).get().pages ?? []).find((p) => p.root === parent && p.id === page);
		if (info) return this.backToAnchor(info.anchor, info.parent ?? "");
		const { nodes, edges } = this.model();
		const up = treeParent(nodes, edges, parent, new Map());
		this.go({ page, parent: up ?? "" });
	}

	private backToAnchor(anchor: string, page: string): void {
		const { nodes, edges } = mapModel(this.ctx, this.canvas, page);
		this.go({ page, parent: treeParent(nodes, edges, anchor, new Map()) ?? "" });
	}

	private canGoBack(): boolean {
		if (this.level.parent) return true;
		return (this.ctx.data.root(this.canvas).get().pages ?? []).some((p) => p.id === this.level.page);
	}

	/** The box's title: the parent card's first line, formatted as on the card (a group's name, the file's name). */
	private renderTitle(el: HTMLElement): void {
		const { parent, page } = this.level;
		const node = parent ? this.canvas.nodes.get(parent) : undefined;
		const info = !node && page ? (this.ctx.data.root(this.canvas).get().pages ?? []).find((p) => p.id === page) : undefined;
		const card = node ?? (info ? this.canvas.nodes.get(info.root) : undefined);
		const path = this.canvas.view.file?.path ?? "";
		if (card && nodeType(card) !== "group") {
			const md = titleMarkdown(nodeText(card.getData()));
			if (md) return renderTitle(this.app, el, md, path);
		}
		el.addClass("opc-title");
		el.setText(card ? (nodeType(card) === "group" ? card.label ?? "" : "") || "…" : (this.canvas.view.file?.basename ?? ""));
	}

	// ---------- drawing ----------

	private render(keepView: boolean): void {
		const opts = this.options();
		this.component.unload();
		this.component = new Component();
		this.component.load();
		this.sheet.empty();
		const model = this.model();
		if (this.level.parent && !model.nodes.has(this.level.parent)) this.level = { page: this.level.page, parent: "" };
		const children = this.level.parent ? model.kids(this.level.parent) : model.roots();
		this.children = children;
		const stored = this.ctx.data.root(this.canvas).get().tocLayouts?.[tocKey(this.level)];
		this.arrangement = opts.mode === "simple" ? simpleArrangement(children, opts.perRow) : normalize(stored, children, opts.perRow);
		const free = opts.mode === "free" && this.editable();
		this.el.toggleClass("is-free", free);
		this.el.toggleClass("is-actual-size", opts.actualSize);
		const canvasFont = this.faces.canvasFontSize();
		const font = opts.fontSize > 0 ? opts.fontSize : canvasFont;
		this.el.setCssProps({ "--opc-columns-font-size": `${font}px`, "--opc-columns-width": `${opts.cellWidth}px` });
		this.backEl.toggle(this.canGoBack());

		const head = this.sheet.createDiv({ cls: "opc-toc-head" });
		this.renderTitle(head.createSpan({ cls: "opc-toc-title" }));
		if (this.canGoBack()) {
			const up = head.createEl("button", { cls: "clickable-icon opc-toc-back", attr: { "aria-label": this.ctx.t("presentation.toc.back") } });
			setIcon(up, "corner-left-up");
			up.addEventListener("pointerdown", (e) => e.stopPropagation());
			up.addEventListener("click", (e) => {
				e.preventDefault();
				this.back();
			});
		}
		const grid = this.sheet.createDiv({ cls: "opc-toc-grid" });
		if (!children.length) grid.createDiv({ cls: "opc-toc-empty", text: this.ctx.t("presentation.toc.empty") });
		const presets: Record<string, string> = {};
		const body = getComputedStyle(this.el.doc.body);
		for (let i = 1; i <= 6; i++) presets[String(i)] = body.getPropertyValue(`--canvas-color-${i}`);
		const pending: Promise<void>[] = [];
		this.arrangement.rows.forEach((row, r) => {
			const rowEl = grid.createDiv({ cls: "opc-toc-row", attr: { "data-row": String(r) } });
			for (const block of row) {
				const blockEl = rowEl.createDiv({ cls: "opc-toc-block", attr: { "data-block": block.id } });
				if (isGroup(block)) {
					blockEl.addClass("is-group");
					const color = cssColor(block.color, presets);
					if (color) blockEl.setCssProps({ "--opc-toc-group": color });
					if (free) {
						const grip = blockEl.createEl("button", { cls: "clickable-icon opc-toc-grip", attr: { "aria-label": this.ctx.t("presentation.toc.group"), "data-block": block.id } });
						setIcon(grip, "grip-horizontal");
					}
				}
				this.renderTree(blockEl, block.tree, model.kids, opts, font, canvasFont, pending);
			}
		});
		this.renderControls(opts);
		this.applyView(!keepView);
		Promise.all(pending).then(
			() => this.applyView(!keepView),
			(e) => logError("[overpowered-canvas] table of contents: render", e),
		);
		this.ctx.events.emit("toc-shown", this.canvas, this.level.parent);
	}

	private renderTree(parentEl: HTMLElement, tree: TocTree, kids: (id: string) => string[], opts: TocOptions, font: number, canvasFont: number, pending: Promise<void>[]): void {
		if (typeof tree !== "string") {
			const split = parentEl.createDiv({ cls: `opc-toc-split is-${tree.dir}` });
			for (const item of tree.items) this.renderTree(split, item, kids, opts, font, canvasFont, pending);
			return;
		}
		const node = this.canvas.nodes.get(tree);
		if (!node) return;
		const cell = parentEl.createDiv({ cls: "opc-toc-cell", attr: { "data-id": tree } });
		const card = cell.createDiv({ cls: "opc-columns-card opc-toc-card", attr: { dir: "auto", "data-id": tree } });
		card.toggleClass("is-group", nodeType(node) === "group");
		const filled = this.faces.fill(card, node, { actual: opts.actualSize, font, canvasFont }, this.component);
		if (filled) pending.push(filled);
		if (kids(tree).length || this.pageOfAnchor(tree)) {
			cell.addClass("has-children");
			const open = cell.createEl("button", { cls: "clickable-icon opc-toc-open", attr: { "aria-label": this.ctx.t("presentation.toc.openCell"), "data-id": tree } });
			setIcon(open, "corner-down-right");
			open.addEventListener("pointerdown", (e) => e.stopPropagation());
			open.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.enter(tree);
			});
		}
	}

	/** Zoom, the two options and closing, bottom right. */
	private renderControls(opts: TocOptions): void {
		this.controls.empty();
		const button = (cls: string, icon: string, label: string, run: () => void, active = false) => {
			const b = this.controls.createEl("button", { cls: `clickable-icon opc-toc-${cls}`, attr: { "aria-label": label } });
			setIcon(b, icon);
			b.toggleClass("is-active", active);
			b.addEventListener("pointerdown", (e) => e.stopPropagation());
			b.addEventListener("click", (e) => {
				e.preventDefault();
				run();
			});
		};
		button("zoom-in", "zoom-in", this.ctx.t("presentation.walk.zoomIn"), () => this.zoomBy(1.25));
		button("zoom-out", "zoom-out", this.ctx.t("presentation.walk.zoomOut"), () => this.zoomBy(0.8));
		button("actual", "scan", this.ctx.t("presentation.tocActualSize.name"), () => this.setOptions({ actualSize: !opts.actualSize }), opts.actualSize);
		button("mode", opts.mode === "free" ? "layout-dashboard" : "layout-grid", this.ctx.t(opts.mode === "free" ? "presentation.toc.toSimple" : "presentation.toc.toFree"), () => this.setOptions({ mode: opts.mode === "free" ? "simple" : "free" }), opts.mode === "free");
		button("close", "x", this.ctx.t("presentation.toc.close"), () => this.onClose());
	}

	/** Re-draws with the options changed (zoom and scroll kept). */
	refresh(): void {
		this.render(true);
	}

	private applyView(center = false): void {
		if (center) {
			// The sheet's top-left a little in from the view's, at the zoom kept.
			this.view = { zoom: this.view.zoom, x: 24, y: 64 };
			const w = this.el.clientWidth;
			const sw = this.sheet.offsetWidth * this.view.zoom;
			if (w && sw < w) this.view.x = Math.round((w - sw) / 2);
		}
		this.zoomEl.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.zoom})`;
	}

	zoomBy(factor: number, at?: { x: number; y: number }): void {
		const r = this.el.getBoundingClientRect();
		const point = at ? { x: at.x - r.left, y: at.y - r.top } : { x: r.width / 2, y: r.height / 2 };
		this.view = zoomAround(this.view, Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.view.zoom * factor)), point);
		this.applyView();
		this.el.toggleClass("is-zoomed", Math.abs(this.view.zoom - 1) > 0.01);
	}

	private editable(): boolean {
		return !this.canvas.readonly;
	}

	// ---------- pointer ----------

	private onDown = (evt: PointerEvent) => {
		evt.stopPropagation();
		const target = evt.target as HTMLElement;
		if (target.closest("textarea, .opc-toc-controls")) return;
		this.pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
		if (this.pointers.size === 2) {
			const [a, b] = [...this.pointers.values()];
			this.pinch = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, zoom: this.view.zoom, mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
			this.cancelDrag();
			this.press = null;
			return;
		}
		if (this.pointers.size > 2 || (evt.pointerType === "mouse" && evt.button !== 0)) return;
		const free = this.el.hasClass("is-free");
		const grip = target.closest<HTMLElement>(".opc-toc-grip")?.dataset.block ?? null;
		const cell = target.closest<HTMLElement>(".opc-toc-cell")?.dataset.id ?? null;
		const group = !cell ? target.closest<HTMLElement>(".opc-toc-block.is-group")?.dataset.block ?? null : null;
		let moving: TocMoving | null = null;
		if (free && (grip ?? group)) moving = { kind: "block", block: (grip ?? group)! };
		else if (free && cell) moving = { kind: "card", card: cell };
		this.press = { id: evt.pointerId, x: evt.clientX, y: evt.clientY, moved: false, target: moving, card: cell, grip };
	};

	private onMove = (evt: PointerEvent) => {
		const prev = this.pointers.get(evt.pointerId);
		if (!prev) return;
		const now = { x: evt.clientX, y: evt.clientY };
		this.pointers.set(evt.pointerId, now);
		if (this.pinch && this.pointers.size >= 2) {
			evt.preventDefault();
			const [a, b] = [...this.pointers.values()];
			const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
			// Two fingers move the view as well as zoom it.
			this.view = { ...this.view, x: this.view.x + mid.x - this.pinch.mid.x, y: this.view.y + mid.y - this.pinch.mid.y };
			this.pinch.mid = mid;
			const target = (this.pinch.zoom * Math.hypot(a!.x - b!.x, a!.y - b!.y)) / this.pinch.dist;
			this.zoomBy(target / this.view.zoom, mid);
			return;
		}
		const press = this.press;
		if (!press || press.id !== evt.pointerId) return;
		if (!press.moved && Math.hypot(now.x - press.x, now.y - press.y) < DRAG_START) return;
		evt.preventDefault();
		if (!press.moved) {
			press.moved = true;
			try {
				this.el.setPointerCapture(evt.pointerId);
			} catch {
				// Synthetic pointers can't be captured; moves still arrive over the view.
			}
			if (press.target) this.startDrag(press.target, press.x, press.y);
			else this.el.addClass("is-panning");
		}
		if (this.drag) return this.moveDrag(now.x, now.y);
		this.view = { ...this.view, x: this.view.x + now.x - prev.x, y: this.view.y + now.y - prev.y };
		this.applyView();
	};

	private onUp = (evt: PointerEvent) => {
		this.pointers.delete(evt.pointerId);
		if (this.pointers.size < 2) this.pinch = null;
		const press = this.press;
		if (!press || press.id !== evt.pointerId) return;
		this.press = null;
		this.el.removeClass("is-panning");
		if (this.drag) return this.endDrag();
		if (press.moved) return;
		if (press.grip) return this.groupMenu(press.grip, evt);
		if (!press.card) return;
		const now = Date.now();
		const twice = this.lastTap.id === press.card && now - this.lastTap.at < DOUBLE_TAP_MS;
		this.lastTap = { id: press.card, at: now };
		if (twice) {
			this.lastTap = { id: "", at: 0 };
			this.edit(press.card);
		}
	};

	private onCancel = (evt: PointerEvent) => {
		this.pointers.delete(evt.pointerId);
		if (this.pointers.size < 2) this.pinch = null;
		if (this.press?.id === evt.pointerId) this.press = null;
		this.cancelDrag();
		this.el.removeClass("is-panning");
	};

	private onWheel = (evt: WheelEvent) => {
		evt.preventDefault();
		evt.stopPropagation();
		if (evt.ctrlKey || evt.metaKey) return this.zoomBy(Math.exp(-evt.deltaY / 300), { x: evt.clientX, y: evt.clientY });
		this.view = { ...this.view, x: this.view.x - (evt.shiftKey ? evt.deltaY : evt.deltaX), y: this.view.y - (evt.shiftKey ? 0 : evt.deltaY) };
		this.applyView();
	};

	/** Links in cells open; everything else is handled by the pointer events. */
	private onClick = (evt: MouseEvent) => {
		const target = evt.target as HTMLElement;
		if (target.closest(".opc-toc-controls, .opc-toc-back, .opc-toc-open, textarea")) return;
		const link = target.closest<HTMLAnchorElement>("a");
		if (!link || !target.closest(".opc-toc-sheet")) return;
		evt.preventDefault();
		evt.stopPropagation();
		const href = link.dataset.href ?? link.getAttribute("href") ?? "";
		if (link.hasClass("internal-link")) void this.app.workspace.openLinkText(href, this.canvas.view.file?.path ?? "", Keymap.isModEvent(evt));
		else if (/^[a-z][a-z0-9+.-]*:/i.test(href)) window.open(href, "_blank");
	};

	// ---------- free arrangement ----------

	private elementOf(moving: TocMoving): HTMLElement | null {
		return moving.kind === "card" ? this.sheet.querySelector<HTMLElement>(`.opc-toc-cell[data-id="${CSS.escape(moving.card)}"]`) : this.sheet.querySelector<HTMLElement>(`.opc-toc-block[data-block="${CSS.escape(moving.block)}"]`);
	}

	private startDrag(moving: TocMoving, x: number, y: number): void {
		const source = this.elementOf(moving);
		if (!source) return;
		const r = source.getBoundingClientRect();
		const root = this.el.getBoundingClientRect();
		const ghost = source.cloneNode(true) as HTMLElement;
		ghost.addClass("opc-toc-ghost");
		ghost.setCssProps({ "--opc-ghost-w": `${source.offsetWidth}px`, "--opc-ghost-scale": String(this.view.zoom) });
		this.el.appendChild(ghost);
		source.addClass("is-dragged");
		this.drag = { moving, ghost, dx: x - r.left, dy: y - r.top, drop: null };
		this.positionGhost(x - root.left, y - root.top);
	}

	private positionGhost(x: number, y: number): void {
		const d = this.drag;
		if (!d) return;
		d.ghost.setCssProps({ "--opc-ghost-x": `${Math.round(x - d.dx)}px`, "--opc-ghost-y": `${Math.round(y - d.dy)}px` });
	}

	private moveDrag(x: number, y: number): void {
		const d = this.drag;
		if (!d) return;
		const root = this.el.getBoundingClientRect();
		this.positionGhost(x - root.left, y - root.top);
		d.drop = this.dropAt(x, y, d.moving);
		this.showGuide(d.drop);
	}

	/** Where a drag released at (x, y) lands: beside a cell, or in a cell of the grid of its own. */
	private dropAt(x: number, y: number, moving: TocMoving): TocDrop | null {
		const moved = new Set(moving.kind === "card" ? [moving.card] : cardsOf(this.arrangement.rows.flat().find((b) => b.id === moving.block)?.tree ?? ""));
		const hit = this.el.doc.elementFromPoint(x, y);
		const cell = hit?.closest<HTMLElement>(".opc-toc-cell");
		const id = cell?.dataset.id;
		if (cell && id && !moved.has(id) && this.sheet.contains(cell)) {
			const r = cell.getBoundingClientRect();
			const fx = (x - r.left) / Math.max(1, r.width);
			const fy = (y - r.top) / Math.max(1, r.height);
			const sides: [Side, number][] = [
				["left", fx],
				["right", 1 - fx],
				["top", fy],
				["bottom", 1 - fy],
			];
			sides.sort((a, b) => a[1] - b[1]);
			return { kind: "cell", card: id, side: sides[0]![0] };
		}
		const grid = this.sheet.querySelector<HTMLElement>(".opc-toc-grid");
		if (!grid) return null;
		const g = grid.getBoundingClientRect();
		const margin = 80 * this.view.zoom;
		if (x < g.left - margin || x > g.right + margin || y < g.top - margin || y > g.bottom + margin) return null;
		const rows = Array.from(grid.querySelectorAll<HTMLElement>(":scope > .opc-toc-row"));
		for (let i = 0; i < rows.length; i++) {
			const rr = rows[i]!.getBoundingClientRect();
			if (y < rr.top) return { kind: "slot", row: i, index: 0, newRow: true };
			if (y <= rr.bottom) {
				const blocks = Array.from(rows[i]!.querySelectorAll<HTMLElement>(":scope > .opc-toc-block"));
				const index = blocks.filter((b) => {
					const br = b.getBoundingClientRect();
					return br.left + br.width / 2 < x;
				}).length;
				return { kind: "slot", row: i, index, newRow: false };
			}
		}
		return { kind: "slot", row: rows.length, index: 0, newRow: true };
	}

	/** The line that shows where the dragged cell or group will land. */
	private showGuide(drop: TocDrop | null): void {
		const g = this.guide;
		if (!drop) return void g.hide();
		const root = this.el.getBoundingClientRect();
		const T = 4;
		let box: { x: number; y: number; w: number; h: number } | null = null;
		if (drop.kind === "cell") {
			const cell = this.sheet.querySelector<HTMLElement>(`.opc-toc-cell[data-id="${CSS.escape(drop.card)}"]`);
			const r = cell?.getBoundingClientRect();
			if (r) {
				box =
					drop.side === "left"
						? { x: r.left - T, y: r.top, w: T, h: r.height }
						: drop.side === "right"
							? { x: r.right, y: r.top, w: T, h: r.height }
							: drop.side === "top"
								? { x: r.left, y: r.top - T, w: r.width, h: T }
								: { x: r.left, y: r.bottom, w: r.width, h: T };
			}
			g.toggleClass("is-join", true);
		} else {
			g.toggleClass("is-join", false);
			const grid = this.sheet.querySelector<HTMLElement>(".opc-toc-grid")!;
			const gr = grid.getBoundingClientRect();
			const rows = Array.from(grid.querySelectorAll<HTMLElement>(":scope > .opc-toc-row"));
			if (drop.newRow) {
				const above = rows[drop.row - 1]?.getBoundingClientRect();
				const below = rows[drop.row]?.getBoundingClientRect();
				const y = above && below ? (above.bottom + below.top) / 2 : above ? above.bottom + 6 : below ? below.top - 6 : gr.top;
				box = { x: gr.left, y: y - T / 2, w: Math.max(60, gr.width), h: T };
			} else {
				const row = rows[drop.row]!;
				const rr = row.getBoundingClientRect();
				const blocks = Array.from(row.querySelectorAll<HTMLElement>(":scope > .opc-toc-block")).map((b) => b.getBoundingClientRect());
				const before = blocks[drop.index - 1];
				const after = blocks[drop.index];
				const x = before && after ? (before.right + after.left) / 2 : before ? before.right + 6 : after ? after.left - 6 : rr.left;
				box = { x: x - T / 2, y: rr.top, w: T, h: rr.height };
			}
		}
		if (!box) return void g.hide();
		g.show();
		g.setCssProps({ "--opc-guide-x": `${Math.round(box.x - root.left)}px`, "--opc-guide-y": `${Math.round(box.y - root.top)}px`, "--opc-guide-w": `${Math.round(box.w)}px`, "--opc-guide-h": `${Math.round(box.h)}px` });
	}

	private cancelDrag(): void {
		const d = this.drag;
		if (!d) return;
		this.drag = null;
		d.ghost.remove();
		this.guide.hide();
		this.sheet.querySelectorAll(".is-dragged").forEach((el) => el.removeClass("is-dragged"));
	}

	private endDrag(): void {
		const d = this.drag;
		this.cancelDrag();
		if (!d?.drop) return;
		const next = moveIn(this.arrangement, d.moving, d.drop, this.children, `b-${Date.now().toString(36)}`);
		if (next === this.arrangement) return;
		this.save(next);
	}

	/** Stores this level's arrangement with the canvas (one undo step). */
	private save(arrangement: TocArrangement): void {
		if (!this.editable()) return;
		const key = tocKey(this.level);
		const ok = mutate(this.ctx, this.canvas, () => {
			const root = this.ctx.data.root(this.canvas);
			const all = { ...(root.get().tocLayouts ?? {}) };
			// Arrangements of cards that are gone go with them.
			for (const k of Object.keys(all)) if (!k.startsWith("page:") && !this.canvas.nodes.has(k)) delete all[k];
			all[key] = arrangement;
			root.set({ tocLayouts: all });
		});
		if (!ok) return;
		this.ctx.events.emit("toc-arranged", this.canvas, this.level.parent);
		this.render(true);
	}

	/** A tap on a group's handle: its outline color, or ungrouping. */
	private groupMenu(block: string, evt: PointerEvent): void {
		const menu = new Menu();
		const current = this.arrangement.rows.flat().find((b) => b.id === block)?.color;
		for (const color of Object.keys(COLOR_NAMES) as (keyof typeof COLOR_NAMES)[]) {
			menu.addItem((i) =>
				i
					.setTitle(this.ctx.t(COLOR_NAMES[color]))
					.setIcon("circle")
					.setChecked(current === color)
					.onClick(() => this.save(recolor(this.arrangement, block, color))),
			);
		}
		menu.addSeparator();
		menu.addItem((i) =>
			i
				.setTitle(this.ctx.t("presentation.toc.ungroup"))
				.setIcon("ungroup")
				.onClick(() => this.save(ungroup(this.arrangement, block))),
		);
		menu.showAtPosition({ x: evt.clientX, y: evt.clientY }, this.el.doc);
	}

	// ---------- editing ----------

	/** Edits a text card in its cell; the change goes to the board card (one undo step). */
	edit(id: string): void {
		const node = this.canvas.nodes.get(id);
		const card = this.sheet.querySelector<HTMLElement>(`.opc-toc-card[data-id="${CSS.escape(id)}"]`);
		if (!node || !card || nodeType(node) !== "text" || this.editing || !this.editable()) return;
		const before = node.text ?? "";
		Array.from(card.children).forEach((c) => (c as HTMLElement).hide());
		card.addClass("is-editing");
		const input = card.createEl("textarea", { cls: "opc-columns-editor", attr: { dir: "auto", rows: "2" } });
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
			if (this.ctx.isShortcut("edit.cancel", e)) {
				cancelled = true;
				input.blur();
			} else if (this.ctx.isShortcut("edit.save", e)) input.blur();
		});
		input.addEventListener("blur", () => {
			this.editing = null;
			if (!cancelled && input.value !== before) {
				const ok = mutate(this.ctx, this.canvas, () => node.setData({ ...node.getData(), text: input.value }));
				if (!ok) new Notice(this.ctx.t("presentation.columns.saveFailed"));
			}
			this.render(true);
		});
		this.editing = input;
		input.focus();
		fit();
	}
}

/**
 * The table of contents on each canvas: opening and closing it, following the board's changes
 * and its pages, keys (Esc closes, Backspace goes up a level).
 */
export function enableToc(ctx: ModuleContext<object>, options: () => TocOptions, setOptions: (patch: Partial<TocOptions>) => void, beforeOpen: (canvas: CanvasLike) => void) {
	const views = new Map<CanvasLike, TocView>();

	const close = (canvas: CanvasLike) => {
		const view = views.get(canvas);
		if (!view) return;
		views.delete(canvas);
		view.destroy();
		canvas.wrapperEl.removeClass("opc-in-toc");
		ctx.events.emit("toc-closed", canvas);
	};

	const open = (canvas: CanvasLike, from?: CanvasNodeLike) => {
		if (views.has(canvas)) return;
		beforeOpen(canvas);
		const page = pagesHost.api?.current(canvas) ?? "";
		const { nodes, edges } = mapModel(ctx, canvas, page);
		const picked = from ?? [...canvas.selection].find((i): i is CanvasNodeLike => "nodeEl" in i);
		let parent = "";
		if (picked && nodes.has(picked.id)) {
			// A card with children: its grid; else the grid it is a cell of.
			parent = edges.some((e) => e.from === picked.id) ? picked.id : (treeParent(nodes, edges, picked.id, new Map()) ?? "");
		}
		canvas.deselectAll();
		canvas.wrapperEl.addClass("opc-in-toc");
		views.set(canvas, new TocView(ctx.app, ctx, canvas, options, setOptions, () => close(canvas), { page, parent }));
	};

	const toggle = (canvas: CanvasLike) => (views.has(canvas) ? close(canvas) : open(canvas));

	const schedule = (canvas: CanvasLike) => views.get(canvas)?.schedule();
	ctx.on("node-set-data", (node) => schedule(node.canvas));
	ctx.on("node-extra-change", (node) => schedule(node.canvas));
	ctx.on("node-added", (node) => schedule(node.canvas));
	ctx.on("node-removed", (node) => schedule(node.canvas));
	ctx.on("edge-added", (edge) => schedule(edge.canvas));
	ctx.on("edge-removed", (edge) => schedule(edge.canvas));
	ctx.on("history-apply", schedule);
	ctx.on("selection-change", (canvas) => {
		if (views.has(canvas) && canvas.selection.size) queueMicrotask(() => canvas.deselectAll());
	});
	ctx.on("data-load", close);
	const workspace = ctx.app.workspace as unknown as { on(name: string, cb: (canvas: CanvasLike, page: string) => void): EventRef };
	ctx.registerEvent(workspace.on("overpowered-canvas:page-shown", (canvas, page) => views.get(canvas)?.pageShown(page)));

	ctx.onCanvas((canvas) => {
		const win = canvas.wrapperEl.win;
		const onKey = (evt: KeyboardEvent) => {
			const view = views.get(canvas);
			if (!view || ctx.activeCanvas() !== canvas || view.isEditing()) return;
			if ((evt.target as HTMLElement | null)?.closest?.("textarea, input, [contenteditable=true]")) return;
			if (evt.key === "Escape") close(canvas);
			else if (evt.key === "Backspace") view.back();
			else return;
			evt.preventDefault();
			evt.stopPropagation();
		};
		win.addEventListener("keydown", onKey, true);
		return () => {
			win.removeEventListener("keydown", onKey, true);
			close(canvas);
		};
	});
	ctx.register(() => {
		for (const canvas of [...views.keys()]) close(canvas);
	});

	return {
		open,
		close,
		toggle,
		isOpen: (canvas: CanvasLike) => views.has(canvas),
		refresh: () => views.forEach((v) => v.refresh()),
	};
}
