import { MarkdownView, Setting, TFile, type EventRef } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { viewMemory } from "../../core/view-memory";
import type { CanvasLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { pagesHost } from "../pages/api";

interface ViewMemorySettings {
	canvases: boolean;
	notes: boolean;
}

/** After a canvas loads, the core frames it once (now, or when its tab is first shown). */
const SETTLE_MS = 10_000;
/** A note's own jump (a link to a heading, a search result) arrives this soon after it opens. */
const JUMP_MS = 250;
/** Once restored on screen, the core may still frame the board this soon after. */
const SHOWN_MS = 1500;
/** Boards open this soon after Obsidian started were opened by the restored workspace. */
const STARTUP_MS = 60_000;

type Viewport = { tx: number; ty: number; tZoom: number; x: number; y: number; zoom: number };

/**
 * Remember where you were: a canvas opens again on the page, place and zoom it was left at, a note
 * at the place it was read (and on its page, for a note with pages): after following a link and
 * coming back, after closing and opening it again, and after restarting Obsidian. Opening a link to
 * a card or a heading still goes there.
 */
export const viewMemoryModule = defineModule<ViewMemorySettings>({
	id: "view-memory",
	name: "viewMemory.name",
	description: "viewMemory.desc",
	group: "navigation",
	defaultEnabled: true,
	defaultSettings: { canvases: true, notes: true },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return { canvases: typeof s.canvases === "boolean" ? s.canvases : defaults.canvases, notes: typeof s.notes === "boolean" ? s.notes : defaults.notes };
	},

	enable(ctx) {
		const app = ctx.app;
		viewMemory.attach(app);
		const apply = () => {
			viewMemory.canvases = ctx.settings.canvases;
			viewMemory.notes = ctx.settings.notes;
		};
		apply();
		ctx.onSettingsChange(apply);
		ctx.register(() => {
			viewMemory.flush();
			viewMemory.canvases = false;
			viewMemory.notes = false;
		});
		ctx.registerEvent(app.vault.on("rename", (file, oldPath) => viewMemory.renamed(oldPath, file.path)));
		ctx.registerEvent(app.vault.on("delete", (file) => viewMemory.deleted(file.path)));
		ctx.registerEvent(app.workspace.on("quit", () => remember()));

		// ---------- canvases ----------

		/** Canvases just opened, until their place is restored for good (see SETTLE_MS). */
		const pending = new Map<CanvasLike, { path: string; until: number }>();
		const pathOf = (canvas: CanvasLike) => canvas.view.file?.path ?? "";

		/** When each canvas last loaded a file: a tab that opens another canvas keeps its canvas. */
		const loaded = new WeakMap<CanvasLike, number>();
		const record = (canvas: CanvasLike) => {
			const path = pathOf(canvas);
			if (!path || pending.has(canvas) || !canvas.wrapperEl.isConnected || canvas.canvasRect.width === 0 || canvas.nodes.size === 0 || Date.now() - (loaded.get(canvas) ?? 0) < 600) return;
			// Pages not running (Obsidian closing, the module off): the page stays as it was.
			const page = pagesHost.api ? pagesHost.api.current(canvas) : (viewMemory.canvas(path)?.page ?? "");
			viewMemory.setCanvas(path, { page, x: Math.round(canvas.tx), y: Math.round(canvas.ty), zoom: Math.round(canvas.tZoom * 1000) / 1000 });
		};
		const restore = (canvas: CanvasLike, tries = 0): boolean => {
			const spot = viewMemory.canvas(pathOf(canvas));
			if (!spot) return false;
			const api = pagesHost.api;
			// Starting Obsidian, the Pages module (or the board's own data) may come a moment later.
			const known = !spot.page || (ctx.data.root(canvas).get().pages ?? []).some((p) => p.id === spot.page);
			if ((!api || !known) && spot.page && tries < 20) {
				window.setTimeout(() => {
					if (pending.has(canvas)) restore(canvas, tries + 1);
				}, 150);
			}
			restoring = true;
			try {
				if (api && api.current(canvas) !== spot.page) api.show(canvas, spot.page);
			} finally {
				restoring = false;
			}
			// Straight there, without gliding from wherever the core put the view.
			const v = canvas as unknown as Viewport;
			v.tx = v.x = spot.x;
			v.ty = v.y = spot.y;
			v.tZoom = v.zoom = spot.zoom;
			canvas.zoomCenter = null;
			canvas.markViewportChanged();
			// Placed on a board that is on screen: only the core's framing right after can still undo it.
			const p = pending.get(canvas);
			if (p && canvas.canvasRect.width > 0) p.until = Math.min(p.until, Date.now() + SHOWN_MS);
			return true;
		};

		/**
		 * Starting Obsidian: a board the restored workspace loaded before this plugin was up never
		 * sends its load, and may not know its file yet when this module starts. Its first frame
		 * with a file restores it.
		 */
		const atStartup = (canvas: CanvasLike) => {
			if (loaded.has(canvas) || !canvas.view.file || performance.now() > STARTUP_MS) return;
			loaded.set(canvas, Date.now());
			if (!viewMemory.canvas(pathOf(canvas))) return;
			pending.set(canvas, { path: pathOf(canvas), until: Date.now() + SETTLE_MS });
			window.setTimeout(() => {
				if (pending.has(canvas)) restore(canvas);
			}, 0);
		};

		ctx.on("data-load", (canvas) => {
			loaded.set(canvas, Date.now());
			if (!viewMemory.canvas(pathOf(canvas))) return;
			pending.set(canvas, { path: pathOf(canvas), until: Date.now() + SETTLE_MS });
			// After the core and the Pages module have framed the board for this load.
			window.setTimeout(() => {
				if (pending.has(canvas)) restore(canvas);
			}, 0);
		});
		// The core frames a board when its tab is first shown: the remembered place wins once.
		ctx.onCanvas((canvas) => {
			const proto = Object.getPrototypeOf(canvas) as CanvasLike;
			if (!patched.has(proto)) {
				patched.add(proto);
				ctx.patch("canvas.zoomToFit (view memory)", proto, {
					zoomToFit: (next) =>
						function (this: CanvasLike) {
							const p = pending.get(this);
							if (p && Date.now() < p.until && p.path === pathOf(this) && restore(this)) return;
							return next.call(this);
						},
				});
			}
			atStartup(canvas);
			// Anything the user does (or a link to a card selecting it) ends the waiting.
			const settle = () => pending.delete(canvas);
			const wrapper = canvas.wrapperEl;
			wrapper.addEventListener("pointerdown", settle, true);
			wrapper.addEventListener("wheel", settle, { capture: true, passive: true });
			wrapper.addEventListener("keydown", settle, true);
			return () => {
				pending.delete(canvas);
				wrapper.removeEventListener("pointerdown", settle, true);
				wrapper.removeEventListener("wheel", settle, true);
				wrapper.removeEventListener("keydown", settle, true);
				// Not recorded here: a closing canvas is emptied first. Its last frame was kept.
			};
		});
		const patched = new WeakSet<object>();
		// Another page shown on purpose (the index, a link, a note switched back to its canvas) wins.
		let restoring = false;
		const workspace = app.workspace as unknown as { on(name: string, cb: (canvas: CanvasLike) => void): EventRef };
		ctx.registerEvent(
			workspace.on("overpowered-canvas:page-shown", (canvas) => {
				if (!restoring) pending.delete(canvas);
			}),
		);
		ctx.on("selection-change", (canvas) => {
			// A link to a card selects it: that card is where the view goes.
			if (canvas.selection.size) pending.delete(canvas);
		});
		const frames = new WeakMap<CanvasLike, number>();
		ctx.on("canvas-frame", (canvas) => {
			atStartup(canvas);
			const p = pending.get(canvas);
			if (p && Date.now() > p.until) pending.delete(canvas);
			if (frames.has(canvas)) return;
			frames.set(
				canvas,
				window.setTimeout(() => {
					frames.delete(canvas);
					record(canvas);
				}, 400),
			);
		});

		// ---------- notes ----------

		/** Notes just opened: did something ask to jump somewhere in them? */
		const opened = new WeakMap<MarkdownView, { path: string; at: number; jumped: boolean }>();
		const saveNote = (view: MarkdownView) => {
			const file = view.file;
			if (!file) return;
			const scroll = (view.getEphemeralState() as { scroll?: unknown }).scroll;
			if (typeof scroll === "number" && Number.isFinite(scroll)) viewMemory.setNote(file.path, { scroll: Math.round(scroll * 100) / 100 });
		};
		/** A note just opened goes back to where it was read, unless it was opened to jump somewhere. */
		const restoreLater = (view: MarkdownView, file: TFile) =>
			window.setTimeout(() => {
				const o = opened.get(view);
				const spot = viewMemory.note(file.path);
				if (!o || o.jumped || o.path !== view.file?.path || spot?.scroll === undefined) return;
				view.setEphemeralState({ scroll: spot.scroll });
			}, JUMP_MS);
		ctx.patch("MarkdownView (view memory)", MarkdownView.prototype, {
			onUnloadFile: (next) =>
				async function (this: MarkdownView, file: TFile) {
					if (file === this.file) saveNote(this);
					return next.call(this, file);
				},
			onLoadFile: (next) =>
				async function (this: MarkdownView, file: TFile) {
					opened.set(this, { path: file.path, at: Date.now(), jumped: false });
					await next.call(this, file);
					restoreLater(this, file);
				},
			setEphemeralState: (next) =>
				function (this: MarkdownView, state: unknown) {
					const s = state as Record<string, unknown> | null | undefined;
					const o = opened.get(this);
					// A link to a heading or a line, a search hit, or Obsidian's own back and forth.
					if (o && s && (s.subpath || typeof s.line === "number" || s.match || typeof s.scroll === "number")) o.jumped = true;
					return next.call(this, state);
				},
		});
		const remember = () => {
			for (const leaf of app.workspace.getLeavesOfType("markdown")) if (leaf.view instanceof MarkdownView) saveNote(leaf.view);
			for (const canvas of ctx.canvases()) record(canvas);
			viewMemory.flush();
		};
		// Reading positions change all the time: kept every few seconds and when the tab changes.
		ctx.registerInterval(window.setInterval(remember, 5000));
		ctx.registerEvent(app.workspace.on("active-leaf-change", remember));
		ctx.registerDomEvent(window, "beforeunload", remember);
	},

	renderSettings(el, ctx: ModuleContext<ViewMemorySettings>) {
		new Setting(el)
			.setName(ctx.t("viewMemory.canvases.name"))
			.setDesc(ctx.t("viewMemory.canvases.desc"))
			.addToggle((t) => t.setValue(ctx.settings.canvases).onChange((v) => ctx.updateSettings({ canvases: v })));
		new Setting(el)
			.setName(ctx.t("viewMemory.notes.name"))
			.setDesc(ctx.t("viewMemory.notes.desc"))
			.addToggle((t) => t.setValue(ctx.settings.notes).onChange((v) => ctx.updateSettings({ notes: v })));
	},
});
