/**
 * Runs a tutorial: writes its demo board to a temporary canvas, opens it in a new tab and shows a
 * coach panel on it. Each step has a task that is checked against the live canvas, and a
 * "Show me" button that does the task on the board. Closing the tutorial (or its tab) deletes
 * the temporary canvas and puts back the settings the tutorial may have changed.
 */
import { normalizePath, Notice, setIcon, setTooltip, TFile, TFolder, type App, type EventRef, type WorkspaceLeaf } from "obsidian";
import type { CanvasHooks } from "../core/canvas-hooks";
import type { HistoryApi } from "../core/history";
import type { ModuleManager } from "../core/module-manager";
import type { CanvasDataApi } from "../data/access";
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData } from "../data/json-canvas";
import { SCHEMA_KEY, SCHEMA_VERSION, type OpcNode, type OpcRoot } from "../data/schema";
import { EVENT_PREFIX } from "../core/events";
import type { Translate } from "../i18n";
import type { CanvasLike, CanvasNodeLike, CanvasViewLike } from "../internals/types";
import { extraOf } from "./board";
import { renderRich } from "./rich";
import type { TutorialDefinition, TutorialRuntime, TutorialStep } from "./types";

/** The tutorials' folder inside the plugin's files folder (a plugin setting). */
export const TUTORIALS_FOLDER_NAME = "Tutorials";
/** Where earlier versions kept the practice boards; leftovers there are cleaned up too. */
const LEGACY_FOLDER = "Overpowered Canvas tutorials";

export function tutorialsFolder(filesFolder: string): string {
	return normalizePath(`${filesFolder}/${TUTORIALS_FOLDER_NAME}`);
}
/** Root key that marks a temporary tutorial canvas (so leftovers can be cleaned up safely). */
export const TUTORIAL_KEY = "x-opc-tutorial";

/** A tutorial's own folder for its practice files (inside the tutorials folder, which is ours). */
function practiceFolder(root: string, def: TutorialDefinition): string {
	return normalizePath(`${root}/${def.id}`);
}

/** Public events steps can wait for. */
const WATCHED_EVENTS = [
	"presentation-started",
	"presentation-slide-changed",
	"presentation-ended",
	"map-walk-started",
	"map-walk-moved",
	"map-walk-ended",
	"drawing-mode-changed",
	"stroke-added",
	"strokes-erased",
	"minimap-toggled",
	"frame-focused",
	"focus-mode-changed",
	"group-collapsed",
	"group-expanded",
	"branch-collapsed",
	"branch-expanded",
	"layout-applied",
	"board-template-applied",
	"shape-created",
	"sticky-created",
	"item-lock-changed",
	"outline-copied",
	"outline-inserted",
	"note-block-dropped",
	"card-relinked",
	"kanban-moved",
	"query-group-refreshed",
	"selection-encapsulated",
	"portal-opened",
	"text-highlighted",
	"lasso-selected",
	"selection-cut",
	"note-exported",
	"canvas-updated-from-note",
] as const;

/** Seconds a finished step waits before moving on by itself. */
const ADVANCE_MS = 1600;

export interface TutorialHost {
	readonly app: App;
	readonly pluginId: string;
	readonly modules: ModuleManager;
	readonly data: CanvasDataApi;
	readonly history: HistoryApi;
	readonly hooks: CanvasHooks;
	t(): Translate;
	/** The plugin's files folder; the tutorials folder is inside it. */
	filesFolder(): string;
	markDone(id: string): void;
	/** Shows the list of tutorials. */
	openList(): void;
	readonly catalog: readonly TutorialDefinition[];
}

interface RecordedEvent {
	name: string;
	args: unknown[];
	at: number;
}

export class TutorialRunner {
	private session: Session | null = null;

	constructor(private readonly host: TutorialHost) {}

	private get root(): string {
		return tutorialsFolder(this.host.filesFolder());
	}

	get running(): TutorialDefinition | null {
		return this.session?.def ?? null;
	}

