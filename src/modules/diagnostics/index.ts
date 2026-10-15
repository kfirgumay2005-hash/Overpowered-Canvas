import { Notice, Platform, Setting, apiVersion } from "obsidian";
import { defineModule } from "../../core/module";
import { getActiveCanvas } from "../../internals/guards";
import { probeCanvasInternals } from "../../internals/probe";
import type { CanvasLike } from "../../internals/types";
import { benchmarkViewport, frameStats, type FrameStats } from "./stats";

interface DiagnosticsSettings {
	benchmarkFrames: number;
}

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
	defaultSettings: { benchmarkFrames: 300 },
	sanitizeSettings: (raw, defaults) => {
		const frames = (raw as Partial<DiagnosticsSettings> | undefined)?.benchmarkFrames;
		return { benchmarkFrames: typeof frames === "number" && frames >= 30 && frames <= 5000 ? Math.round(frames) : defaults.benchmarkFrames };
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
