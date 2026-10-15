import { TFile, setIcon, setTooltip } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasLike } from "../../internals/types";
import { canvasDirection, nodeType } from "../shared";
import { search, type Searchable } from "./logic";

const MATCH = "opc-search-match";
const CURRENT = "opc-search-current";

class CanvasSearchBar {
	private readonly el: HTMLElement;
	private readonly input: HTMLInputElement;
	private readonly countEl: HTMLElement;
	private results: Searchable[] = [];
	private index = -1;
	private noteText = new Map<string, string>();
	private runId = 0;

	constructor(
		private readonly ctx: ModuleContext<object>,
		private readonly canvas: CanvasLike,
	) {
		const t = ctx.t;
		this.el = canvas.wrapperEl.createDiv({ cls: "opc-search-bar document-search-container", attr: { role: "search" } });
		const box = this.el.createDiv({ cls: "document-search" });
		const inputWrap = box.createDiv({ cls: "search-input-container document-search-input" });
		this.input = inputWrap.createEl("input", { type: "search", attr: { placeholder: t("canvasSearch.placeholder"), "aria-label": t("canvasSearch.placeholder"), spellcheck: "false" } });
		this.countEl = inputWrap.createDiv({ cls: "document-search-count" });
		const buttons = box.createDiv({ cls: "document-search-buttons" });
		const button = (icon: string, label: string, onClick: () => void) => {
			const b = buttons.createEl("button", { cls: "clickable-icon document-search-button", attr: { "aria-label": label } });
			setIcon(b, icon);
			setTooltip(b, label);
			b.addEventListener("click", onClick);
			return b;
		};
		button("arrow-up", t("canvasSearch.previous"), () => this.step(-1));
		button("arrow-down", t("canvasSearch.next"), () => this.step(1));
		button("x", t("canvasSearch.close"), () => this.close());
		this.input.addEventListener("input", () => void this.run());
		this.input.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				this.step(evt.shiftKey ? -1 : 1);
			} else if (evt.key === "Escape") {
				evt.preventDefault();
				this.close();
			}
		});
		this.input.focus();
	}

	get isOpen(): boolean {
		return this.el.isConnected;
	}

	focus(): void {
		this.input.focus();
		this.input.select();
	}

	close(): void {
		this.clearHighlights();
		this.el.remove();
		this.canvas.wrapperEl.focus();
	}

	private async collect(): Promise<Searchable[]> {
		const items: Searchable[] = [];
		const app = this.ctx.app;
		for (const node of this.canvas.nodes.values()) {
			const type = nodeType(node);
			let text = "";
			if (type === "text") text = node.text ?? "";
			else if (type === "group") text = node.label ?? "";
			else if (type === "link") text = String((node as unknown as { url?: string }).url ?? "");
			else if (type === "file" && node.file instanceof TFile) {
				const file = node.file;
				text = file.basename;
				if (file.extension === "md") {
					let body = this.noteText.get(file.path);
					if (body === undefined) {
						body = await app.vault.cachedRead(file).catch(() => "");
						this.noteText.set(file.path, body);
					}
					text += "\n" + body;
				}
			}
			items.push({ id: node.id, kind: "node", text, x: node.x, y: node.y });
		}
		for (const edge of this.canvas.edges.values()) if (edge.label) {
			const c = edge.getCenter();
			items.push({ id: edge.id, kind: "edge", text: edge.label, x: c.x, y: c.y });
		}
		return items;
	}

	private async run(): Promise<void> {
		const run = ++this.runId;
		const items = await this.collect();
		if (run !== this.runId) return;
		this.clearHighlights();
		this.results = search(items, this.input.value, canvasDirection(this.canvas) === "rtl");
		for (const r of this.results) this.elementsOf(r).forEach((el) => el.addClass(MATCH));
		this.index = -1;
		if (this.results.length) this.step(1);
		else this.updateCount();
	}

	private step(delta: number): void {
		if (this.results.length === 0) return;
		const prev = this.results[this.index];
		if (prev) this.elementsOf(prev).forEach((el) => el.removeClass(CURRENT));
		this.index = (this.index + delta + this.results.length) % this.results.length;
		const current = this.results[this.index]!;
		this.elementsOf(current).forEach((el) => el.addClass(CURRENT));
		const item = current.kind === "node" ? this.canvas.nodes.get(current.id) : this.canvas.edges.get(current.id);
		if (item) {
			const b = item.getBBox();
			const pad = 80;
			const box = { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad };
			const view = this.canvas.getViewportBBox();
			const visible = box.minX >= view.minX && box.maxX <= view.maxX && box.minY >= view.minY && box.maxY <= view.maxY;
			if (!visible || this.canvas.zoom < -1.5) this.canvas.zoomToBbox(box);
		}
		this.updateCount();
	}

	private updateCount(): void {
		this.countEl.setText(this.results.length ? this.ctx.t("canvasSearch.count", { current: this.index + 1, total: this.results.length }) : this.input.value ? this.ctx.t("canvasSearch.none") : "");
	}

	private elementsOf(r: Searchable): Element[] {
		if (r.kind === "node") {
			const node = this.canvas.nodes.get(r.id);
			return node ? [node.nodeEl] : [];
		}
		const edge = this.canvas.edges.get(r.id);
		return edge ? [edge.lineGroupEl, ...(edge.labelElement ? [edge.labelElement.wrapperEl] : [])] : [];
	}

	private clearHighlights(): void {
		this.canvas.wrapperEl.querySelectorAll(`.${MATCH}, .${CURRENT}`).forEach((el) => el.removeClasses([MATCH, CURRENT]));
	}
}

/** Ctrl/Cmd+F inside a canvas: search cards, notes, groups, links and edge labels; Enter / Shift+Enter jump. */
export const canvasSearchModule = defineModule({
	id: "canvas-search",
	name: "canvasSearch.name",
	description: "canvasSearch.desc",
	group: "vault",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const bars = new WeakMap<CanvasLike, CanvasSearchBar>();
		const open = (canvas: CanvasLike) => {
			const existing = bars.get(canvas);
			if (existing?.isOpen) return existing.focus();
			bars.set(canvas, new CanvasSearchBar(ctx, canvas));
		};

		// Canvas-local Mod+F: only in canvases, no conflict with the editor's global "Find".
		ctx.addCanvasKey({ modifiers: ["Mod"], key: "F", handle: (canvas) => (open(canvas), true) });
		ctx.onCanvas((canvas) => () => {
			const bar = bars.get(canvas);
			if (bar?.isOpen) bar.close();
		});

		ctx.addCommand({
			id: "search-canvas",
			name: ctx.t("canvasSearch.command"),
			icon: "search",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas) return false;
				if (!checking) open(canvas);
				return true;
			},
		});
	},
});