	/** Modules the tutorial needs that are off right now (and can be turned on). */
	missingModules(def: TutorialDefinition): string[] {
		return def.modules.filter((id) => this.host.modules.status(id) === "disabled");
	}

	async start(def: TutorialDefinition): Promise<void> {
		const { app } = this.host;
		const t = this.host.t();
		await this.stop();
		for (const id of this.missingModules(def)) await this.host.modules.setEnabled(id, true);
		const unavailable = def.modules.filter((id) => this.host.modules.status(id) !== "enabled");
		if (unavailable.length > 0) {
			new Notice(t("tutorial.unavailable"));
			return;
		}

		let file: TFile;
		const folder = practiceFolder(this.root, def);
		try {
			await this.writeFiles(def, folder);
			file = await this.writeBoard(def, folder);
		} catch (error) {
			console.error("[overpowered-canvas] could not create the tutorial canvas", error);
			new Notice(t("tutorial.createFailed"));
			return;
		}
		const leaf = app.workspace.getLeaf("tab");
		await leaf.openFile(file, { active: true });
		const canvas = await waitForCanvas(leaf);
		if (!canvas) {
			new Notice(t("tutorial.createFailed"));
			leaf.detach();
			await this.removeFile(file);
			await this.removeFolder(folder);
			return;
		}
		this.session = new Session(this.host, def, file, folder, leaf, canvas, (finished, next) => void this.stop(finished).then(() => next && this.start(next)));
		this.session.begin();
	}

	/** Ends the running tutorial and deletes its canvas. */
	async stop(finished = false): Promise<void> {
		const session = this.session;
		if (!session) return;
		this.session = null;
		session.dispose();
		if (finished) this.host.markDone(session.def.id);
		// Close the tab first, so its last save can't bring the file back.
		if (session.leaf.view && (session.leaf.view as CanvasViewLike).file === session.file) session.leaf.detach();
		await this.removeNotesOf((path) => path === session.file.path);
		await sleep(150);
		// Files made during the tutorial in the tutorials folder (a canvas split off the board…).
		for (const path of session.created) await this.removePath(path);
		await this.removeFolder(session.folder);
		await this.removeFile(session.file);
	}

	/** Closes the tabs showing a file (or anything inside a folder) at `path`. */
	private closeTabs(path: string): void {
		this.host.app.workspace.iterateAllLeaves((leaf) => {
			const shown = (leaf.view as { file?: TFile | null }).file?.path;
			if (shown && (shown === path || shown.startsWith(`${path}/`))) leaf.detach();
		});
	}

	private async removePath(path: string): Promise<void> {
		const item = this.host.app.vault.getAbstractFileByPath(path);
		if (!item) return;
		this.closeTabs(path);
		try {
			await this.host.app.fileManager.trashFile(item);
		} catch (error) {
			console.error("[overpowered-canvas] could not delete a tutorial file", error);
		}
	}

	private async removeFolder(path: string): Promise<void> {
		if (this.host.app.vault.getAbstractFileByPath(path) instanceof TFolder) await this.removePath(path);
	}

	private async writeFiles(def: TutorialDefinition, folder: string): Promise<void> {
		const files = def.files?.(this.host.t()) ?? [];
		// Left over from a crash: start from fresh copies.
		await this.removeFolder(folder);
		if (files.length === 0) return;
		const { vault } = this.host.app;
		if (!vault.getAbstractFileByPath(this.root)) await vault.createFolder(this.root);
		await vault.createFolder(folder);
		for (const f of files) await vault.create(normalizePath(`${folder}/${f.path}`), f.content);
	}

