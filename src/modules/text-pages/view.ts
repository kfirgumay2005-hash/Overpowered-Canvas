import { Component, FileView, Keymap, MarkdownRenderer, Notice, Platform, TFile, debounce, normalizePath, parseLinktext, setIcon, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { ModuleContext } from "../../core/module";
import { logError } from "../../core/log";
import type { CanvasFileData } from "../../data/json-canvas";
import type { CanvasLike, CanvasViewLike } from "../../internals/types";
import { TUTORIAL_KEY } from "../../tutorials/runner";
import { pagesHost, type PagesSource } from "../pages/api";
import { renderPagesBar } from "../pages/bar";
import { mutate } from "../shared";
import { buildBook, headingMarkdown, withCardText, type Book, type BookItem, type BookPage } from "./book";

export const TEXT_PAGES_VIEW = "opc-text-pages";

interface TextState {
	file?: string;
	page?: string;
	rtl?: boolean;
	/** A card to bring into view. */
	card?: string;
}

interface WebContentsLike {
	printToPDF(options: object): Promise<Uint8Array>;
}

/** Time for embeds and math to finish drawing before the PDF is taken. */
const PRINT_SETTLE = 400;

const printAnchor = (id: string) => `opc-print-${id}`;

function webContents(): WebContentsLike | null {
	const electron = (window as unknown as { electron?: { remote?: { getCurrentWebContents?(): WebContentsLike } } }).electron;
	return Platform.isDesktopApp ? (electron?.remote?.getCurrentWebContents?.() ?? null) : null;
}

/**
 * A canvas as text, one page at a time. It shows the canvas file without changing it: every card is
 * drawn on its own, so a card and its text stay tied together, for jumping to a card and for
 * editing a card from here.
 */
export class TextPagesView extends FileView {
	override navigation = true;
	private page = "";
	private rtl = false;
	private book: Book | null = null;
	private editing = false;
	private openEditor: HTMLTextAreaElement | null = null;
	private drawn: Component | null = null;
	private editButton: HTMLElement | null = null;
	private readonly reloadSoon = debounce(() => void this.reload(), 200, true);

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: ModuleContext<object>,
	) {
		super(leaf);
	}

	getViewType(): string {
		return TEXT_PAGES_VIEW;
	}

	override getIcon(): string {
		return "book-open";
	}

	override canAcceptExtension(): boolean {
		return false;
	}

	override getDisplayText(): string {
		return this.file?.basename ?? this.ctx.t("textPages.name");
	}

	protected override async onOpen(): Promise<void> {
		await super.onOpen();
		const { t } = this.ctx;
		this.contentEl.addClass("opc-text-pages");
		this.addAction("layout-dashboard", t("textPages.toCanvas"), () => void this.showCanvas());
		this.editButton = this.addAction("pencil", t("textPages.edit"), () => this.toggleEditing());
		this.editButton.addClass("opc-text-edit-button");
		if (webContents()) this.addAction("file-output", t("textPages.pdf"), () => void this.exportPdf());
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file === this.file && !this.openEditor) this.reloadSoon();
			}),
		);
	}

	protected override async onClose(): Promise<void> {
		this.reloadSoon.cancel();
		await super.onClose();
	}

	override getState(): Record<string, unknown> {
		return { ...super.getState(), page: this.page, rtl: this.rtl };
	}

	override async setState(state: TextState, result: ViewStateResult): Promise<void> {
		await super.setState(state, result);
		const page = state.page ?? "";
		if (page !== this.page) result.history = true;
		this.page = page;
		this.rtl = state.rtl ?? this.rtl;
		await this.reload(state.card);
	}

	override async onLoadFile(): Promise<void> {
		// Drawn by setState, which knows the page.
	}

	override async onUnloadFile(): Promise<void> {
		this.book = null;
		this.contentEl.empty();
	}

	// ---------- the source ----------

	private liveCanvas(): CanvasLike | null {
		for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
			const view = leaf.view as CanvasViewLike;
			if (view.file === this.file && view.canvas) return view.canvas;
		}
		return null;
	}

	private async readData(): Promise<CanvasFileData> {
		const live = this.liveCanvas();
		if (live) return live.getData();
		const text = this.file ? await this.app.vault.read(this.file) : "";
		return text.trim() ? (JSON.parse(text) as CanvasFileData) : {};
	}

	private async reload(card?: string): Promise<void> {
		if (!this.file) return;
		const { t } = this.ctx;
		try {
			this.book = buildBook(await this.readData(), { rtl: this.rtl, mainTitle: this.file.basename, untitled: t("pages.untitled"), freeLabel: t("canvasMarkdown.freeNodes") });
		} catch (error) {
			logError("[overpowered-canvas] text pages: could not read the canvas", error);
			this.book = null;
			this.contentEl.empty();
			this.contentEl.createDiv({ cls: "pane-empty", text: t("textPages.unreadable") });
			return;
		}
		if (!this.book.pages.some((p) => p.id === this.page)) this.page = "";
		await this.draw(card);
	}

	/** The pages index and the bar work from this: the same as on the board. */
	pagesSource(): PagesSource | null {
		const book = this.book;
		if (!book || !this.file) return null;
		const file = this.file;
		return {
			key: this,
			alive: () => this.contentEl.isConnected,
			pages: () => book.pages.filter((p) => p.id).map((p) => ({ id: p.id, anchor: p.anchor!, root: "", ...(p.parent ? { parent: p.parent } : {}) })),
			current: () => this.page,
			title: (id) => book.pages.find((p) => p.id === id)?.title ?? file.basename,
			count: (id) => [...book.pageOf.values()].filter((p) => p === id).length,
			show: (id) => void this.navigate(id),
		};
	}

	private async navigate(page: string, card?: string): Promise<void> {
		if (!this.file) return;
		const state: TextState = { file: this.file.path, page, rtl: this.rtl, ...(card ? { card } : {}) };
		await this.leaf.setViewState({ type: TEXT_PAGES_VIEW, state: state as Record<string, unknown>, active: true });
	}

	async showCanvas(): Promise<void> {
		if (!this.file) return;
		// A practice board is open beside this view: go back to it.
		const board = this.liveCanvas();
		if (board?.data[TUTORIAL_KEY]) {
			this.app.workspace.setActiveLeaf(board.view.leaf, { focus: true });
			this.leaf.detach();
			return;
		}
		pagesHost.api?.remember(this.file.path, this.page);
		await this.leaf.setViewState({ type: "canvas", state: { file: this.file.path }, active: true });
	}

	// ---------- drawing ----------

	private async draw(card?: string): Promise<void> {
		const book = this.book;
		const page = book?.pages.find((p) => p.id === this.page);
		if (!book || !page) return;
		const scroll = this.contentEl.querySelector(".opc-text-scroll")?.scrollTop ?? 0;
		if (this.drawn) this.removeChild(this.drawn);
		this.drawn = this.addChild(new Component());
		this.openEditor = null;
		this.contentEl.empty();
		const source = this.pagesSource();
		if (source && book.pages.length > 1) {
			const bar = this.contentEl.createDiv({ cls: "opc-pages-bar opc-text-bar" });
			renderPagesBar(bar, source, this.ctx.t, () => void pagesHost.api?.openIndex());
		}
		const scrollEl = this.contentEl.createDiv({ cls: "opc-text-scroll" });
		const article = this.pageShell(scrollEl);
		const pending: Promise<void>[] = [];
		this.drawPage(page, article, this.drawn, pending, false);
		this.drawNext(page, book, article);
		pagesHost.api?.refreshIndex();
		await Promise.all(pending).catch((e) => logError("[overpowered-canvas] text pages: render", e));
		if (card) this.reveal(card);
		else scrollEl.scrollTop = scroll;
	}

	private pageShell(parent: HTMLElement): HTMLElement {
		const shell = parent.createDiv({ cls: "markdown-preview-view markdown-rendered opc-text-page", attr: { dir: this.rtl ? "rtl" : "ltr" } });
		const vault = this.app.vault as unknown as { getConfig?(key: string): unknown };
		shell.toggleClass("is-readable-line-width", vault.getConfig?.("readableLineLength") !== false);
		shell.toggleClass("is-editing", this.editing);
		const sizer = shell.createDiv({ cls: "markdown-preview-sizer markdown-preview-section" });
		sizer.addEventListener("click", (evt) => this.onClick(evt));
		sizer.addEventListener("mouseover", (evt) => this.onHover(evt));
		return sizer;
	}

	private drawPage(page: BookPage, el: HTMLElement, owner: Component, pending: Promise<void>[], print: boolean): void {
		const list = (items: BookItem[], parent: HTMLElement) => {
			let ul: HTMLElement | null = null;
			for (const item of items) {
				if (item.heading !== undefined) {
					ul = null;
					const block = parent.createDiv({ cls: "opc-text-block", attr: { dir: "auto" } });
					this.drawItem(item, block, owner, pending, print);
					if (page.anchor !== undefined && parent === el && !el.querySelector(".opc-text-back")) this.drawBackLink(page, parent);
					list(item.children, parent);
					continue;
				}
				ul ??= parent.createEl("ul");
				const li = ul.createEl("li", { attr: { dir: "auto" } });
				this.drawItem(item, li.createDiv({ cls: "opc-text-block" }), owner, pending, print);
				if (item.children.length) list(item.children, li);
			}
		};
		list(page.items, el);
		if (page.items.length === 0) el.createDiv({ cls: "pane-empty", text: this.ctx.t("textPages.empty") });
		// A page without a heading (its root is not a text card, or it is empty) still leads back.
		if (page.anchor !== undefined && !el.querySelector(".opc-text-back")) {
			this.drawBackLink(page, el);
			el.prepend(el.lastElementChild!);
		}
	}

	private drawItem(item: BookItem, block: HTMLElement, owner: Component, pending: Promise<void>[], print: boolean): void {
		if (item.id) {
			block.dataset.card = item.id;
			if (print) block.id = printAnchor(item.id);
		}
		block.toggleClass("is-editable", item.source !== undefined);
		const body = block.createDiv({ cls: "opc-text-body" });
		const text = item.heading === undefined ? item.text : headingMarkdown(item.text, item.heading);
		pending.push(MarkdownRenderer.render(this.app, text, body, this.file?.path ?? "", owner));
		if (!item.opens) return;
		const target = this.book?.pages.find((p) => p.id === item.opens);
		const link = block.createEl("a", { cls: "opc-text-pagelink", text: target?.title ?? this.ctx.t("pages.link") });
		setIcon(link.createSpan({ cls: "opc-text-pagelink-icon" }), "arrow-right-from-line");
		this.wirePageLink(link, item.opens, print);
	}

	private drawBackLink(page: BookPage, el: HTMLElement): void {
		const parent = this.book?.pages.find((p) => p.id === (page.parent ?? ""));
		const row = el.createDiv({ cls: "opc-text-back", attr: { dir: "auto" } });
		const link = row.createEl("a", { cls: "opc-text-pagelink", text: parent?.title ?? this.ctx.t("pages.main") });
		setIcon(link.createSpan({ cls: "opc-text-pagelink-icon" }), "arrow-left-from-line");
		const parentId = page.parent ?? "";
		this.wirePageLink(link, parentId, !!el.closest(".print"), page.anchor);
	}

	private wirePageLink(link: HTMLAnchorElement, page: string, print: boolean, card?: string): void {
		if (print) {
			link.setAttr("href", `#${printAnchor(card ?? `page-${page}`)}`);
			return;
		}
		link.setAttr("href", "#");
		link.addEventListener("click", (evt) => {
			evt.preventDefault();
			evt.stopPropagation();
			void this.navigate(page, card);
		});
	}

	/** Previous and next page, at the end of each page. */
	private drawNext(page: BookPage, book: Book, el: HTMLElement): void {
		if (book.pages.length < 2) return;
		const at = book.pages.indexOf(page);
		const nav = el.createDiv({ cls: "opc-text-nav" });
		const step = (target: BookPage | undefined, icon: string, label: string) => {
			const button = nav.createEl("button", { attr: { "aria-label": label } });
			button.disabled = !target;
			setIcon(button.createSpan({ cls: "opc-text-pagelink-icon" }), icon);
			button.createSpan({ text: target?.title ?? label });
			if (target) button.addEventListener("click", () => void this.navigate(target.id));
		};
		step(book.pages[at - 1], this.rtl ? "chevron-right" : "chevron-left", this.ctx.t("textPages.previous"));
		nav.createSpan({ cls: "opc-text-count", text: `${at + 1} / ${book.pages.length}` });
		step(book.pages[at + 1], this.rtl ? "chevron-left" : "chevron-right", this.ctx.t("textPages.next"));
	}

	private reveal(card: string): void {
		const block = this.contentEl.querySelector<HTMLElement>(`[data-card="${CSS.escape(card)}"]`);
		if (!block) return;
		block.scrollIntoView({ block: "center" });
		block.addClass("is-flashing");
		window.setTimeout(() => block.removeClass("is-flashing"), 1200);
	}

	// ---------- links ----------

	private onClick(evt: MouseEvent): void {
		const target = evt.target as HTMLElement;
		const link = target.closest<HTMLAnchorElement>("a.internal-link");
		if (this.editing) {
			const block = target.closest<HTMLElement>(".opc-text-block.is-editable");
			if (block && !target.closest(".opc-text-pagelink")) {
				evt.preventDefault();
				this.startEditing(block);
			}
			return;
		}
		if (!link) return;
		evt.preventDefault();
		const href = link.dataset.href ?? link.getAttribute("href") ?? "";
		const { path, subpath } = parseLinktext(href);
		const file = this.file ? (path ? this.app.metadataCache.getFirstLinkpathDest(path, this.file.path) : this.file) : null;
		const card = subpath.replace(/^#\^?/, "");
		const page = file === this.file ? this.book?.pageOf.get(card) : undefined;
		if (page !== undefined) void this.navigate(page, card);
		else void this.app.workspace.openLinkText(href, this.file?.path ?? "", Keymap.isModEvent(evt));
	}

	private onHover(evt: MouseEvent): void {
		const link = (evt.target as HTMLElement).closest<HTMLAnchorElement>("a.internal-link");
		if (!link) return;
		this.app.workspace.trigger("hover-link", { event: evt, source: "preview", hoverParent: this, targetEl: link, linktext: link.dataset.href ?? "", sourcePath: this.file?.path ?? "" });
	}

	// ---------- editing ----------

	private toggleEditing(): void {
		if (!this.editing && this.liveCanvas()?.readonly) {
			new Notice(this.ctx.t("textPages.readonly"));
			return;
		}
		this.editing = !this.editing;
		this.editButton?.toggleClass("is-active", this.editing);
		this.contentEl.querySelector(".opc-text-page")?.toggleClass("is-editing", this.editing);
		if (!this.editing) this.openEditor?.blur();
	}

	private findItem(id: string): BookItem | null {
		const search = (items: BookItem[]): BookItem | null => {
			for (const item of items) {
				if (item.id === id) return item;
				const inner = search(item.children);
				if (inner) return inner;
			}
			return null;
		};
		for (const page of this.book?.pages ?? []) {
			const hit = search(page.items);
			if (hit) return hit;
		}
		return null;
	}

	private startEditing(block: HTMLElement): void {
		const id = block.dataset.card;
		const item = id ? this.findItem(id) : null;
		if (!id || item?.source === undefined || block.querySelector("textarea")) return;
		const before = item.source;
		const body = block.querySelector<HTMLElement>(".opc-text-body");
		body?.hide();
		const input = block.createEl("textarea", { cls: "opc-text-editor", attr: { dir: "auto", rows: "1" } });
		input.value = before;
		const fit = () => {
			input.setCssProps({ height: "auto" });
			input.setCssProps({ height: `${input.scrollHeight + 2}px` });
		};
		let cancelled = false;
		input.addEventListener("input", fit);
		input.addEventListener("keydown", (evt) => {
			if (evt.key === "Escape") {
				cancelled = true;
				input.blur();
			} else if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey)) input.blur();
		});
		input.addEventListener("blur", () => {
			this.openEditor = null;
			if (cancelled || input.value === before) {
				input.remove();
				body?.show();
			} else void this.saveCard(id, input.value);
		});
		this.openEditor = input;
		input.focus();
		fit();
	}

	/** Writes a card's text: in the open canvas (one undo step), else in the file. */
	private async saveCard(id: string, text: string): Promise<void> {
		if (!this.file) return;
		const canvas = this.liveCanvas();
		try {
			if (canvas) {
				const node = canvas.nodes.get(id);
				if (node) mutate(this.ctx, canvas, () => node.setData({ ...node.getData(), text }));
			} else await this.app.vault.process(this.file, (raw) => withCardText(raw, id, text) ?? raw);
		} catch (error) {
			logError("[overpowered-canvas] text pages: could not save a card", error);
			new Notice(this.ctx.t("textPages.saveFailed"));
		}
		await this.reload();
	}

	// ---------- PDF ----------

	/** Every page, each starting on a new PDF page, with working links between them. */
	private async exportPdf(): Promise<void> {
		const contents = webContents();
		const book = this.book;
		const file = this.file;
		if (!contents || !book || !file) return;
		const notice = new Notice(this.ctx.t("textPages.pdf.working"), 0);
		const body = this.contentEl.doc.body;
		const root = body.createDiv({ cls: "print opc-text-print" });
		const owner = this.addChild(new Component());
		try {
			const pending: Promise<void>[] = [];
			for (const page of book.pages) {
				const sheet = root.createDiv({ cls: "markdown-preview-view markdown-rendered opc-text-sheet", attr: { dir: this.rtl ? "rtl" : "ltr", id: printAnchor(`page-${page.id}`) } });
				this.drawPage(page, sheet.createDiv({ cls: "markdown-preview-sizer" }), owner, pending, true);
			}
			await Promise.all(pending);
			this.pointLinksInside(root);
			await new Promise((r) => window.setTimeout(r, PRINT_SETTLE));
			const pdf = await contents.printToPDF({ pageSize: "A4", printBackground: true, margins: { marginType: "default" } });
			const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
			const path = this.freePath(normalizePath(`${folder}${file.basename}.pdf`));
			const bytes = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
			await this.app.vault.createBinary(path, bytes);
			new Notice(this.ctx.t("textPages.pdf.done", { path }));
		} catch (error) {
			logError("[overpowered-canvas] text pages: PDF", error);
			new Notice(this.ctx.t("textPages.pdf.failed"));
		} finally {
			notice.hide();
			root.remove();
			this.removeChild(owner);
		}
	}

	/** Links to cards of this canvas lead to their place in the PDF. */
	private pointLinksInside(root: HTMLElement): void {
		for (const link of root.querySelectorAll<HTMLAnchorElement>("a.internal-link")) {
			const { path, subpath } = parseLinktext(link.dataset.href ?? "");
			const file = path && this.file ? this.app.metadataCache.getFirstLinkpathDest(path, this.file.path) : this.file;
			const card = subpath.replace(/^#\^?/, "");
			if (file === this.file && this.book?.pageOf.has(card)) link.setAttr("href", `#${printAnchor(card)}`);
		}
	}

	private freePath(path: string): string {
		if (!this.app.vault.getAbstractFileByPath(path)) return path;
		const dot = path.lastIndexOf(".");
		for (let i = 2; ; i++) {
			const next = `${path.slice(0, dot)} ${i}${path.slice(dot)}`;
			if (!this.app.vault.getAbstractFileByPath(next)) return next;
		}
	}
}

export function isCanvasFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === "canvas";
}
