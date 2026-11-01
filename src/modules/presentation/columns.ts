import { Component, MarkdownRenderer, type App } from "obsidian";
import { logError } from "../../core/log";
import type { CanvasLike } from "../../internals/types";
import { nodeText } from "../canvas-markdown/structure";
import { pagesHost } from "../pages/api";
import { withoutLink } from "../pages/logic";

export interface Column {
	ids: string[];
	/** The card of this column on the way to the current one; "" in the children's column. */
	active: string;
}

export interface ColumnHost {
	/** A card was tapped. */
	open(id: string): void;
	/** A scroll over the columns. */
	sibling(delta: number): void;
}

/** Wheel distance that counts as one step along the siblings. */
const WHEEL_STEP = 60;
/** Inertial wheels keep sending events: at most one step in this time. */
const WHEEL_PAUSE = 160;

/**
 * The map as columns, read-only: each ancestor's level to the left, the current card's siblings
 * stacked in the middle, its children to the right. The walk drives it: it only draws.
 */
export class ColumnView {
	private readonly el: HTMLElement;
	private readonly track: HTMLElement;
	private component = new Component();
	private wheel = 0;
	private lastStep = 0;

	constructor(
		private readonly app: App,
		private readonly canvas: CanvasLike,
		private readonly host: ColumnHost,
	) {
		this.el = canvas.wrapperEl.createDiv({ cls: "opc-columns" });
		// The root is always on the left, as the arrows expect; card text keeps its own direction.
		this.track = this.el.createDiv({ cls: "opc-columns-track", attr: { dir: "ltr" } });
		this.el.addEventListener("pointerdown", (evt) => evt.stopPropagation());
		this.el.addEventListener(
			"wheel",
			(evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				this.wheel += evt.deltaY;
				const now = performance.now();
				if (Math.abs(this.wheel) < WHEEL_STEP || now - this.lastStep < WHEEL_PAUSE) return;
				this.host.sibling(this.wheel);
				this.wheel = 0;
				this.lastStep = now;
			},
			{ passive: false },
		);
		this.component.load();
	}

	show(columns: Column[], current: string, path: string[]): void {
		this.component.unload();
		this.component = new Component();
		this.component.load();
		this.track.empty();
		const onPath = new Set(path);
		const source = this.canvas.view.file?.path ?? "";
		const pending: Promise<void>[] = [];
		const placed: { column: HTMLElement; card: HTMLElement | null }[] = [];
		let middle: HTMLElement | null = null;
		for (const column of columns) {
			const columnEl = this.track.createDiv({ cls: "opc-columns-column" });
			let activeCard: HTMLElement | null = null;
			for (const id of column.ids) {
				const node = this.canvas.nodes.get(id);
				if (!node) continue;
				const card = columnEl.createDiv({ cls: "opc-columns-card", attr: { dir: "auto", "data-id": id } });
				card.toggleClass("is-current", id === current);
				card.toggleClass("is-path", onPath.has(id) && id !== current);
				card.toggleClass("is-child", !column.active);
				if (id === column.active) activeCard = card;
				if (id === current) middle = columnEl;
				const body = card.createDiv({ cls: "markdown-rendered" });
				pending.push(MarkdownRenderer.render(this.app, this.textOf(id, nodeText(node.getData())), body, source, this.component));
				card.addEventListener("click", (evt) => {
					evt.preventDefault();
					this.host.open(id);
				});
			}
			placed.push({ column: columnEl, card: activeCard });
		}
		const center = () => this.center(placed, middle);
		center();
		// Rendered text changes the heights the columns are centered by.
		Promise.all(pending).then(center, (e) => logError("[overpowered-canvas] columns: render", e));
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

	/** Puts the current card's column mid-screen and each column's active card at mid-height. */
	private center(placed: { column: HTMLElement; card: HTMLElement | null }[], middle: HTMLElement | null): void {
		const { clientWidth, clientHeight } = this.el;
		if (middle) this.track.style.transform = `translateX(${Math.round(clientWidth / 2 - middle.offsetLeft - middle.offsetWidth / 2)}px)`;
		for (const { column, card } of placed) {
			const anchor = card ? card.offsetTop + card.offsetHeight / 2 : column.scrollHeight / 2;
			column.style.transform = `translateY(${Math.round(clientHeight / 2 - anchor)}px)`;
		}
	}

	destroy(): void {
		this.component.unload();
		this.el.remove();
	}
}