	/**
	 * Deletes notes in the tutorials folder that mirror a practice board (written by the
	 * Markdown tutorial), closing their tabs first.
	 */
	private async removeNotesOf(isBoard: (canvasPath: string) => boolean, root = this.root): Promise<void> {
		const { app } = this.host;
		const folder = app.vault.getAbstractFileByPath(root);
		if (!(folder instanceof TFolder)) return;
		for (const child of [...folder.children]) {
			if (!(child instanceof TFile) || child.extension !== "md") continue;
			try {
				// A note with its data inside names its board; a clean note is the board's namesake.
				const named = /\n## canvas-data[ \t]*\n```json[ \t]*\n[\s\S]*?"canvas":\s*("(?:[^"\\]|\\.)*")/.exec(await app.vault.read(child))?.[1];
				const linked = named ? (JSON.parse(named) as string) : child.path.replace(/\.md$/, ".canvas");
				if (!isBoard(linked)) continue;
				for (const leaf of app.workspace.getLeavesOfType("markdown")) if ((leaf.view as { file?: TFile | null }).file === child) leaf.detach();
				await app.fileManager.trashFile(child);
			} catch (error) {
				console.error("[overpowered-canvas] could not delete a tutorial note", error);
			}
		}
	}

	/** Deletes tutorial canvases left over from a crash or a restart. */
	async cleanUp(): Promise<void> {
		await this.cleanUpIn(this.root);
		await this.cleanUpIn(LEGACY_FOLDER);
	}

	private async cleanUpIn(root: string): Promise<void> {
		const { app } = this.host;
		const folder = app.vault.getAbstractFileByPath(root);
		if (!(folder instanceof TFolder)) return;
		for (const child of [...folder.children]) {
			if (!(child instanceof TFile) || child.extension !== "canvas" || child === this.session?.file) continue;
			try {
				const raw = JSON.parse(await app.vault.read(child)) as Record<string, unknown>;
				if (!raw[TUTORIAL_KEY]) continue;
				for (const leaf of app.workspace.getLeavesOfType("canvas")) if ((leaf.view as CanvasViewLike).file === child) leaf.detach();
				await app.fileManager.trashFile(child);
			} catch {
				// Not ours, or unreadable: leave it.
			}
		}
		// Practice files of tutorials that are not running.
		for (const def of this.host.catalog) if (def !== this.session?.def) await this.removeFolder(practiceFolder(root, def));
		// Notes of practice boards that are gone.
		await this.removeNotesOf((path) => path.startsWith(`${root}/`) && path !== this.session?.file.path && !app.vault.getAbstractFileByPath(path), root);
		await this.removeFolderIfEmpty(root);
	}

