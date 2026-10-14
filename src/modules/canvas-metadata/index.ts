import { TFile, debounce, type TAbstractFile } from "obsidian";
import { defineModule } from "../../core/module";
import { coreCanvasPlugin, metadataCacheInternal, type MetadataCacheInternal } from "../../internals/app";
import { buildCanvasMetadata, type CanvasMetadata } from "./build";

const isCanvas = (f: TAbstractFile | null | undefined): f is TFile => f instanceof TFile && f.extension === "canvas";

/**
 * Gives .canvas files a real metadata cache entry: outgoing links, embeds, tags, headings and
 * frontmatter (from x-opc.frontmatter). Backlinks and the graph already include canvases in
 * core Obsidian; this adds the outgoing-links pane, the tag pane, aliases in the quick switcher,
 * and property / tag search. In memory only — nothing is written to Obsidian's cache database.
 */
export const canvasMetadataModule = defineModule({
	id: "canvas-metadata",
	name: "canvasMetadata.name",
	description: "canvasMetadata.desc",
	group: "vault",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const mc = metadataCacheInternal(ctx.app);
		if (!mc) throw new Error("metadataCache internals not found");
		const app = ctx.app;
		const index = new Map<string, CanvasMetadata>();

		const update = async (file: TFile) => {
			let parsed: unknown = null;
			try {
				parsed = JSON.parse(await app.vault.cachedRead(file));
			} catch {
				// Empty or broken canvas: no metadata.
			}
			const meta = buildCanvasMetadata(parsed, coreCanvasPlugin(app)?.index.getForPath(file.path) ?? null);
			const before = index.get(file.path);
			index.set(file.path, meta);
			if (JSON.stringify(before) !== JSON.stringify(meta)) mc.trigger("changed", file, "", meta);
		};

		const pending = new Map<string, TFile>();
		const flush = debounce(
			() => {
				const files = [...pending.values()];
				pending.clear();
				for (const f of files) void update(f);
			},
			300,
			true,
		);
		const queue = (file: TFile) => {
			pending.set(file.path, file);
			flush();
		};

		ctx.patch("metadataCache.getCache/iterateFileCache", mc, {
			getCache: (next) =>
				function (this: unknown, path: string) {
					return index.get(path) ?? next.call(this, path);
				},
			iterateFileCache: (next) =>
				function (this: MetadataCacheInternal, cb: (path: string, meta: unknown) => void) {
					next.call(this, cb);
					for (const [path, meta] of index) if (!this.isUserIgnored?.(path)) cb(path, meta);
				},
		});

		for (const file of app.vault.getFiles()) if (isCanvas(file)) queue(file);
		ctx.registerEvent(app.vault.on("modify", (f) => isCanvas(f) && queue(f)));
		ctx.registerEvent(app.vault.on("create", (f) => isCanvas(f) && queue(f)));
		ctx.registerEvent(
			app.vault.on("delete", (f) => {
				if (isCanvas(f)) index.delete(f.path);
			}),
		);
		ctx.registerEvent(
			app.vault.on("rename", (f, oldPath) => {
				index.delete(oldPath);
				if (isCanvas(f)) queue(f);
			}),
		);
		// The core canvas index parses text cards asynchronously and then asks for link resolution.
		ctx.registerEvent(app.metadataCache.on("resolve", (f) => isCanvas(f) && queue(f)));

		ctx.register(() => {
			flush.cancel();
			const paths = [...index.keys()];
			index.clear();
			// Let open panes (outgoing links, tags) drop the canvas metadata.
			for (const path of paths) {
				const f = app.vault.getAbstractFileByPath(path);
				if (isCanvas(f)) mc.trigger("changed", f, "", {});
			}
		});
	},
});
