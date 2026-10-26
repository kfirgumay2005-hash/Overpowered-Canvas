import { FuzzySuggestModal, MarkdownView, Modal, Notice, Setting, TFile, normalizePath, type App, type MenuItem, type WorkspaceLeaf } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasFileData } from "../../data/json-canvas";
import { MAP_LAYOUTS, type MapLayout } from "../../data/schema";
import type { I18nKey, Translate } from "../../i18n";
import type { CanvasLike, CanvasNodeLike, CanvasViewLike, Point } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { disposeElk, getElk } from "../auto-layout/engine";
import { descendants } from "../mindmap/tree";
import { canvasDirection, mutate, nodeType, randomId, selectedNodes } from "../shared";
import { applyNote, type ApplyOptions, type ApplyResult } from "./apply";
import { exportNote, rootMapLayouts, splitNote } from "./note";
import { countItems, isOutline, stripFrontmatter, writeOutline } from "./outline";
import { buildStructure } from "./structure";

interface CanvasMarkdownSettings {
	indent: "tab" | "4" | "2";
	layout: MapLayout;
	pasteOutlines: boolean;
}

/** Layouts offered for new maps (the auto layout's mind-map directions). */
const NEW_MAP_LAYOUTS: MapLayout[] = ["right", "left", "down", "up", "balanced", "radial"];
const INDENTS: Record<CanvasMarkdownSettings["indent"], string> = { tab: "\t", "4": "    ", "2": "  " };

class NotePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		t: Translate,
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(t("canvasMarkdown.pickNote"));
	}
	getItems(): TFile[] {
		return this.app.vault.getMarkdownFiles();
	}
	getItemText(file: TFile): string {
		return file.path;
	}
	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

/** Asks what to do with an existing note that isn't linked to the canvas. */
class ReplaceModal extends Modal {
	private answered = false;
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly name: string,
		private readonly onAnswer: (choice: "replace" | "separate" | null) => void,
	) {
		super(app);
	}
	override onOpen(): void {
		const { t } = this;
		this.setTitle(t("canvasMarkdown.replace.title"));
		this.contentEl.createEl("p", { text: t("canvasMarkdown.replace.desc", { name: this.name }) });
		const answer = (choice: "replace" | "separate" | null) => {
			this.answered = true;
			this.close();
			this.onAnswer(choice);
		};
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => answer(null)))
			.addButton((b) => b.setButtonText(t("canvasMarkdown.replace.separate")).onClick(() => answer("separate")))
			.addButton((b) => b.setButtonText(t("canvasMarkdown.replace.replace")).setWarning().onClick(() => answer("replace")));
	}
	override onClose(): void {
		this.contentEl.empty();
		if (!this.answered) this.onAnswer(null);
	}
}

function siblingPath(file: TFile, extension: string, suffix = ""): string {
	const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
	return normalizePath(`${folder}${file.basename}${suffix}.${extension}`);
}

function availablePath(app: App, path: string): string {
	if (!app.vault.getAbstractFileByPath(path)) return path;
	const dot = path.lastIndexOf(".");
	for (let i = 2; ; i++) {
		const next = `${path.slice(0, dot)} ${i}${path.slice(dot)}`;
		if (!app.vault.getAbstractFileByPath(next)) return next;
	}
}

/**
 * Canvas ⇄ Markdown: copy a map as an outline, turn outlines and notes into mind maps, and
 * mirror a whole canvas as a Markdown note (outline + hidden layout data) and back, so the
 * same content can be edited as text and as a board.
 */
