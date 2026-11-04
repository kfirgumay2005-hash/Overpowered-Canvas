/**
 * Notes with pages, on screen: a note exported from a canvas with pages shows one page at a time,
 * in the editor (the other pages' lines are folded away) and in reading view, with the pages bar
 * and the pages index, as the canvas does. The links between a break-point card and its page lead
 * to that page within the note, and anything that jumps to a line (a heading link, the outline,
 * search) first shows the page that line is on. The note itself stays one ordinary file.
 */
import { EditorState, StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { MarkdownView, TFile, debounce, parseLinktext, resolveSubpath, setIcon, setTooltip, type App, type MarkdownPostProcessorContext } from "obsidian";
import { logError } from "../../core/log";
import type { ModuleContext } from "../../core/module";
import { pagesHost, pageSources, type PagesSource } from "../pages/api";
import { renderPagesBar } from "../pages/bar";
import { indexOrder } from "../pages/logic";
import { onPress } from "../../ui/press";
import type { NoteData } from "./note";
import { readPagedNote, sectionAt, type PagedNote, type PageSection } from "./paged";

/** Lines shown in an editor, [from, to) as document positions; null = the whole note. */
interface Shown {
	from: number;
	to: number;
}

const showLines = StateEffect.define<{ from: number; to: number } | null>();

function positions(state: EditorState, lines: { from: number; to: number }): Shown {
	const doc = state.doc;
	const at = (line: number) => (line >= doc.lines ? doc.length : doc.line(Math.max(1, line + 1)).from);
	return { from: at(lines.from), to: at(lines.to) };
}

function hide(state: EditorState, shown: Shown | null): DecorationSet {
	if (!shown) return Decoration.none;
	const doc = state.doc;
	const ranges: Range<Decoration>[] = [];
	// Whole lines before and after the page, folded away.
	if (shown.from > 0) ranges.push(Decoration.replace({ block: true }).range(0, Math.max(0, shown.from - 1)));
	if (shown.to < doc.length) ranges.push(Decoration.replace({ block: true }).range(doc.lineAt(shown.to).from, doc.length));
	return Decoration.set(ranges, true);
}

const pageField = StateField.define<{ shown: Shown | null; decorations: DecorationSet }>({
	create: () => ({ shown: null, decorations: Decoration.none }),
	update(value, tr) {
		let shown = value.shown;
		let changed = false;
		for (const effect of tr.effects)
			if (effect.is(showLines)) {
				shown = effect.value ? positions(tr.state, effect.value) : null;
				changed = true;
			}
		if (!changed && shown && tr.docChanged) {
			// Typing at either edge of the page stays on the page.
			shown = { from: tr.changes.mapPos(shown.from, -1), to: tr.changes.mapPos(shown.to, 1) };
			changed = true;
		}
		return changed ? { shown, decorations: hide(tr.state, shown) } : value;
	},
	provide: (field) => [EditorView.decorations.from(field, (v) => v.decorations), EditorView.atomicRanges.of((view) => view.state.field(field).decorations)],
});

/**
 * What the user types, deletes, pastes or drags changes only the page shown: a select-all and
 * delete must not wipe the pages folded away. Changes from code (the file reloaded from disk,
 * the note rewritten from its canvas) and undo pass as they are.
 */
const keepOtherPages = EditorState.changeFilter.of((tr) => {
	const shown = tr.startState.field(pageField, false)?.shown;
	if (!shown || !["input", "delete", "move", "drop"].some((e) => tr.isUserEvent(e))) return true;
	// The ranges given are the ones changes are kept out of: everything before and after the page.
	const end = tr.startState.doc.length;
	const guarded: number[] = [];
	if (shown.from > 0) guarded.push(0, shown.from - 1);
	if (shown.to < end) guarded.push(shown.to, end);
	return guarded.length ? guarded : true;
});

/** The editor extension: a note's other pages folded away, and kept safe from edits. */
export const pagedNoteExtension = [pageField, keepOtherPages];

interface Open {
	data: NoteData;
	note: PagedNote;
	/** The page shown ("" = main); `null` = the whole note. */
	page: string | null;
}

function editorOf(view: MarkdownView): EditorView | null {
	return (view.editor as unknown as { cm?: EditorView }).cm ?? null;
}

export interface PagedNotesHost {
	/** A note's canvas data (inside the note, else its separate file). */
	loadData(file: TFile, text: string): Promise<NoteData | null>;
	/** The page a note shows when it opens (item memory), "" for the main page. */
	initialPage(path: string): string;
	/** The page shown changed (to remember it). */
	pageShown(path: string, page: string): void;
}

/** Shows notes with pages one page at a time. */
export class PagedNotes {
	private readonly open = new Map<string, Open>();
	private readonly bars = new WeakMap<MarkdownView, HTMLElement>();
	private readonly refreshSoon = new Map<string, () => void>();

	constructor(
		private readonly app: App,
		private readonly ctx: ModuleContext<object>,
		private readonly host: PagedNotesHost,
	) {}

	enable(): void {
		const { ctx, app } = this;
		const follow = (linktext: string, sourcePath: string) => this.followCardLink(linktext, sourcePath);
		const jump = (view: MarkdownView, state: unknown) => this.beforeJump(view, state as Record<string, unknown> | undefined);
		ctx.registerEditorExtension(pagedNoteExtension);
		ctx.registerMarkdownPostProcessor((el, info) => this.processSection(el, info));
		const scan = () => {
			for (const view of this.markdownViews()) if (view.file) void this.refresh(view.file);
			this.dropClosed();
		};
		app.workspace.onLayoutReady(scan);
		ctx.registerEvent(app.workspace.on("file-open", scan));
		ctx.registerEvent(app.workspace.on("layout-change", scan));
		ctx.registerEvent(
			app.workspace.on("editor-change", (_editor, info) => {
				const file = (info as { file?: TFile | null }).file;
				if (file && this.open.has(file.path)) this.later(file);
			}),
		);
		ctx.registerEvent(
			app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") this.later(file);
			}),
		);
		// The index shows the pages of a note with pages too.
		const source = (view: unknown) => (view instanceof MarkdownView && view.file && this.open.has(view.file.path) ? this.sourceFor(view) : null);
		pageSources.add(source);
		ctx.register(() => pageSources.delete(source));
		// Links from a break-point card to its page (and back) stay in the note.
		ctx.patch("workspace.openLinkText (notes with pages)", app.workspace, {
			openLinkText: (next) =>
				function (this: unknown, linktext: string, sourcePath: string, newLeaf?: unknown, state?: unknown) {
					if (!newLeaf && follow(linktext, sourcePath)) return Promise.resolve();
					return next.call(this, linktext, sourcePath, newLeaf as never, state as never);
				},
		});
		// Jumps to a line (heading links, the outline, search) show that line's page first.
		ctx.patch("MarkdownView.setEphemeralState (notes with pages)", MarkdownView.prototype, {
			setEphemeralState: (next) =>
				function (this: MarkdownView, state: unknown) {
					jump(this, state);
					return next.call(this, state);
				},
		});
		ctx.register(() => {
			for (const view of this.markdownViews()) this.detach(view);
			this.open.clear();
		});
	}

	// ---------- the notes ----------

	private markdownViews(): MarkdownView[] {
		return this.app.workspace.getLeavesOfType("markdown").map((l) => l.view).filter((v): v is MarkdownView => v instanceof MarkdownView);
	}

	private viewsOf(path: string): MarkdownView[] {
		return this.markdownViews().filter((v) => v.file?.path === path);
	}

	private later(file: TFile): void {
		let run = this.refreshSoon.get(file.path);
		if (!run) {
			run = debounce(() => void this.refresh(file), 300, true);
			this.refreshSoon.set(file.path, run);
		}
		run();
	}

	private dropClosed(): void {
		for (const path of [...this.open.keys()]) if (this.viewsOf(path).length === 0) this.open.delete(path);
	}

	/** Reads a note again (it opened, or changed) and shows the right page in its views. */
	async refresh(file: TFile): Promise<void> {
		try {
			const view = this.viewsOf(file.path)[0];
			const text = view ? view.editor.getValue() : await this.app.vault.cachedRead(file);
			const data = await this.host.loadData(file, text);
			const note = readPagedNote(text, data);
			const before = this.open.get(file.path);
			if (!note || !data) {
				if (before) {
					this.open.delete(file.path);
					for (const v of this.viewsOf(file.path)) this.detach(v);
				}
				return;
			}
			let page = before ? before.page : this.host.initialPage(file.path);
			if (page !== null && !note.sections.some((s) => s.page === page)) page = "";
			this.open.set(file.path, { data, note, page });
			for (const v of this.viewsOf(file.path)) this.apply(v, !before);
			pagesHost.api?.refreshIndex();
		} catch (error) {
			logError("[overpowered-canvas] notes with pages: could not read a note", error);
		}
	}

	private section(open: Open): PageSection | null {
		return open.page === null ? null : (open.note.sections.find((s) => s.page === open.page) ?? open.note.sections[0] ?? null);
	}

	/** Shows the current page in a view: editor lines, reading view, bar. */
	private apply(view: MarkdownView, first = false): void {
		const path = view.file?.path;
		const open = path ? this.open.get(path) : undefined;
		if (!open) return;
		const section = this.section(open);
		const cm = editorOf(view);
		if (cm) {
			const lines = section ? { from: section.from, to: section.to } : null;
			const current = cm.state.field(pageField, false);
			const same = current?.shown && section && current.shown.from === positions(cm.state, lines!).from && current.shown.to === positions(cm.state, lines!).to;
			if (!same || first) cm.dispatch({ effects: showLines.of(lines) });
		}
		view.containerEl.addClass("opc-md-paged");
		this.renderBar(view, open);
		this.markReading(view, open);
		// Sections drawn before the note was known as one with pages get their line now.
		if (first && view.getMode() === "preview") view.previewMode.rerender(true);
	}

	private detach(view: MarkdownView): void {
		const cm = editorOf(view);
		if (cm?.state.field(pageField, false)?.shown) cm.dispatch({ effects: showLines.of(null) });
		view.containerEl.removeClass("opc-md-paged");
		this.bars.get(view)?.remove();
		this.bars.delete(view);
		this.markReading(view, null);
	}

	/** Shows `page` of a note (null = the whole note), at `line` if given, else at its top. */
	show(path: string, page: string | null, line?: number): void {
		const open = this.open.get(path);
		if (!open) return;
		open.page = page;
		if (page !== null) this.host.pageShown(path, page);
		for (const view of this.viewsOf(path)) {
			this.apply(view);
			const cm = editorOf(view);
			const section = this.section(open);
			const target = line ?? section?.from ?? 0;
			if (cm && view.getMode() === "source") {
				const doc = cm.state.doc;
				const pos = doc.line(Math.min(doc.lines, target + 1)).from;
				cm.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 40 }) });
			} else if (view.getMode() === "preview") view.previewMode.applyScroll(target);
		}
		pagesHost.api?.refreshIndex();
	}

	// ---------- the bar and the index ----------

	private sourceFor(view: MarkdownView): PagesSource {
		const path = view.file!.path;
		const open = () => this.open.get(path);
		return {
			key: view,
			path,
			alive: () => view.containerEl.isConnected && !!open(),
			pages: () => (open()?.note.pages ?? []).filter((p) => open()!.note.sections.some((s) => s.page === p.id)).map((p) => ({ id: p.id, anchor: p.anchor, root: p.root, ...(p.parent ? { parent: p.parent } : {}) })),
			current: () => open()?.page ?? "",
			title: (page) => (page ? open()?.note.sections.find((s) => s.page === page)?.title || this.ctx.t("pages.untitled") : (view.file?.basename ?? "")),
			count: (page) => open()?.note.sections.find((s) => s.page === page)?.count ?? 0,
			show: (page) => this.show(path, page),
		};
	}

	/**
	 * The bar above a note with pages: the index button and where you are (left), the previous
	 * and next page in reading order with "n / total", and the whole note (right). The buttons
	 * are made once per view and only updated, and each one reads the page shown when it is
	 * pressed: a bar drawn again (the note changed, the keyboard of a tablet closed) never leaves
	 * a press on a button that is gone or on a page that is no longer shown. Pressing them keeps
	 * the editor's focus, so a tablet's keyboard doesn't close and move the view mid-tap.
	 */
	private renderBar(view: MarkdownView, open: Open): void {
		let bar = this.bars.get(view);
		if (!bar || !bar.isConnected) {
			bar?.remove();
			bar = createDiv({ cls: "opc-pages-bar opc-md-pages-bar" });
			view.containerEl.insertBefore(bar, view.contentEl);
			this.bars.set(view, bar);
			const keepFocus = (evt: Event) => {
				if ((evt.target as HTMLElement | null)?.closest?.("button")) evt.preventDefault();
			};
			bar.addEventListener("mousedown", keepFocus);
			bar.addEventListener("pointerdown", keepFocus);
			bar.createDiv({ cls: "opc-md-pages-where" });
			this.makeTools(view, bar.createDiv({ cls: "opc-md-pages-tools" }));
		}
		const where = bar.querySelector<HTMLElement>(".opc-md-pages-where")!;
		renderPagesBar(where, this.sourceFor(view), this.ctx.t, () => void pagesHost.api?.openIndex());
		where.querySelector(".opc-pages-index")?.toggleClass("is-hidden", !pagesHost.api);
		this.updateTools(bar, open);
	}

	private makeTools(view: MarkdownView, tools: HTMLElement): void {
		const t = this.ctx.t;
		const button = (cls: string, icon: string, label: string, run: () => void) => {
			const b = tools.createEl("button", { cls: `clickable-icon ${cls}`, attr: { "aria-label": label } });
			setIcon(b, icon);
			setTooltip(b, label);
			onPress(b, (evt) => {
				evt.preventDefault();
				run();
			});
		};
		button("opc-md-pages-prev", "chevron-left", t("textPages.previous"), () => this.step(view, -1));
		tools.createSpan({ cls: "opc-md-pages-count" });
		button("opc-md-pages-next", "chevron-right", t("textPages.next"), () => this.step(view, 1));
		button("opc-md-pages-all", "list", t("canvasMarkdown.paged.all"), () => {
			const path = view.file?.path;
			const open = path ? this.open.get(path) : undefined;
			if (path && open) this.show(path, open.page === null ? this.host.initialPage(path) || "" : null);
		});
	}

	/** The pages of the note in the index's order (only those the note has a section for). */
	private order(open: Open): string[] {
		const pages = open.note.pages.map((p) => ({ id: p.id, anchor: p.anchor, root: p.root, ...(p.parent ? { parent: p.parent } : {}) }));
		const has = new Set(open.note.sections.map((s) => s.page));
		const listed = indexOrder(pages).filter((id) => has.has(id));
		// Sections the index can't place (a page whose parent is gone) come after, in reading order.
		return [...listed, ...open.note.sections.map((s) => s.page).filter((id) => !listed.includes(id))];
	}

	private updateTools(bar: HTMLElement, open: Open): void {
		const order = this.order(open);
		const at = open.page === null ? -1 : order.indexOf(open.page);
		const paged = open.page !== null && at >= 0;
		const prev = bar.querySelector<HTMLButtonElement>(".opc-md-pages-prev");
		const next = bar.querySelector<HTMLButtonElement>(".opc-md-pages-next");
		const count = bar.querySelector<HTMLElement>(".opc-md-pages-count");
		if (prev) prev.disabled = !paged || at === 0;
		if (next) next.disabled = !paged || at >= order.length - 1;
		if (count) {
			count.setText(paged ? `${at + 1} / ${order.length}` : "");
			count.toggle(paged);
		}
		bar.querySelector(".opc-md-pages-all")?.toggleClass("is-active", open.page === null);
	}

	/** The page before or after the one shown, in the index's order (main page, then each page with its pages). */
	private step(view: MarkdownView, delta: number): void {
		const path = view.file?.path;
		const open = path ? this.open.get(path) : undefined;
		if (!path || !open || open.page === null) return;
		const order = this.order(open);
		const target = order[order.indexOf(open.page) + delta];
		if (target !== undefined) this.show(path, target);
	}

	// ---------- links and jumps ----------

	/** A link to a card of the note's canvas: that card's page, at its line. */
	followCardLink(linktext: string, sourcePath: string): boolean {
		const open = this.open.get(sourcePath);
		if (!open?.data.canvas) return false;
		const { path, subpath } = parseLinktext(linktext);
		if (!path || !subpath) return false;
		const dest = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
		if (dest?.path !== open.data.canvas) return false;
		const id = subpath.replace(/^#\^?/, "");
		const page = open.note.pageOfCard.get(id);
		if (page === undefined) return false;
		const known = open.note.sections.some((s) => s.page === page) ? page : "";
		this.show(sourcePath, known, open.note.lines.get(id));
		return true;
	}

	private beforeJump(view: MarkdownView, state: Record<string, unknown> | undefined): void {
		const file = view.file;
		const open = file ? this.open.get(file.path) : undefined;
		if (!file || !open || !state || open.page === null) return;
		let line: number | undefined;
		if (typeof state.line === "number") line = state.line;
		else if (typeof state.subpath === "string" && state.subpath) {
			const cache = this.app.metadataCache.getFileCache(file);
			const hit = cache ? resolveSubpath(cache, state.subpath) : null;
			line = hit?.start.line;
		} else {
			const match = state.match as { matches?: [number, number][] } | undefined;
			const offset = match?.matches?.[0]?.[0];
			if (typeof offset === "number") line = view.editor.offsetToPos(offset).line;
		}
		if (line === undefined) return;
		const section = sectionAt(open.note, line);
		if (section.page !== open.page) {
			open.page = section.page;
			this.host.pageShown(file.path, section.page);
			for (const v of this.viewsOf(file.path)) this.apply(v);
			pagesHost.api?.refreshIndex();
		}
	}

	// ---------- reading view ----------

	private processSection(el: HTMLElement, info: MarkdownPostProcessorContext): void {
		const open = this.open.get(info.sourcePath);
		const at = open ? info.getSectionInfo(el) : null;
		if (!open || !at) return;
		// The reading view keeps its sections: each one says its line, to be shown or not later.
		el.dataset.opcLine = String(at.lineStart);
		this.markSection(el, open);
	}

	private markSection(el: HTMLElement, open: Open): void {
		const section = this.section(open);
		const line = Number(el.dataset.opcLine);
		el.toggleClass("opc-md-page-off", !!section && Number.isFinite(line) && (line < section.from || line >= section.to));
	}

	/** The reading view shows the sections of the page shown. */
	private markReading(view: MarkdownView, open: Open | null): void {
		// The reading view's own sections know their first line (drawn yet or not).
		const renderer = (view.previewMode as unknown as { renderer?: { sections?: { el?: HTMLElement; start?: { line?: number } }[]; queueRender?(): void } }).renderer;
		for (const s of renderer?.sections ?? []) if (s.el && typeof s.start?.line === "number" && !s.el.hasClass("mod-ui")) s.el.dataset.opcLine = String(s.start.line);
		for (const el of view.previewMode.containerEl.querySelectorAll<HTMLElement>("[data-opc-line]")) {
			// The title above the note and the footer below it are no section of any page.
			if (open && !el.hasClass("mod-ui")) this.markSection(el, open);
			else el.removeClass("opc-md-page-off");
		}
		renderer?.queueRender?.();
	}

	/** The page a note shows right now, for remembering it. */
	pageOf(path: string): string | null | undefined {
		return this.open.get(path)?.page;
	}
}
