import { Notice, Platform, Setting, TFile, apiVersion, normalizePath, type Workspace } from "obsidian";
import { defineModule } from "../../core/module";
import { EVENT_PREFIX } from "../../core/events";
import { setLogSink } from "../../core/log";
import { getActiveCanvas } from "../../internals/guards";
import { probeCanvasInternals } from "../../internals/probe";
import type { CanvasLike } from "../../internals/types";
import { describe, formatLog, LogBuffer } from "./log";
import { benchmarkViewport, frameStats, type FrameStats } from "./stats";

interface DiagnosticsSettings {
	benchmarkFrames: number;
	/** Keep error reports, plugin events and board input in a log that can be copied or saved. */
	log: boolean;
	/** Also write the log to a note every few seconds, so it survives a restart. */
	persist: boolean;
}

const LOG_SIZE = 3000;
/** Events that fire for every frame of a drag: left out of the log. */
const NOISY = new Set(["node-moved", "node-changed", "edge-changed", "viewport-changed", "data-requested"]);
const LOG_NOTE = "Debug log.md";
const PREVIOUS_NOTE = "Debug log (previous).md";

/**
 * Developer tools. Also the reference module: it touches nothing in the canvas except the
 * viewport during a benchmark, which it restores afterwards.
 */
export const diagnosticsModule = defineModule<DiagnosticsSettings>({
	id: "diagnostics",
	name: "diagnostics.name",
	description: "diagnostics.desc",
	group: "developer",
	defaultEnabled: false,
	defaultSettings: { benchmarkFrames: 300, log: true, persist: false },
	sanitizeSettings: (raw, defaults) => {
		const r = (raw ?? {}) as Partial<DiagnosticsSettings>;
		const frames = r.benchmarkFrames;
		return {
			benchmarkFrames: typeof frames === "number" && frames >= 30 && frames <= 5000 ? Math.round(frames) : defaults.benchmarkFrames,
			log: typeof r.log === "boolean" ? r.log : defaults.log,
			persist: typeof r.persist === "boolean" ? r.persist : defaults.persist,
		};
	},

	enable(ctx) {
		const requireCanvas = (): CanvasLike | null => {
			const canvas = getActiveCanvas(ctx.app);
			if (!canvas) new Notice(ctx.t("diagnostics.noCanvas"));
			return canvas;
		};

		ctx.addCommand({
			id: "copy-internals-report",
			name: ctx.t("diagnostics.cmd.report"),
			callback: async () => {
				if (!requireCanvas()) return;
				await navigator.clipboard.writeText(JSON.stringify(probeCanvasInternals(ctx.app), null, 1));
				new Notice(ctx.t("diagnostics.report.copied"));
			},
		});

		ctx.addCommand({
			id: "copy-active-patches",
			name: ctx.t("diagnostics.cmd.listPatches"),
			callback: async () => {
				const patches = ctx.inspect.patches();
				await navigator.clipboard.writeText(JSON.stringify({ activeModules: ctx.inspect.activeModules(), patches }, null, 1));
				new Notice(ctx.t("diagnostics.patches.copied", { count: patches.length }));
			},
		});

		// ---- Debug log ------------------------------------------------------------------------
		const buffer = new LogBuffer(LOG_SIZE);
		const app = ctx.app;
		const notePath = (name: string) => normalizePath(`${ctx.filesFolder()}/${name}`);
		const header = (): Record<string, string> => ({
			date: new Date().toISOString(),
			app: apiVersion,
			plugin: (app as unknown as { plugins?: { plugins?: Record<string, { manifest?: { version?: string } }> } }).plugins?.plugins?.overpoweredcanvas?.manifest?.version ?? "?",
			platform: `${Platform.isIosApp ? "iOS" : Platform.isAndroidApp ? "Android" : Platform.isMacOS ? "macOS" : Platform.isWin ? "Windows" : Platform.isLinux ? "Linux" : "?"}${Platform.isTablet ? " tablet" : Platform.isPhone ? " phone" : ""}`,
			screen: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`,
		});
		let dirty = false;
		let saveTimer = 0;
		const writeNote = async (path: string, text: string) => {
			const folder = normalizePath(ctx.filesFolder());
			if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder).catch(() => undefined);
			const file = app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) await app.vault.modify(file, text);
			else await app.vault.create(path, text);
			return app.vault.getAbstractFileByPath(path);
		};
		const persistSoon = () => {
			if (!ctx.settings.persist || saveTimer) return;
			saveTimer = window.setTimeout(() => {
				saveTimer = 0;
				if (!dirty) return;
				dirty = false;
				void writeNote(notePath(LOG_NOTE), formatLog(buffer.all(), header())).catch(() => undefined);
			}, 5000);
		};
		let inside = false;
		const record = (level: string, args: unknown[]) => {
			if (!ctx.settings.log || inside) return;
			inside = true;
			try {
				buffer.add(level, args.map((a) => describe(a)).join(" "));
				dirty = true;
				persistSoon();
			} catch {
				// Logging must never break the caller.
			} finally {
				inside = false;
			}
		};
		// The plugin's own error reports, uncaught errors and failed promises.
		setLogSink((level, args) => record(level, args));
		const onError = (e: ErrorEvent) => record("error", ["uncaught", e.error ?? e.message, `${e.filename}:${e.lineno}`]);
		const onRejection = (e: PromiseRejectionEvent) => record("error", ["unhandled rejection", e.reason]);
		window.addEventListener("error", onError);
		window.addEventListener("unhandledrejection", onRejection);
		ctx.register(() => {
			setLogSink(null);
			window.removeEventListener("error", onError);
			window.removeEventListener("unhandledrejection", onRejection);
			if (saveTimer) window.clearTimeout(saveTimer);
		});
		// The plugin's own events (tools switched on and off, layouts, drops…).
		ctx.patch("workspace.trigger (debug log)", app.workspace, {
			trigger: (next) =>
				function (this: Workspace, name: string, ...data: unknown[]) {
					if (name.startsWith(EVENT_PREFIX) && !NOISY.has(name.slice(EVENT_PREFIX.length))) record("event", [name.slice(EVENT_PREFIX.length), ...data]);
					return next.call(this, name, ...data);
				},
		});
		// Pointer input on canvases: what reached the board, with which pointer.
		const onPointer = (e: PointerEvent) => {
			const target = e.target as HTMLElement | null;
			if (!target?.closest?.(".canvas-wrapper")) return;
			record("input", [e.type, `${e.pointerType}#${e.pointerId}`, `on ${describe(target)}`, `classes: ${target.closest(".canvas-wrapper")?.className ?? ""}`]);
		};
		for (const type of ["pointerdown", "pointercancel"]) window.addEventListener(type, onPointer as EventListener, true);
		ctx.register(() => {
			for (const type of ["pointerdown", "pointercancel"]) window.removeEventListener(type, onPointer as EventListener, true);
		});
		// A log kept from before this start (for example, before a restart).
		if (ctx.settings.persist) {
			const last = app.vault.getAbstractFileByPath(notePath(LOG_NOTE));
			if (last instanceof TFile)
				void app.vault
					.read(last)
					.then((text) => writeNote(notePath(PREVIOUS_NOTE), text))
					.catch(() => undefined);
		}
		record("info", ["debug log started"]);

		ctx.addCommand({
			id: "copy-debug-log",
			name: ctx.t("diagnostics.cmd.copyLog"),
			callback: async () => {
				await navigator.clipboard.writeText(formatLog(buffer.all(), header()));
				new Notice(ctx.t("diagnostics.log.copied", { count: buffer.all().length }));
			},
		});
		ctx.addCommand({
			id: "save-debug-log",
			name: ctx.t("diagnostics.cmd.saveLog"),
			callback: async () => {
				const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
				const file = await writeNote(notePath(`Debug log ${stamp}.md`), formatLog(buffer.all(), header()));
				if (file instanceof TFile) await app.workspace.getLeaf("tab").openFile(file);
				new Notice(ctx.t("diagnostics.log.saved"));
			},
		});
		ctx.addCommand({
			id: "clear-debug-log",
			name: ctx.t("diagnostics.cmd.clearLog"),
			callback: () => {
				buffer.clear();
				dirty = true;
				new Notice(ctx.t("diagnostics.log.cleared"));
			},
		});

		let running = false;
		ctx.addCommand({
			id: "run-benchmark",
			name: ctx.t("diagnostics.cmd.benchmark"),
			callback: async () => {
				const canvas = requireCanvas();
				if (!canvas || running) return;
				running = true;
				new Notice(ctx.t("diagnostics.benchmark.running"));
				try {
					const stats = await runBenchmark(canvas, ctx.settings.benchmarkFrames, (cleanup) => ctx.register(cleanup));
					const result = {
						date: new Date().toISOString(),
						obsidian: apiVersion,
						platform: Platform.isMobile ? "mobile" : "desktop",
						file: canvas.view.file?.path ?? null,
						nodes: canvas.nodes.size,
						edges: canvas.edges.size,
						...stats,
					};
					await navigator.clipboard.writeText(JSON.stringify(result, null, 1));
					new Notice(ctx.t("diagnostics.benchmark.done", { fps: stats.avgFps, p95: stats.p95Ms, slow: stats.slowFrames }), 10_000);
				} finally {
					running = false;
				}
			},
		});
	},

	renderSettings(containerEl, ctx) {
		new Setting(containerEl)
			.setName(ctx.t("diagnostics.log.name"))
			.setDesc(ctx.t("diagnostics.log.desc"))
			.addToggle((t) => t.setValue(ctx.settings.log).onChange((v) => ctx.updateSettings({ log: v })));
		new Setting(containerEl)
			.setName(ctx.t("diagnostics.persist.name"))
			.setDesc(ctx.t("diagnostics.persist.desc"))
			.addToggle((t) => t.setValue(ctx.settings.persist).onChange((v) => ctx.updateSettings({ persist: v })));
		new Setting(containerEl)
			.setName(ctx.t("diagnostics.frames.name"))
			.setDesc(ctx.t("diagnostics.frames.desc"))
			.addText((text) =>
				text.setValue(String(ctx.settings.benchmarkFrames)).onChange(async (value) => {
					const n = Number(value);
					if (Number.isFinite(n)) await ctx.updateSettings({ benchmarkFrames: n });
				}),
			);
	},
});

/** Drives the viewport along a fixed path, one step per animation frame, then restores it. */
function runBenchmark(canvas: CanvasLike, frames: number, onDisable: (cleanup: () => void) => void): Promise<FrameStats> {
	const start = { x: canvas.x, y: canvas.y, zoom: canvas.zoom };
	const times: number[] = [];
	return new Promise((resolve) => {
		let i = 0;
		let last = 0;
		let handle = 0;
		let done = false;
		const finish = () => {
			if (done) return;
			done = true;
			cancelAnimationFrame(handle);
			canvas.setViewport(start.x, start.y, start.zoom);
			resolve(frameStats(times));
		};
		// If the module is disabled mid-run, stop and restore the viewport.
		onDisable(finish);
		const step = (ts: number) => {
			if (last) times.push(ts - last);
			last = ts;
			const v = benchmarkViewport(i, frames, start);
			canvas.setViewport(v.x, v.y, v.zoom);
			if (++i < frames) handle = window.requestAnimationFrame(step);
			else finish();
		};
		handle = window.requestAnimationFrame(step);
	});
}
