/**
 * Review flowchart: learn flowcharts by filling them in from memory. Charts come from groups
 * named "toreview" and from canvases tagged #toreview; the reviews are scheduled with FSRS and
 * kept in a note in the plugin's files folder (synced like any note).
 */
import { normalizePath, setIcon, setTooltip, Setting, TFile, type TAbstractFile } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasFileData } from "../../data/json-canvas";
import type { CanvasLike, CanvasViewLike } from "../../internals/types";
import { findFlowcharts, type Flowchart } from "./find";
import { ANSWER_MODES, ReviewModal, type AnswerMode, type ReviewHost } from "./review-modal";
import { dropPath, emptyData, entryFor, movePath, NOTE_NAME, parseNote, resetChanged, setEntry, writeNote, type ReviewData } from "./store";

export interface FlowchartReviewSettings {
	/** Groups with this label hold charts to review. */
	groupName: string;
	/** Canvases with this tag are reviewed whole. */
	tag: string;
	/** How many words of the first card name a chart. */
	nameWords: number;
	/** Review with every card as a plain square. */
	squares: boolean;
	/** Type the answers, or drag them from the chart's own texts. */
	answerMode: AnswerMode;
}

type Ctx = ModuleContext<FlowchartReviewSettings>;

/** Opens the window from the command, the side bar and the bottom bar. */
export const REVIEW_COMMAND = "flowchart-review:open";

/** The review data as last read or written (tutorial checks read it). */
let snapshot: ReviewData | null = null;
export const reviewSnapshot = (): ReviewData | null => snapshot;

class ReviewStore {
	private cache: ReviewData | null = null;
	private readonly listeners = new Set<() => void>();
	private readonly parsed = new Map<string, { mtime: number; charts: Flowchart[]; key: string }>();

	constructor(private readonly ctx: Ctx) {}

	path(): string {
		return normalizePath(`${this.ctx.filesFolder()}/${NOTE_NAME}`);
	}

	private file(): TFile | null {
		const f = this.ctx.app.vault.getAbstractFileByPath(this.path());
		return f instanceof TFile ? f : null;
	}

	async read(): Promise<ReviewData> {
		if (this.cache) return this.cache;
		const file = this.file();
		this.cache = snapshot = file ? parseNote(await this.ctx.app.vault.read(file)) : emptyData();
		return this.cache;
	}

	/** Applies `fn` to the data as it is in the note on disk (null: no change). */
	async update(fn: (data: ReviewData) => ReviewData | null): Promise<void> {
		const { vault } = this.ctx.app;
		const intro = this.ctx.t("flowchartReview.noteIntro");
		const file = this.file();
		if (file) {
			await vault.process(file, (text) => {
				const next = fn(parseNote(text));
				if (!next) return text;
				this.cache = snapshot = next;
				return writeNote(text, next, intro);
			});
		} else {
			const next = fn(emptyData());
			if (!next) return;
			const folder = this.ctx.filesFolder();
			if (folder && !vault.getAbstractFileByPath(folder)) await vault.createFolder(folder).catch(() => vault.adapter.mkdir(folder));
			await vault.create(this.path(), writeNote("", next, intro));
			this.cache = snapshot = next;
		}
		this.notify();
	}

	invalidate(): void {
		this.cache = null;
		this.notify();
	}

	forget(path: string): void {
		this.parsed.delete(path);
	}

	onChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	private notify(): void {
		for (const cb of this.listeners) cb();
	}

	/** Every chart to review in the vault; canvases are parsed again only when they changed. */
	async charts(): Promise<Flowchart[]> {
		const { vault } = this.ctx.app;
		const { groupName, tag } = this.ctx.settings;
		const key = `${groupName}\u0000${tag}`;
		const out: Flowchart[] = [];
		// Open canvases as they are now: an edit may not be saved to the file yet.
		const live = new Map<string, CanvasFileData>();
		for (const c of this.ctx.canvases()) if (c.view.file) live.set(c.view.file.path, c.getData());
		for (const file of vault.getFiles()) {
			if (file.extension !== "canvas") continue;
			const now = live.get(file.path);
			if (now) {
				out.push(...findFlowcharts(file.path, now, { groupName, tag }));
				continue;
			}
			let entry = this.parsed.get(file.path);
			if (!entry || entry.mtime !== file.stat.mtime || entry.key !== key) {
				let charts: Flowchart[] = [];
				try {
					charts = findFlowcharts(file.path, JSON.parse((await vault.cachedRead(file)) || "{}") as CanvasFileData, { groupName, tag });
				} catch {
					charts = [];
				}
				entry = { mtime: file.stat.mtime, charts, key };
				this.parsed.set(file.path, entry);
			}
			out.push(...entry.charts);
		}
		return out;
	}
}

