import { MarkdownRenderer, setIcon, type App, type Component } from "obsidian";
import type { ModuleContext } from "../../core/module";
import type { CropRect } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { nodeText } from "../canvas-markdown/structure";
import { strokeD } from "../drawing/render";
import { clampRect, isFull } from "../image-crop/crop";
import { IMAGE_EXTENSIONS, nodeType } from "../shared";

/** How a card is shown in a view of the map (the column view, the table of contents). */
export interface FaceOptions {
	/** At its size on the board, laid out exactly as there, with its ink. */
	actual: boolean;
	/** Text size of the view (px). */
	font: number;
	/** Text size of the board's cards (px): a card's own size scales from it. */
	canvasFont: number;
}

/**
 * Draws board cards in other views of the same map: text laid out by the board's own styles
 * (a replica of the card's elements), pictures and crops, the card's color and the ink drawn on
 * it, so a stroke shows on the same words in every view.
 */
export class CardFaces {
	constructor(
		private readonly app: App,
		private readonly ctx: ModuleContext<object>,
		private readonly canvas: CanvasLike,
	) {}

	/**
	 * Fills `card` with `node`'s content. Returns what finishes rendering later (Markdown), if
	 * anything: heights are only known after it.
	 */
	fill(card: HTMLElement, node: CanvasNodeLike, opts: FaceOptions, component: Component): Promise<void> | null {
		const source = this.canvas.view.file?.path ?? "";
		// A group is its name: at its size on the board it would be a big empty box.
		const actual = opts.actual && nodeType(node) !== "group";
		card.toggleClass("is-actual", actual);
		this.colorCard(card, node);
		const text = nodeText(node.getData());
		const image = actual ? this.imageOf(node) : null;
		const cropped = actual ? null : this.croppedImageOf(node);
		let pending: Promise<void> | null = null;
		if (actual && nodeType(node) === "text") {
			// Laid out by the board's own styles, so handwriting lands on the same words.
			const sizer = this.textReplica(this.replica(card, node), node);
			pending = MarkdownRenderer.render(this.app, text, sizer, source, component).then(() => wrapBlocks(sizer));
		} else if (image) {
			const content = this.replica(card, node).createDiv({ cls: "canvas-node-content media-embed image-embed is-loaded" });
			content.createEl("img", { attr: { src: image, draggable: "false" } });
		} else if (cropped) {
			// A cropped picture shows only its crop, at the view's width (like on the board).
			const view = card.createDiv({ cls: "opc-crop-view", attr: { "data-opc-crop": "" } });
			view.setCssProps({ "--opc-crop-x": String(cropped.crop.x), "--opc-crop-y": String(cropped.crop.y), "--opc-crop-w": String(cropped.crop.w), "--opc-crop-h": String(cropped.crop.h), "--opc-crop-ratio": String(node.width / Math.max(1, node.height)) });
			view.createEl("img", { attr: { src: cropped.src, draggable: "false" } });
		} else {
			const body = card.createDiv({ cls: "opc-columns-body markdown-preview-view markdown-rendered" });
			pending = MarkdownRenderer.render(this.app, text, body, source, component);
		}
		if (actual) {
			card.setCssProps({ "--opc-card-width": `${node.width}px`, "--opc-card-height": `${node.height}px` });
			this.drawInk(card, node);
		}
		// A card with its own text size keeps it, in proportion to the view's size.
		const own = this.ctx.data.node(node).get().fontSize;
		if (own && !actual) card.setCssStyles({ fontSize: `${Math.round((opts.font * own) / opts.canvasFont)}px` });
		return pending;
	}

	/** Text size of the canvas's cards, so a view reads like the board (its CSS classes too). */
	canvasFontSize(): number {
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
	replica(card: HTMLElement, node: CanvasNodeLike): HTMLElement {
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
	textReplica(container: HTMLElement, node: CanvasNodeLike): HTMLElement {
		const embed = container.createDiv({ cls: "canvas-node-content markdown-embed" }).createDiv({ cls: "markdown-embed-content" });
		const live = node.contentEl?.querySelector<HTMLElement>(".markdown-preview-view");
		const view = embed.createDiv({ cls: "markdown-preview-view markdown-rendered" });
		for (const cls of live ? Array.from(live.classList) : ["show-indentation-guide", "allow-fold-headings", "allow-fold-lists"]) if (cls !== "node-insert-event") view.addClass(cls);
		const sizer = view.createDiv({ cls: "markdown-preview-sizer markdown-preview-section" });
		sizer.createDiv({ cls: "markdown-preview-pusher" });
		return sizer;
	}

	/** The image of a cropped image card (Crop images is on), and its crop. */
	croppedImageOf(node: CanvasNodeLike): { src: string; crop: CropRect } | null {
		if (!this.ctx.inspect.activeModules().includes("image-crop")) return null;
		const crop = this.ctx.data.node(node).get().crop;
		if (!crop || isFull(crop)) return null;
		const src = this.imageOf(node);
		return src ? { src, crop: clampRect(crop) } : null;
	}

	/** The address of the image a file card shows, if it shows one. */
	imageOf(node: CanvasNodeLike): string | null {
		const data = node.getData();
		if (data.type !== "file" || typeof data.file !== "string" || data.subpath) return null;
		const file = this.app.vault.getFileByPath(data.file);
		return file && IMAGE_EXTENSIONS.has(file.extension.toLowerCase()) ? this.app.vault.getResourcePath(file) : null;
	}

	/** The card's canvas color on its border. */
	colorCard(card: HTMLElement, node: CanvasNodeLike): void {
		if (!node.color) return;
		const color = getComputedStyle(node.nodeEl).getPropertyValue("--canvas-color").trim() || (node.color.startsWith("#") ? node.color : "");
		if (!color) return;
		card.addClass("has-color");
		// A bare r, g, b triple (older themes) becomes a color.
		card.setCssProps({ "--opc-card-color": /^\d+\s*,\s*\d+\s*,\s*\d+$/.test(color) ? `rgb(${color})` : color });
	}

	/** Ink drawn on the card (stuck to it, or lying on it) at its place on the card. */
	drawInk(card: HTMLElement, node: CanvasNodeLike): void {
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
