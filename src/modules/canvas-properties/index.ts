import { TFile, stringifyYaml, type View } from "obsidian";
import { defineModule } from "../../core/module";
import { SCHEMA_KEY, SCHEMA_VERSION } from "../../data/schema";
import { isJsonSafe, isPlainObject } from "../../data/validate";
import type { CanvasLike, CanvasViewLike } from "../../internals/types";
import { readFrontmatter } from "../canvas-metadata/build";
import { PropertiesModal } from "../../ui/properties-modal";
import { mutate } from "../shared";

/** cssclasses may be a list or a comma/space separated string. */
export function cssClassesOf(frontmatter: Record<string, unknown> | undefined): string[] {
	const raw = frontmatter?.cssclasses ?? frontmatter?.cssclass;
	const list = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
	return list.map((c) => c.trim()).filter((c) => /^[A-Za-z_-][\w-]*$/.test(c));
}

/** The core "File properties" pane (view type file-properties), as far as we use it. */
interface FilePropertiesView extends View {
	file: TFile | null;
	modifyingFile: TFile | null;
	isSupportedFile(file: TFile | null): boolean;
	readSupportedFile(file: TFile): Promise<string>;
	saveFrontmatter(frontmatter: Record<string, unknown>): void;
	updateFrontmatter(file: TFile | null, text: string): void;
	update(): void;
}

/**
 * Canvas properties (frontmatter): an info button in the canvas view opens an editor; values
 * are stored in x-opc.frontmatter (one undo step per save). tags, aliases and other properties
 * become searchable through the canvas-metadata module; cssclasses apply to the canvas view.
 */
export const canvasPropertiesModule = defineModule({
	id: "canvas-properties",
	name: "canvasProperties.name",
	description: "canvasProperties.desc",
	group: "vault",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const applied = new WeakMap<CanvasViewLike, string[]>();

		const applyClasses = (canvas: CanvasLike) => {
			const view = canvas.view;
			const next = cssClassesOf(ctx.data.root(canvas).get().frontmatter);
			const prev = applied.get(view) ?? [];
			for (const c of prev) if (!next.includes(c)) view.containerEl.removeClass(c);
			for (const c of next) view.containerEl.addClass(c);
			applied.set(view, next);
		};

		const edit = (canvas: CanvasLike) => {
			const fm = { ...(ctx.data.root(canvas).get().frontmatter ?? {}) };
			new PropertiesModal(ctx.app, ctx.t, ctx.t("canvasProperties.title", { name: canvas.view.file?.basename ?? "" }), fm, (next) => {
				mutate(ctx, canvas, () => ctx.data.root(canvas).set({ frontmatter: Object.keys(next).length ? next : undefined }));
				applyClasses(canvas);
			}).open();
		};

		ctx.onCanvas((canvas, view) => {
			const action = view.addAction("info", ctx.t("canvasProperties.button"), () => edit(canvas));
			action.addClass("opc-canvas-properties-action");
			applyClasses(canvas);
			return () => {
				action.remove();
				for (const c of applied.get(view) ?? []) view.containerEl.removeClass(c);
				applied.delete(view);
			};
		});
		ctx.on("data-load", applyClasses);
		ctx.on("root-extra-change", applyClasses);
		ctx.on("history-apply", applyClasses);

		// ---- the core "File properties" pane: read and edit canvas properties there too ----
		const openCanvasFor = (file: TFile) => ctx.canvases().find((c) => c.view.file === file) ?? null;
		const readCanvasFrontmatter = async (file: TFile): Promise<Record<string, unknown> | undefined> => {
			const canvas = openCanvasFor(file);
			if (canvas) return ctx.data.root(canvas).get().frontmatter;
			try {
				return readFrontmatter(JSON.parse(await ctx.app.vault.cachedRead(file)));
			} catch {
				return undefined;
			}
		};
		const writeCanvasFrontmatter = async (file: TFile, fm: Record<string, unknown>) => {
			const clean = isPlainObject(fm) && isJsonSafe(fm) && Object.keys(fm).length ? fm : undefined;
			const canvas = openCanvasFor(file);
			if (canvas) {
				mutate(ctx, canvas, () => ctx.data.root(canvas).set({ frontmatter: clean }));
				applyClasses(canvas);
				return;
			}
			await ctx.app.vault.process(file, (text) => {
				const data = JSON.parse(text) as Record<string, unknown>;
				const root: Record<string, unknown> = isPlainObject(data[SCHEMA_KEY]) ? { ...data[SCHEMA_KEY] } : { v: SCHEMA_VERSION };
				if (typeof root.v === "number" && root.v > SCHEMA_VERSION) return text; // newer schema: read-only
				if (clean) root.frontmatter = clean;
				else delete root.frontmatter;
				if (Object.keys(root).filter((k) => k !== "v").length) data[SCHEMA_KEY] = root;
				else delete data[SCHEMA_KEY];
				return JSON.stringify(data, null, "\t");
			});
		};
		const refreshPanes = (file: TFile | null) => {
			for (const leaf of ctx.app.workspace.getLeavesOfType("file-properties")) {
				const view = leaf.view as FilePropertiesView;
				if (!file || view.file !== file || typeof view.updateFrontmatter !== "function") continue;
				void view.readSupportedFile(file).then((text) => {
					view.updateFrontmatter(file, text);
					view.update();
				});
			}
		};
		let paneProto: FilePropertiesView | null = null;
		const patchPane = () => {
			if (paneProto) return;
			const view = ctx.app.workspace.getLeavesOfType("file-properties")[0]?.view as FilePropertiesView | undefined;
			if (!view || typeof view.saveFrontmatter !== "function" || typeof view.readSupportedFile !== "function") return;
			paneProto = Object.getPrototypeOf(view) as FilePropertiesView;
			ctx.patch("file-properties pane", paneProto, {
				isSupportedFile: (next) =>
					function (this: FilePropertiesView, file: TFile | null) {
						return next.call(this, file) || file?.extension === "canvas";
					},
				readSupportedFile: (next) =>
					async function (this: FilePropertiesView, file: TFile) {
						if (file?.extension !== "canvas") return next.call(this, file);
						const fm = await readCanvasFrontmatter(file);
						return fm ? `---\n${stringifyYaml(fm)}---\n` : "";
					},
				saveFrontmatter: (next) =>
					function (this: FilePropertiesView, fm: Record<string, unknown>) {
						const file = this.file;
						if (file?.extension !== "canvas") return next.call(this, fm);
						void writeCanvasFrontmatter(file, fm);
					},
			});
			// Re-read what the pane shows now that canvases are supported.
			for (const leaf of ctx.app.workspace.getLeavesOfType("file-properties")) {
				const v = leaf.view as FilePropertiesView;
				if (v.file?.extension === "canvas") refreshPanes(v.file);
			}
		};
		patchPane();
		ctx.registerEvent(ctx.app.workspace.on("layout-change", patchPane));
		ctx.on("root-extra-change", (canvas) => refreshPanes(canvas.view.file));
		ctx.on("history-apply", (canvas) => refreshPanes(canvas.view.file));

		ctx.addCommand({
			id: "edit-canvas-properties",
			name: ctx.t("canvasProperties.button"),
			icon: "info",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly || !(canvas.view.file instanceof TFile)) return false;
				if (!checking) edit(canvas);
				return true;
			},
		});
	},
});