function canvasViewOf(ctx: Ctx, path: string): { canvas: CanvasLike; view: CanvasViewLike } | null {
	for (const leaf of ctx.app.workspace.getLeavesOfType("canvas")) {
		const view = leaf.view as unknown as CanvasViewLike;
		if (view.file?.path === path && view.canvas) return { canvas: view.canvas, view };
	}
	return null;
}

export const flowchartReviewModule = defineModule<FlowchartReviewSettings>({
	id: "flowchart-review",
	name: "flowchartReview.name",
	description: "flowchartReview.desc",
	group: "data",
	defaultEnabled: true,
	defaultSettings: { groupName: "toreview", tag: "toreview", nameWords: 4, squares: false, answerMode: "type" },
	sanitizeSettings: (raw, defaults) => {
		const r = (raw ?? {}) as Partial<Record<keyof FlowchartReviewSettings, unknown>>;
		const text = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
		const words = typeof r.nameWords === "number" && Number.isFinite(r.nameWords) ? Math.min(20, Math.max(1, Math.round(r.nameWords))) : defaults.nameWords;
		return { groupName: text(r.groupName, defaults.groupName), tag: text(r.tag, defaults.tag).replace(/^#/, ""), nameWords: words, squares: r.squares === true, answerMode: ANSWER_MODES.includes(r.answerMode as AnswerMode) ? (r.answerMode as AnswerMode) : defaults.answerMode };
	},

	enable(ctx) {
		const store = new ReviewStore(ctx);
		const { app } = ctx;

		const host: ReviewHost = {
			app,
			t: () => ctx.t,
			settings: () => ctx.settings,
			setSquares: (on) => ctx.updateSettings({ squares: on }),
			setAnswerMode: (mode) => ctx.updateSettings({ answerMode: mode }),
			scan: async () => {
				const charts = await store.charts();
				const data = await store.read();
				// A chart that changed starts over, also in the note (so changing it back doesn't bring the old reviews back).
				const reset = resetChanged(data, charts);
				if (reset) await store.update((d) => resetChanged(d, charts));
				const now = await store.read();
				return charts.map((chart) => ({ chart, entry: entryFor(now, chart.key, chart.hash) }));
			},
			rename: (chart, name) =>
				store.update((d) => {
					const entry = entryFor(d, chart.key, chart.hash);
					const next = { ...entry };
					if (name) next.name = name;
					else delete next.name;
					return setEntry(d, chart.key, next);
				}),
			rate: (chart, state) => store.update((d) => setEntry(d, chart.key, { ...entryFor(d, chart.key, chart.hash), state })),
			reveal: async (chart) => {
				const file = app.vault.getAbstractFileByPath(chart.path);
				if (!(file instanceof TFile)) return;
				let open = canvasViewOf(ctx, chart.path);
				if (!open) {
					await app.workspace.getLeaf(false).openFile(file);
					open = canvasViewOf(ctx, chart.path);
				} else app.workspace.setActiveLeaf(open.view.leaf, { focus: true });
				if (!open) return;
				const nodes = chart.nodes.map((n) => open.canvas.nodes.get(n.id)).filter((n) => !!n);
				const minX = Math.min(...chart.nodes.map((n) => n.x));
				const minY = Math.min(...chart.nodes.map((n) => n.y));
				const maxX = Math.max(...chart.nodes.map((n) => n.x + n.width));
				const maxY = Math.max(...chart.nodes.map((n) => n.y + n.height));
				open.canvas.deselectAll();
				open.canvas.updateSelection(() => nodes.forEach((n) => open.canvas.selection.add(n)));
				open.canvas.zoomToBbox({ minX: minX - 80, minY: minY - 80, maxX: maxX + 80, maxY: maxY + 80 });
			},
			onChange: (cb) => store.onChange(cb),
		};

		const open = () => new ReviewModal(host).open();
		ctx.addCommand({ id: "open", name: ctx.t("flowchartReview.title"), icon: "list-checks", callback: open });

		// The note changed (synced from another device, or edited by hand).
		const isNote = (f: TAbstractFile) => f.path === store.path();
		ctx.registerEvent(app.vault.on("modify", (f) => isNote(f) && store.invalidate()));
		ctx.registerEvent(app.vault.on("create", (f) => isNote(f) && store.invalidate()));
		ctx.registerEvent(
			app.vault.on("rename", (f, oldPath) => {
				if (isNote(f) || oldPath === store.path()) return store.invalidate();
				if (!(f instanceof TFile) || f.extension !== "canvas") return;
				store.forget(oldPath);
				void store.read().then((d) => movePath(d, oldPath, f.path) && store.update((x) => movePath(x, oldPath, f.path)));
			}),
		);
		ctx.registerEvent(
			app.vault.on("delete", (f) => {
				if (isNote(f)) return store.invalidate();
				if (!(f instanceof TFile) || f.extension !== "canvas") return;
				store.forget(f.path);
				void store.read().then((d) => dropPath(d, f.path) && store.update((x) => dropPath(x, f.path)));
			}),
		);
		ctx.onSettingsChange((next, prev) => {
			if (next.groupName !== prev.groupName || next.tag !== prev.tag || next.nameWords !== prev.nameWords) store.invalidate();
		});

		// The side bar (shown) and the bottom bar (off until turned on in Customize the bars).
		ctx.onCanvas((canvas) => {
			const group = canvas.canvasControlsEl.createDiv({ cls: "canvas-control-group mod-raised opc-flowchart-review-control" });
			const item = group.createDiv({ cls: "canvas-control-item", attr: { "aria-label": ctx.t("flowchartReview.title") } });
			setIcon(item, "list-checks");
			setTooltip(item, ctx.t("flowchartReview.title"), { placement: "left" });
			item.addEventListener("click", open);
			return () => group.remove();
		});
		ctx.addCardMenuButton({ id: "flowchart-review", icon: "list-checks", tooltip: () => ctx.t("flowchartReview.title"), order: 900, onClick: open });
	},

	renderSettings(el, ctx) {
		const text = (name: "groupName" | "tag", key: "flowchartReview.groupName" | "flowchartReview.tag") =>
			new Setting(el)
				.setName(ctx.t(`${key}.name`))
				.setDesc(ctx.t(`${key}.desc`))
				.addText((input) =>
					input
						.setPlaceholder(ctx.settings[name])
						.setValue(ctx.settings[name])
						.onChange((v) => {
							if (v.trim()) void ctx.updateSettings({ [name]: name === "tag" ? v.trim().replace(/^#/, "") : v.trim() });
						}),
				);
		text("groupName", "flowchartReview.groupName");
		text("tag", "flowchartReview.tag");
		new Setting(el)
			.setName(ctx.t("flowchartReview.nameWords.name"))
			.setDesc(ctx.t("flowchartReview.nameWords.desc"))
			.addSlider((s) => s.setLimits(1, 12, 1).setValue(ctx.settings.nameWords).onChange((v) => void ctx.updateSettings({ nameWords: v })));
		new Setting(el)
			.setName(ctx.t("flowchartReview.squares.name"))
			.setDesc(ctx.t("flowchartReview.squares.desc"))
			.addToggle((tg) => tg.setValue(ctx.settings.squares).onChange((v) => void ctx.updateSettings({ squares: v })));
		new Setting(el)
			.setName(ctx.t("flowchartReview.answerMode.name"))
			.setDesc(ctx.t("flowchartReview.answerMode.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ type: ctx.t("flowchartReview.answers.type"), drag: ctx.t("flowchartReview.answers.drag") })
					.setValue(ctx.settings.answerMode)
					.onChange((v) => void ctx.updateSettings({ answerMode: v as AnswerMode })),
			);
		new Setting(el)
			.setName(ctx.t("flowchartReview.note.name"))
			.setDesc(ctx.t("flowchartReview.note.desc", { path: normalizePath(`${ctx.filesFolder()}/${NOTE_NAME}`) }));
	},
});