	private async writeBoard(def: TutorialDefinition, folder: string): Promise<TFile> {
		const { app } = this.host;
		const t = this.host.t();
		const board = def.board(t, folder);
		const folderPath = this.root;
		if (!app.vault.getAbstractFileByPath(folderPath)) await app.vault.createFolder(folderPath);
		const base = t(def.title).replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || def.id;
		let path = normalizePath(`${folderPath}/${base}.canvas`);
		for (let n = 2; app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folderPath}/${base} ${n}.canvas`);
		const data: CanvasFileData = {
			nodes: board.nodes,
			edges: board.edges,
			// Every tutorial language reads left to right; the board follows it, not the global direction.
			[SCHEMA_KEY]: { v: SCHEMA_VERSION, dir: "ltr", ...(board.root ?? {}) },
			[TUTORIAL_KEY]: def.id,
		};
		return app.vault.create(path, JSON.stringify(data, null, "\t"));
	}

	private async removeFile(file: TFile): Promise<void> {
		try {
			const current = this.host.app.vault.getAbstractFileByPath(file.path);
			if (current instanceof TFile) await this.host.app.fileManager.trashFile(current);
		} catch (error) {
			console.error("[overpowered-canvas] could not delete the tutorial canvas", error);
		}
		await this.removeFolderIfEmpty();
	}

	/** Removes the tutorials folder when it is empty, and then the plugin's files folder if that is empty too. */
	private async removeFolderIfEmpty(root = this.root): Promise<void> {
		const files = this.host.filesFolder();
		for (const path of root === this.root ? [root, files] : [root]) {
			const folder = this.host.app.vault.getAbstractFileByPath(path);
			if (!(folder instanceof TFolder) || folder.children.length > 0) return;
			try {
				await this.host.app.fileManager.trashFile(folder);
			} catch {
				// Someone put something there; keep it.
				return;
			}
		}
	}
}

/** The running tutorial: its tab, coach panel and step state. */
class Session {
	private index = 0;
	private readonly completed = new Set<number>();
	private before: CanvasFileData;
	private stepStart = 0;
	private events: RecordedEvent[] = [];
	private readonly cleanups: (() => void)[] = [];
	private panel!: HTMLElement;
	private highlight: HTMLElement | null = null;
	private advanceTimer = 0;
	private evalFrame = 0;
	private demoRunning = false;
	/** Ended: a demo still running must not redraw the panel or the highlight. */
	private disposed = false;
	/** The current step was completed by "Show me": nobody is typing, move on. */
	private demoCompleted = false;
	private minimized = false;
	private finishedView = false;
	private readonly saved = new Map<string, unknown>();
	private readonly rt: TutorialRuntime;
	/** Files created in the tutorials folder while the tutorial runs. */
	readonly created: string[] = [];

	constructor(
		private readonly host: TutorialHost,
		readonly def: TutorialDefinition,
		readonly file: TFile,
		readonly folder: string,
		readonly leaf: WorkspaceLeaf,
		private readonly canvas: CanvasLike,
		private readonly end: (finished: boolean, next?: TutorialDefinition) => void,
	) {
		this.before = canvas.getData();
		this.rt = this.runtime();
	}

	begin(): void {
		const { app } = this.host;
		for (const { module, key } of this.def.restoreSettings ?? []) this.saved.set(`${module}\0${key}`, this.rt.setting(module, key));

		const refs: EventRef[] = WATCHED_EVENTS.map((name) =>
			app.workspace.on(`${EVENT_PREFIX}${name}` as "quit", (...args: unknown[]) => this.record(name, args)),
		);
		this.cleanups.push(() => refs.forEach((r) => app.workspace.offref(r)));
		this.cleanups.push(this.host.hooks.on("history-apply", (canvas, direction) => canvas === this.canvas && this.record(direction, [])));
		for (const hook of ["node-added", "node-removed", "node-extra-change", "edge-added", "edge-removed", "edge-extra-change", "root-extra-change", "selection-change", "node-moved"] as const)
			this.cleanups.push(this.host.hooks.on(hook, () => this.schedule()));
		const layoutRef = app.workspace.on("layout-change", () => {
			// The tab was closed, or another file was opened in it.
			if ((this.leaf.view as CanvasViewLike | undefined)?.file !== this.file) this.end(false);
		});
		this.cleanups.push(() => app.workspace.offref(layoutRef));
		const createRef = app.vault.on("create", (file) => {
			if (file !== this.file && file.path.startsWith(`${tutorialsFolder(this.host.filesFolder())}/`) && !file.path.startsWith(`${this.folder}/`)) this.created.push(file.path);
		});
		this.cleanups.push(() => app.vault.offref(createRef));
		const tick = window.setInterval(() => {
			this.evaluate();
			this.placeHighlight();
			this.avoidOverlaps();
		}, 400);
		this.cleanups.push(() => window.clearInterval(tick));

		// The panel reads in the direction of its language, whatever the canvas direction is.
		this.panel = this.canvas.wrapperEl.createDiv({ cls: "opc-tutorial", attr: { role: "dialog", "aria-live": "polite", dir: "auto" } });
		// The canvas must not pan, zoom or deselect when the panel is used.
		for (const type of ["pointerdown", "mousedown", "wheel", "dblclick", "contextmenu", "keydown"] as const) this.panel.addEventListener(type, (e) => e.stopPropagation());
		// Opposite the canvas side controls, which sit at the end of the canvas' reading direction.
		this.panel.toggleClass("is-right", getComputedStyle(this.canvas.wrapperEl).direction === "rtl");
		this.cleanups.push(() => this.panel.remove());
		this.enterStep(0);
	}

	dispose(): void {
		this.disposed = true;
		window.clearTimeout(this.advanceTimer);
		window.clearTimeout(this.evalFrame);
		this.clearHighlight();
		for (const c of this.cleanups.splice(0)) c();
		for (const [k, value] of this.saved) {
			const [module, key] = k.split("\0") as [string, string];
			if (this.rt.setting(module, key) !== value) void this.host.modules.contextOf(module)?.updateSettings({ [key]: value });
		}
	}

	private get step(): TutorialStep {
		return this.def.steps[this.index]!;
	}

	private record(name: string, args: unknown[]): void {
		this.events.push({ name, args, at: performance.now() });
		this.schedule();
	}

	private schedule(): void {
		if (this.evalFrame) return;
		// A timer, not an animation frame: frames never come while the window is in the background.
		this.evalFrame = window.setTimeout(() => {
			this.evalFrame = 0;
			this.evaluate();
		}, 30);
	}

	private enterStep(index: number): void {
		window.clearTimeout(this.advanceTimer);
		this.finishedView = false;
		this.index = Math.max(0, Math.min(this.def.steps.length - 1, index));
		this.before = this.canvas.getData();
		this.stepStart = performance.now();
		this.events = [];
		try {
			this.step.enter?.(this.rt);
		} catch (error) {
			console.error("[overpowered-canvas] tutorial step setup failed", error);
		}
		if (this.step.focus) this.rt.look(this.step.focus);
		else if (index === 0 || !this.boardInView()) this.rt.look();
		this.render();
	}

	/** A card is being edited, or a text field outside the panel has the focus (e.g. the search bar). */
	private typing(): boolean {
		if ([...this.canvas.nodes.values()].some((n) => n.isEditing)) return true;
		const el = activeDocument.activeElement;
		// A note open beside the board (the Markdown tutorial) is a task of its own, not typing on the board.
		return !!el?.closest("input, textarea, [contenteditable=true]") && !el.closest(".opc-tutorial") && !el.closest(".workspace-leaf-content[data-type='markdown']");
	}

	/** The whole board is on screen (e.g. not pushed aside by a sidebar that just opened). */
	private boardInView(): boolean {
		const v = this.canvas.getViewportBBox();
		for (const node of this.canvas.nodes.values()) {
			const b = node.getBBox();
			if (b.minX < v.minX || b.minY < v.minY || b.maxX > v.maxX || b.maxY > v.maxY) return false;
		}
		return true;
	}

	private evaluate(): void {
		if (this.disposed || this.finishedView || this.completed.has(this.index) || !this.step.check) return;
		let ok = false;
		try {
			ok = this.step.check(this.rt);
		} catch {
			ok = false;
		}
		if (!ok) return;
		this.completed.add(this.index);
		this.demoCompleted = this.demoRunning;
		this.render(true);
		const at = this.index;
		const advance = () => {
			if (this.index !== at || this.finishedView) return;
			// Still typing in a card (e.g. the one just created): move on once that's done.
			if (!this.demoCompleted && this.typing()) this.advanceTimer = window.setTimeout(advance, 500);
			else this.next();
		};
		this.advanceTimer = window.setTimeout(advance, ADVANCE_MS);
	}

	private next(): void {
		if (this.index < this.def.steps.length - 1) this.enterStep(this.index + 1);
		else this.showFinished();
	}

	private showFinished(): void {
		window.clearTimeout(this.advanceTimer);
		this.finishedView = true;
		this.host.markDone(this.def.id);
		this.render();
	}

	private async demo(): Promise<void> {
		const demo = this.step.demo;
		if (!demo || this.demoRunning) return;
		this.demoRunning = true;
		this.render();
		try {
			this.focusCanvasLeaf();
			await demo(this.rt);
		} catch (error) {
			console.error("[overpowered-canvas] tutorial demo failed", error);
		} finally {
			// A demo's last change may only show up on the next check.
			this.evaluate();
			this.demoRunning = false;
			// Once done, the celebration has been drawn already; don't cut it short.
			if (!this.completed.has(this.index)) this.render();
		}
	}

	private focusCanvasLeaf(): void {
		this.host.app.workspace.setActiveLeaf(this.leaf, { focus: true });
	}

	// ---------- panel ----------

	private render(celebrate = false): void {
		if (this.disposed) return;
		const t = this.host.t();
		const panel = this.panel;
		panel.empty();
		panel.toggleClass("is-minimized", this.minimized);

		const head = panel.createDiv({ cls: "opc-tutorial-head" });
		setIcon(head.createSpan({ cls: "opc-tutorial-icon" }), this.def.icon);
		head.createSpan({ cls: "opc-tutorial-name", text: t(this.def.title) });
		const min = head.createDiv({ cls: "clickable-icon", attr: { "aria-label": t(this.minimized ? "tutorial.expand" : "tutorial.minimize") } });
		setIcon(min, this.minimized ? "chevron-up" : "chevron-down");
		setTooltip(min, t(this.minimized ? "tutorial.expand" : "tutorial.minimize"));
		min.addEventListener("click", () => {
			this.minimized = !this.minimized;
			this.render();
		});
		const close = head.createDiv({ cls: "clickable-icon", attr: { "aria-label": t("tutorial.close") } });
		setIcon(close, "x");
		setTooltip(close, t("tutorial.close"));
		close.addEventListener("click", () => this.end(this.finishedView));

		const steps = this.def.steps;
		if (this.finishedView) {
			this.clearHighlight();
			if (this.minimized) return;
			this.renderFinished(panel, t);
			return;
		}

		const dots = panel.createDiv({ cls: "opc-tutorial-dots" });
		dots.createSpan({ cls: "opc-tutorial-count", text: t("tutorial.count", { n: this.index + 1, total: steps.length }) });
		steps.forEach((_, i) => {
			const dot = dots.createEl("button", { cls: "opc-tutorial-dot", attr: { "aria-label": t("tutorial.goTo", { n: i + 1 }) } });
			dot.toggleClass("is-current", i === this.index);
			dot.toggleClass("is-done", this.completed.has(i));
			dot.addEventListener("click", () => this.enterStep(i));
		});
		if (this.minimized) {
			this.placeHighlight();
			return;
		}

		const step = this.step;
		panel.createDiv({ cls: "opc-tutorial-title", text: t(step.title) });
		renderRich(panel.createDiv({ cls: "opc-tutorial-body" }), t(step.body));

		const done = this.completed.has(this.index);
		if (step.task) {
			const task = panel.createDiv({ cls: "opc-tutorial-task" });
			task.toggleClass("is-done", done);
			task.toggleClass("is-celebrating", celebrate);
			const mark = task.createDiv({ cls: "opc-tutorial-check" });
			setIcon(mark, done ? "check" : "circle-dashed");
			const text = task.createDiv({ cls: "opc-tutorial-task-text" });
			text.createDiv({ cls: "opc-tutorial-task-label", text: t(done ? "tutorial.taskDone" : "tutorial.task") });
			renderRich(text.createDiv(), t(step.task));
			if (celebrate) burst(task);
			if (step.demo && !done) {
				const show = task.createEl("button", { cls: "opc-tutorial-demo" });
				setIcon(show.createSpan(), this.demoRunning ? "loader" : "play");
				show.createSpan({ text: t(this.demoRunning ? "tutorial.demoRunning" : "tutorial.demo") });
				show.disabled = this.demoRunning;
				show.addEventListener("click", () => void this.demo());
			}
		}

		const nav = panel.createDiv({ cls: "opc-tutorial-nav" });
		const back = nav.createEl("button", { cls: "opc-tutorial-back" });
		setIcon(back.createSpan({ cls: "opc-tutorial-arrow" }), "arrow-left");
		back.createSpan({ text: t("tutorial.back") });
		back.disabled = this.index === 0;
		back.addEventListener("click", () => this.enterStep(this.index - 1));
		const last = this.index === steps.length - 1;
		const next = nav.createEl("button", { cls: "opc-tutorial-next" });
		// A task not done yet can be skipped; the button only becomes the main one once it's done.
		next.toggleClass("mod-cta", !step.task || done);
		next.createSpan({ text: t(last ? "tutorial.finish" : step.task && !done ? "tutorial.skip" : "tutorial.next") });
		setIcon(next.createSpan({ cls: "opc-tutorial-arrow" }), last ? "flag" : "arrow-right");
		next.addEventListener("click", () => this.next());

		this.placeHighlight();
	}

	private renderFinished(panel: HTMLElement, t: Translate): void {
		const box = panel.createDiv({ cls: "opc-tutorial-finished" });
		setIcon(box.createDiv({ cls: "opc-tutorial-trophy" }), "party-popper");
		box.createDiv({ cls: "opc-tutorial-title", text: t("tutorial.finished.title") });
		box.createDiv({ cls: "opc-tutorial-body", text: t("tutorial.finished.body", { n: this.completed.size, total: this.def.steps.filter((s) => s.task).length }) });
		burst(box);
		const nav = panel.createDiv({ cls: "opc-tutorial-nav is-column" });
		const catalog = this.host.catalog;
		const nextDef = catalog[catalog.indexOf(this.def) + 1];
		if (nextDef) {
			const next = nav.createEl("button", { cls: "mod-cta" });
			next.createSpan({ text: t("tutorial.finished.next", { name: t(nextDef.title) }) });
			setIcon(next.createSpan({ cls: "opc-tutorial-arrow" }), "arrow-right");
			next.addEventListener("click", () => this.end(true, nextDef));
		}
		const all = nav.createEl("button", { text: t("tutorial.finished.all") });
		all.addEventListener("click", () => {
			this.end(true);
			this.host.openList();
		});
		const keep = nav.createEl("button", { text: t("tutorial.finished.close") });
		keep.addEventListener("click", () => this.end(true));
	}

	/** Moves the panel below the minimap when it sits in the same corner. */
	private avoidOverlaps(): void {
		// The canvas direction can change while the tutorial runs: stay opposite the controls.
		this.panel.toggleClass("is-right", getComputedStyle(this.canvas.wrapperEl).direction === "rtl");
		const wrapper = this.canvas.wrapperEl.getBoundingClientRect();
		const minimap = this.canvas.wrapperEl.querySelector<HTMLElement>(".opc-minimap");
		let top = 0;
		if (minimap?.isShown()) {
			const m = minimap.getBoundingClientRect();
			const p = this.panel.getBoundingClientRect();
			const sameSide = m.left < p.right && m.right > p.left;
			if (sameSide && m.top - wrapper.top < wrapper.height / 2) top = m.bottom - wrapper.top + 8;
		}
		this.panel.setCssProps({ "--opc-tutorial-top": top > 0 ? `${Math.round(top)}px` : "" });
	}

	private placeHighlight(): void {
		if (this.disposed) return;
		const spec = this.finishedView || this.minimized ? undefined : this.step.target;
		if (!spec) {
			this.clearHighlight();
			return;
		}
		let target: HTMLElement | null | undefined;
		try {
			target = typeof spec === "function" ? spec(this.rt) : (this.canvas.wrapperEl.querySelector<HTMLElement>(spec) ?? activeDocument.querySelector<HTMLElement>(spec));
		} catch {
			target = null;
		}
		if (!target || !target.isShown() || target.closest(".opc-tutorial")) {
			this.clearHighlight();
			return;
		}
		const r = target.getBoundingClientRect();
		const pad = 5;
		if (!this.highlight) this.highlight = activeDocument.body.createDiv({ cls: "opc-tutorial-highlight" });
		this.highlight.setCssStyles({ left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
	}

	private clearHighlight(): void {
		this.highlight?.remove();
		this.highlight = null;
	}

	// ---------- runtime ----------

	private runtime(): TutorialRuntime {
		const { app, data, history, pluginId } = this.host;
		const canvas = this.canvas;
		const host = this.host;
		const before = () => this.before;
		const nodeExtra = (id: string): OpcNode => {
			const node = canvas.nodes.get(id);
			return node ? data.node(node).get() : {};
		};
		return {
			app,
			canvas,
			folder: this.folder,
			get t() {
				return host.t();
			},
			data,
			now: () => canvas.getData(),
			get before() {
				return before();
			},
			seen: (name, test) => this.events.some((e) => e.name === name && e.at >= this.stepStart && (!test || test(...e.args))),
			node: (id) => canvas.nodes.get(id),
			extra: nodeExtra,
			edgeExtra: (id) => {
				const edge = canvas.edges.get(id);
				return edge ? data.edge(edge).get() : extraOf(undefined);
			},
			root: () => data.root(canvas).get() as OpcRoot,
			setting: (module, key) => {
				const def = this.host.modules.get(module);
				return def ? (this.host.modules.settingsOf(def) as Record<string, unknown>)[key] : undefined;
			},
			viewOpen: (type) => app.workspace.getLeavesOfType(type).length > 0,
			selected: () => [...canvas.selection].map((item) => item.id),
			select: (ids) => {
				const items = ids.map((id) => canvas.nodes.get(id) ?? canvas.edges.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
				canvas.deselectAll();
				if (items.length === 1) canvas.selectOnly(items[0]!);
				else if (items.length > 1) canvas.selectAll(new Set(items));
			},
			command: (id) => {
				this.focusCanvasLeaf();
				const full = id.includes(":") && !id.startsWith("app:") && !id.startsWith("canvas:") ? `${pluginId}:${id}` : id;
				return (app as unknown as { commands: { executeCommandById(id: string): boolean } }).commands.executeCommandById(full);
			},
			add: (nodes: CanvasNodeData[], edges: CanvasEdgeData[] = []) => {
				history.transaction(canvas, () => canvas.importData({ nodes, edges }, false));
				canvas.requestSave();
				return nodes.map((n) => canvas.nodes.get(n.id)).filter((n): n is CanvasNodeLike => !!n);
			},
			change: (fn) => {
				history.transaction(canvas, fn);
				canvas.requestSave();
			},
			look: (ids, padding = 120) => {
				const nodes = ids && ids.length > 0 ? ids.map((id) => canvas.nodes.get(id)).filter((n): n is CanvasNodeLike => !!n) : [...canvas.nodes.values()];
				if (nodes.length === 0) return;
				const boxes = nodes.map((n) => n.getBBox());
				const minX = Math.min(...boxes.map((b) => b.minX));
				const minY = Math.min(...boxes.map((b) => b.minY));
				const maxX = Math.max(...boxes.map((b) => b.maxX));
				const maxY = Math.max(...boxes.map((b) => b.maxY));
				// Leave room for the coach panel on the reading-start side.
				const room = (maxX - minX + 2 * padding) * 0.55;
				const right = this.panel.hasClass("is-right");
				canvas.zoomToBbox({ minX: minX - padding - (right ? 0 : room), minY: minY - padding, maxX: maxX + padding + (right ? room : 0), maxY: maxY + padding });
			},
			wait: (ms) => sleep(ms),
		};
	}
}

/** A few bits of confetti from the given element. */
function burst(el: HTMLElement): void {
	const box = el.createDiv({ cls: "opc-tutorial-burst", attr: { "aria-hidden": "true" } });
	for (let i = 0; i < 14; i++) {
		const bit = box.createSpan();
		bit.setCssProps({ "--opc-a": `${(i / 14) * 360}deg`, "--opc-d": `${40 + (i % 3) * 16}px`, "--opc-c": `var(--color-${["red", "orange", "yellow", "green", "cyan", "blue", "purple"][i % 7]})` });
	}
	window.setTimeout(() => box.remove(), 1200);
}

async function waitForCanvas(leaf: WorkspaceLeaf): Promise<CanvasLike | null> {
	for (let i = 0; i < 40; i++) {
		const view = leaf.view as CanvasViewLike | undefined;
		if (view?.getViewType() === "canvas" && view.canvas && view.canvas.nodes.size > 0) return view.canvas;
		await sleep(50);
	}
	return null;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms));
}