export const canvasMarkdownModule = defineModule<CanvasMarkdownSettings>({
	id: "canvas-markdown",
	name: "canvasMarkdown.name",
	description: "canvasMarkdown.desc",
	group: "data",
	defaultEnabled: true,
	defaultSettings: { indent: "tab", layout: "right", pasteOutlines: true },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			indent: s.indent in INDENTS ? s.indent : defaults.indent,
			layout: (MAP_LAYOUTS as readonly string[]).includes(s.layout) ? s.layout : defaults.layout,
			pasteOutlines: typeof s.pasteOutlines === "boolean" ? s.pasteOutlines : defaults.pasteOutlines,
		};
	},

	enable(ctx) {
		const app = ctx.app;
		ctx.register(disposeElk);
		const t = ctx.t;
		const indent = () => INDENTS[ctx.settings.indent];
		const rtlOf = (canvas: CanvasLike | null) => (canvas ? canvasDirection(canvas) === "rtl" : getComputedStyle(activeDocument.body).direction === "rtl");

		const applyOptions = (canvas: CanvasLike | null, sourcePath: string): ApplyOptions => ({
			layout: ctx.settings.layout,
			rtl: rtlOf(canvas),
			spacing: 30,
			levelSpacing: 80,
			newId: () => randomId(),
			resolveFile: (link) => app.metadataCache.getFirstLinkpathDest(link, sourcePath)?.path ?? null,
			textWidth: Math.max(320, canvas?.config.defaultTextNodeDimensions.width ?? 0),
			fileSize: canvas?.config.defaultFileNodeDimensions ?? { width: 400, height: 400 },
		});

		const openCanvasFor = (file: TFile): CanvasLike | null => {
			for (const leaf of app.workspace.getLeavesOfType("canvas")) {
				const view = leaf.view as CanvasViewLike;
				if (view.file === file && view.canvas) return view.canvas;
			}
			return null;
		};

		const readCanvas = async (file: TFile): Promise<CanvasFileData> => {
			const live = openCanvasFor(file);
			if (live) return live.getData();
			const text = await app.vault.read(file);
			return text.trim() ? (JSON.parse(text) as CanvasFileData) : {};
		};

		/** The note's current text, from an open editor when there is one (it may not be saved yet). */
		const readNote = async (file: TFile): Promise<string> => {
			for (const leaf of app.workspace.getLeavesOfType("markdown")) {
				const view = leaf.view;
				if (view instanceof MarkdownView && view.file === file) return view.editor.getValue();
			}
			return app.vault.read(file);
		};

		const fail = (error: unknown) => {
			console.error("[overpowered-canvas] canvas-markdown:", error);
			new Notice(t("canvasMarkdown.failed"));
		};

		// ---- Phase 1: copy as outline ----------------------------------------------------

		const outlineOf = (canvas: CanvasLike): { md: string; count: number } => {
			const data = canvas.getData();
			const selected = selectedNodes(canvas);
			let scope: Set<string> | undefined;
			if (selected.length === 1) {
				const edges = (data.edges ?? []).map((e) => ({ from: e.fromNode, to: e.toNode }));
				scope = new Set([selected[0]!.id, ...descendants(edges, selected[0]!.id)]);
			} else if (selected.length > 1) scope = new Set(selected.map((n) => n.id));
			const s = buildStructure(data, { rtl: rtlOf(canvas), freeLabel: t("canvasMarkdown.freeNodes"), scope });
			return { md: s.items.length ? writeOutline(s.items, { indent: indent(), ids: false }) : "", count: countItems(s.items, "node") };
		};

		const copyOutline = (canvas: CanvasLike) => {
			const { md, count } = outlineOf(canvas);
			if (!count) {
				new Notice(t("canvasMarkdown.nothingToCopy"));
				return;
			}
			navigator.clipboard.writeText(md).then(
				() => new Notice(t("canvasMarkdown.copied", { count })),
				fail,
			);
		};

		// ---- Phase 2: outline → mind map --------------------------------------------------

		/** Adds the outline's maps to the canvas; `at` is the top-left corner (default: view center). */
		const insertOutline = async (canvas: CanvasLike, md: string, sourcePath: string, at?: Point & { end?: boolean }) => {
			if (canvas.readonly) return;
			const { items } = splitNote(md);
			if (!countItems(items, "node")) {
				new Notice(t("canvasMarkdown.noItems"));
				return;
			}
			let result: ApplyResult;
			try {
				result = await applyNote(items, null, null, getElk(), applyOptions(canvas, sourcePath));
			} catch (error) {
				fail(error);
				return;
			}
			const nodes = result.data.nodes ?? [];
			const minX = Math.min(...nodes.map((n) => n.x));
			const minY = Math.min(...nodes.map((n) => n.y));
			const maxX = Math.max(...nodes.map((n) => n.x + n.width));
			const maxY = Math.max(...nodes.map((n) => n.y + n.height));
			const view = canvas.getViewportBBox();
			// `end`: `at.x` is where the block ends (placing to the left of something).
			const target = at ? { x: at.end ? at.x - (maxX - minX) : at.x, y: at.y } : { x: (view.minX + view.maxX) / 2 - (maxX - minX) / 2, y: (view.minY + view.maxY) / 2 - (maxY - minY) / 2 };
			const dx = Math.round(target.x - minX);
			const dy = Math.round(target.y - minY);
			const moved = nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }));
			let added: Set<CanvasNodeLike> | undefined;
			const ok = mutate(ctx, canvas, () => {
				added = canvas.importData({ nodes: moved, edges: result.data.edges ?? [] }, false);
				const layouts = rootMapLayouts(result.data);
				if (Object.keys(layouts).length) ctx.data.root(canvas).set({ mapLayouts: { ...(ctx.data.root(canvas).get().mapLayouts ?? {}), ...layouts } });
			});
			if (!ok) return;
			if (added?.size) {
				canvas.selectAll(added);
				canvas.zoomToSelection();
			}
			new Notice(t("canvasMarkdown.inserted", { count: nodes.length }));
		};

		const pasteOutline = (canvas: CanvasLike) =>
			navigator.clipboard.readText().then((text) => {
				if (!isOutline(text, 1)) new Notice(t("canvasMarkdown.notOutline"));
				else void insertOutline(canvas, text, canvas.view.file?.path ?? "");
			}, fail);

		const insertNote = (canvas: CanvasLike, file: TFile, at?: Point & { end?: boolean }) =>
			void readNote(file).then((md) => insertOutline(canvas, md, file.path, at), fail);

		// Pasting an outline onto the board (not into a card) builds a mind map.
		ctx.onCanvas((canvas) => {
			const win = canvas.wrapperEl.win;
			const onPaste = (e: ClipboardEvent) => {
				if (!ctx.settings.pasteOutlines || e.defaultPrevented || canvas.readonly) return;
				if (canvas.wrapperEl.doc.activeElement !== canvas.wrapperEl) return;
				const clip = e.clipboardData;
				if (!clip || clip.files.length > 0 || clip.getData("obsidian/canvas")) return;
				const text = clip.getData("text/plain");
				if (!isOutline(text, 2)) return;
				// The core skips pastes that are already handled.
				e.preventDefault();
				void insertOutline(canvas, text, canvas.view.file?.path ?? "");
			};
			win.addEventListener("paste", onPaste, true);
			return () => win.removeEventListener("paste", onPaste, true);
		});

		// ---- Phase 3: whole canvas ⇄ note ------------------------------------------------

		/** Writes the canvas as a note; resolves to the note file (or null when cancelled). */
		const exportCanvas = async (file: TFile): Promise<TFile | null> => {
			const data = await readCanvas(file);
			// The note already linked to this canvas, else the one beside it (asking before replacing it).
			const linked = await noteOf(file);
			let path = linked?.path ?? siblingPath(file, "md");
			const found = app.vault.getAbstractFileByPath(path);
			let existing: TFile | null = found instanceof TFile ? found : null;
			let previous = existing ? await readNote(existing) : null;
			if (existing && !linked) {
				const name = existing.basename;
				const choice = await new Promise<"replace" | "separate" | null>((resolve) => new ReplaceModal(app, t, name, resolve).open());
				if (!choice) return null;
				if (choice === "separate") {
					path = availablePath(app, siblingPath(file, "md", ` (${t("canvasMarkdown.outlineSuffix")})`));
					existing = null;
					previous = null;
				}
			}
			const md = exportNote(data, {
				canvasPath: file.path,
				rtl: rtlOf(openCanvasFor(file)),
				freeLabel: t("canvasMarkdown.freeNodes"),
				indent: indent(),
				frontmatter: previous !== null ? stripFrontmatter(previous).frontmatter : "",
			});
			let note: TFile;
			if (existing instanceof TFile) {
				await app.vault.modify(existing, md);
				note = existing;
			} else note = await app.vault.create(path, md);
			new Notice(t("canvasMarkdown.exported", { name: note.basename }));
			return note;
		};

		/** Creates or updates the canvas a note describes; resolves to the canvas file. */
		const applyNoteFile = async (note: TFile, leaf: WorkspaceLeaf | null = null): Promise<TFile | null> => {
			const split = splitNote(await readNote(note));
			if (split.dataError) new Notice(t("canvasMarkdown.dataBroken"), 10_000);
			if (!countItems(split.items, "node") && !split.data) {
				new Notice(t("canvasMarkdown.noItems"));
				return null;
			}
			// The canvas the data block names; without a name, the canvas next to the note.
			const named = split.data?.canvas ? normalizePath(split.data.canvas) : null;
			const target = split.data ? app.vault.getAbstractFileByPath(named ?? siblingPath(note, "canvas")) : null;

			if (target instanceof TFile && split.data) {
				// Update through the live canvas (one undo step); it is opened first because its
				// text direction decides which way re-arranged maps grow.
				let live = openCanvasFor(target);
				if (!live) {
					await (leaf ?? app.workspace.getLeaf(false)).openFile(target);
					live = await waitForCanvas(target);
				}
				if (live?.readonly) {
					new Notice(t("canvasMarkdown.readonly"));
					return null;
				}
				const original = live ? null : await app.vault.read(target);
				const base = live ? live.getData() : original!.trim() ? (JSON.parse(original!) as CanvasFileData) : {};
				const result = await applyNote(split.items, split.data, base, getElk(), applyOptions(live, note.path));
				if (live) {
					const layouts = rootMapLayouts(result.data);
					const ok = mutate(ctx, live, () => {
						live.importData({ nodes: result.data.nodes ?? [], edges: result.data.edges ?? [] }, true);
						ctx.data.root(live).set({ mapLayouts: Object.keys(layouts).length ? layouts : undefined });
					});
					if (!ok) return null;
				} else {
					let changed = false;
					await app.vault.process(target, (current) => {
						if (current !== original) {
							changed = true;
							return current;
						}
						return JSON.stringify(result.data, null, "\t");
					});
					if (changed) {
						new Notice(t("canvasMarkdown.changedMeanwhile"));
						return null;
					}
				}
				new Notice(t("canvasMarkdown.updated", { added: result.added, removed: result.removed, updated: result.updated }));
				return target;
			}

			// No canvas yet (or a plain outline note): build a new one.
			// A deleted canvas comes back where it was; a plain outline gets a new canvas beside the note.
			const path = availablePath(app, named ?? siblingPath(note, "canvas"));
			if (path.includes("/")) {
				const folder = path.slice(0, path.lastIndexOf("/"));
				if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
			}
			// Open the empty canvas first: its text direction (per canvas or global) decides
			// which way the maps grow.
			const file = await app.vault.create(path, JSON.stringify({ ...(split.data?.root ?? {}), nodes: [], edges: [] }, null, "\t"));
			await (leaf ?? app.workspace.getLeaf(false)).openFile(file);
			const live = await waitForCanvas(file);
			const result = await applyNote(split.items, split.data, null, getElk(), applyOptions(live, note.path));
			if (live && !live.readonly) {
				const layouts = rootMapLayouts(result.data);
				mutate(ctx, live, () => {
					live.importData({ nodes: result.data.nodes ?? [], edges: result.data.edges ?? [] }, true);
					if (Object.keys(layouts).length) ctx.data.root(live).set({ mapLayouts: layouts });
				});
				live.zoomToFit();
			} else await app.vault.modify(file, JSON.stringify(result.data, null, "\t"));
			new Notice(t("canvasMarkdown.created", { name: file.basename, count: result.data.nodes?.length ?? 0 }));
			return file;
		};

		/** The canvas of a file once its view has loaded (null after 3 s). */
		const waitForCanvas = async (file: TFile): Promise<CanvasLike | null> => {
			for (let i = 0; i < 60; i++) {
				const canvas = openCanvasFor(file);
				if (canvas) {
					// Let modules (direction, layers…) set the canvas up.
					await new Promise((r) => window.setTimeout(r, 100));
					return canvas;
				}
				await new Promise((r) => window.setTimeout(r, 50));
			}
			return null;
		};

		const run = <T>(job: Promise<T>) => job.catch(fail);
		const openIn = (leaf: WorkspaceLeaf | null, file: TFile | null | void) => {
			if (file) void (leaf ?? app.workspace.getLeaf(false)).openFile(file);
		};

		/** The note mirroring a canvas: the sibling note if it is linked to this canvas. */
		const noteOf = async (canvasFile: TFile): Promise<TFile | null> => {
			const note = app.vault.getAbstractFileByPath(siblingPath(canvasFile, "md"));
			if (note instanceof TFile && splitNote(await readNote(note)).data?.canvas === canvasFile.path) return note;
			const other = app.vault.getMarkdownFiles().find((f) => f.basename.startsWith(`${canvasFile.basename} (`) && f.parent === canvasFile.parent);
			if (other && splitNote(await readNote(other)).data?.canvas === canvasFile.path) return other;
			return null;
		};

		const activeNote = (): TFile | null => {
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			return view?.file ?? null;
		};

		// ---- Commands and menus ----------------------------------------------------------

		const canvasCommand = (id: string, name: I18nKey, icon: string, fn: (c: CanvasLike) => void, write = false) =>
			ctx.addCommand({
				id,
				name: t(name),
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || (write && canvas.readonly)) return false;
					if (!checking) fn(canvas);
					return true;
				},
			});
		canvasCommand("copy-outline", "canvasMarkdown.cmd.copy", "list-tree", copyOutline);
		canvasCommand("paste-outline", "canvasMarkdown.cmd.paste", "clipboard-paste", (c) => void pasteOutline(c), true);
		canvasCommand("insert-note", "canvasMarkdown.cmd.insertNote", "file-input", (c) => new NotePicker(app, t, (f) => insertNote(c, f)).open(), true);
		canvasCommand("export-note", "canvasMarkdown.cmd.export", "file-output", (c) => {
			if (c.view.file) void run(exportCanvas(c.view.file));
		});
		canvasCommand(
			"update-from-note",
			"canvasMarkdown.cmd.updateCanvas",
			"refresh-cw",
			(c) => {
				const file = c.view.file;
				if (!file) return;
				void run(
					noteOf(file).then((note) => {
						if (!note) new Notice(t("canvasMarkdown.noteMissing"));
						else return applyNoteFile(note);
					}),
				);
			},
			true,
		);
		ctx.addCommand({
			id: "note-to-canvas",
			name: t("canvasMarkdown.cmd.fromNote"),
			icon: "git-fork",
			checkCallback: (checking) => {
				const note = activeNote();
				if (!note) return false;
				if (!checking) void run(applyNoteFile(note));
				return true;
			},
		});
		ctx.addCommand({
			id: "toggle-view",
			name: t("canvasMarkdown.cmd.toggle"),
			icon: "arrow-left-right",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const note = canvas ? null : activeNote();
				if (!canvas?.view.file && !note) return false;
				if (checking) return true;
				const leaf = app.workspace.getMostRecentLeaf();
				if (canvas?.view.file) void run(exportCanvas(canvas.view.file).then((f) => openIn(leaf, f)));
				else if (note) void run(applyNoteFile(note, leaf).then((f) => openIn(leaf, f)));
				return true;
			},
		});

		const copyItem = (canvas: CanvasLike) => (item: MenuItem) => item.setSection("action").setTitle(t("canvasMarkdown.cmd.copy")).setIcon("list-tree").onClick(() => copyOutline(canvas));
		ctx.onSelectionMenu((menu, canvas) => menu.addItem(copyItem(canvas)));
		ctx.onNodeMenu((menu, node) => {
			const canvas = node.canvas;
			if (nodeType(node) !== "group") menu.addItem(copyItem(canvas));
			const file = node.file;
			if (nodeType(node) === "file" && file instanceof TFile && file.extension === "md" && !canvas.readonly)
				menu.addItem((item) =>
					item
						.setSection("action")
						.setTitle(t("canvasMarkdown.menu.convertHere"))
						.setIcon("git-fork")
						.onClick(() => insertNote(canvas, file, rtlOf(canvas) ? { x: node.x - 120, y: node.y, end: true } : { x: node.x + node.width + 120, y: node.y })),
				);
		});
		ctx.registerEvent(
			app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile)) return;
				if (file.extension === "md")
					menu.addItem((item) => item.setTitle(t("canvasMarkdown.cmd.fromNote")).setIcon("git-fork").onClick(() => void run(applyNoteFile(file).then((f) => openIn(null, f)))));
				else if (file.extension === "canvas")
					menu.addItem((item) => item.setTitle(t("canvasMarkdown.cmd.export")).setIcon("file-output").onClick(() => void run(exportCanvas(file).then((f) => openIn(null, f)))));
			}),
		);
	},

	renderSettings(el, ctx: ModuleContext<CanvasMarkdownSettings>) {
		new Setting(el)
			.setName(ctx.t("canvasMarkdown.indent.name"))
			.setDesc(ctx.t("canvasMarkdown.indent.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ tab: ctx.t("canvasMarkdown.indent.tab"), "4": ctx.t("canvasMarkdown.indent.4"), "2": ctx.t("canvasMarkdown.indent.2") })
					.setValue(ctx.settings.indent)
					.onChange((v) => ctx.updateSettings({ indent: v as CanvasMarkdownSettings["indent"] })),
			);
		new Setting(el)
			.setName(ctx.t("canvasMarkdown.layout.name"))
			.setDesc(ctx.t("canvasMarkdown.layout.desc"))
			.addDropdown((d) => {
				for (const l of NEW_MAP_LAYOUTS) d.addOption(l, ctx.t(`autoLayout.direction.${l}` as I18nKey));
				d.setValue(ctx.settings.layout).onChange((v) => ctx.updateSettings({ layout: v as MapLayout }));
			});
		new Setting(el)
			.setName(ctx.t("canvasMarkdown.paste.name"))
			.setDesc(ctx.t("canvasMarkdown.paste.desc"))
			.addToggle((tg) => tg.setValue(ctx.settings.pasteOutlines).onChange((v) => ctx.updateSettings({ pasteOutlines: v })));
	},
});
