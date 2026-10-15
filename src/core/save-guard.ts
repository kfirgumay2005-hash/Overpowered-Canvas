/**
 * Data safety net, active while at least one module is enabled:
 * - before every save, x-opc objects that would not serialize cleanly are stripped (core canvas
 *   data is never touched) so a module bug can never corrupt a file;
 * - on load, files from an older schema version are migrated in memory.
 */
import { Notice } from "obsidian";
import type { CanvasFileData } from "../data/json-canvas";
import { migrateFile } from "../data/migrations";
import { checkCanvasFile, hasErrors, stripInvalidExtra } from "../data/validate-file";
import type { CanvasViewLike } from "../internals/types";
import type { CanvasTracker } from "./canvas-tracker";
import type { Patcher } from "./patcher";

export class SaveGuard {
	private uninstall: (() => void) | null = null;
	private untrack: (() => void) | null = null;
	private warned = false;

	constructor(
		private readonly patcher: Patcher,
		private readonly tracker: CanvasTracker,
		/** Text of the notice shown when invalid plugin data was dropped (translated). */
		private readonly droppedMessage: () => string,
	) {}

	setActive(active: boolean): void {
		if (active && !this.untrack) {
			this.untrack = this.tracker.subscribe((_canvas, view) => {
				if (!this.uninstall) this.install(Object.getPrototypeOf(view) as CanvasViewLike);
			});
		} else if (!active && this.untrack) {
			this.untrack();
			this.untrack = null;
			this.uninstall?.();
			this.uninstall = null;
		}
	}

	private install(proto: CanvasViewLike): void {
		const warnOnce = () => this.warnOnce();
		this.uninstall = this.patcher.apply<CanvasViewLike>("core:save-guard", "view.getViewData/setViewData", proto, {
			getViewData: (next) =>
				function (this: CanvasViewLike) {
					try {
						const canvas = this.canvas;
						const problems = checkCanvasFile(canvas.data);
						if (hasErrors(problems)) {
							const cleaned = stripInvalidExtra(canvas.data, problems);
							if (cleaned !== canvas.data) {
								console.error("[overpowered-canvas] Removed invalid extra data before saving", this.file?.path, problems);
								canvas.data = cleaned;
								warnOnce();
							}
						}
					} catch (error) {
						console.error("[overpowered-canvas] save guard failed; saving unchanged", error);
					}
					return next.call(this);
				},
			setViewData: (next) =>
				function (this: CanvasViewLike, text: string, clear: boolean) {
					let out = text;
					try {
						if (text) {
							const result = migrateFile(JSON.parse(text) as CanvasFileData);
							if (result.status.kind === "migrated") out = JSON.stringify(result.file);
						}
					} catch {
						// Unparseable files are left to Obsidian's own error handling.
					}
					return next.call(this, out, clear);
				},
		});
	}

	private warnOnce(): void {
		if (this.warned) return;
		this.warned = true;
		new Notice(this.droppedMessage(), 10_000);
	}
}
