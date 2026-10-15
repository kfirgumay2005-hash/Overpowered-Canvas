import { Setting, TFile, debounce } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasEdgeData } from "../../data/json-canvas";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { nodeType, randomId } from "../shared";
import { desiredAutoEdges } from "./logic";

/** A property name, shown as an example (data, not prose). */
const EXAMPLE_PROPERTY = "canvas-edges";

interface AutoEdgesSettings {
	property: string;
}

/**
 * Edges between note cards from a frontmatter property (default `canvas-edges`): a note listing
 * [[Other note]] gets an edge to Other note's card. Auto edges are marked in x-opc and removed
 * when the link disappears from the property. Manual edges are never touched.
 */
export const autoEdgesModule = defineModule<AutoEdgesSettings>({
	id: "auto-edges",
	name: "autoEdges.name",
	description: "autoEdges.desc",
	group: "vault",
	defaultEnabled: true,
	defaultSettings: { property: "canvas-edges" },
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const app = ctx.app;
		const mc = app.metadataCache;

		const sync = (canvas: CanvasLike) => {
			const key = ctx.settings.property.trim();
			if (!key || canvas.readonly || !ctx.data.isWritable(canvas)) return;
			// Portal contents ("<portal>~<id>") belong to another canvas.
			const fileNodes = [...canvas.nodes.values()].filter((n) => !n.id.includes("~") && nodeType(n) === "file" && n.file instanceof TFile) as (CanvasNodeLike & { file: TFile })[];
			const desired = desiredAutoEdges(
				fileNodes.map((n) => ({ id: n.id, path: n.file.path, property: mc.getFileCache(n.file)?.frontmatter?.[key] as unknown })),
				(link, source) => mc.getFirstLinkpathDest(link, source)?.path ?? null,
			);
			let changed = false;
			const present = new Set<string>();
			for (const edge of [...canvas.edges.values()]) {
				const k = `${edge.from.node.id}->${edge.to.node.id}`;
				if (ctx.data.edge(edge).get().auto) {
					if (!desired.has(k)) {
						canvas.removeEdge(edge);
						changed = true;
						continue;
					}
				}
				present.add(k);
			}
			const add: CanvasEdgeData[] = [];
			for (const [k, [from, to]] of desired) if (!present.has(k)) add.push({ id: randomId(), fromNode: from, toNode: to, "x-opc": { auto: true } });
			if (add.length) {
				canvas.importData({ nodes: [], edges: add }, false);
				changed = true;
			}
			// Automatic, not a user action: fold into the current undo step.
			if (changed) canvas.overrideHistory();
		};

		const timers = new WeakMap<CanvasLike, ReturnType<typeof debounce>>();
		const schedule = (canvas: CanvasLike) => {
			let d = timers.get(canvas);
			if (!d) timers.set(canvas, (d = debounce(() => sync(canvas), 250, true)));
			d();
		};

		ctx.onCanvas((canvas) => schedule(canvas));
		ctx.on("data-load", schedule);
		ctx.on("history-apply", schedule);
		ctx.on("node-added", (node) => nodeType(node) === "file" && schedule(node.canvas));
		ctx.on("node-removed", (node) => schedule(node.canvas));
		ctx.registerEvent(
			mc.on("changed", (file) => {
				if (file.extension !== "md") return;
				for (const canvas of ctx.canvases()) if ([...canvas.nodes.values()].some((n) => n.file === file)) schedule(canvas);
			}),
		);
		ctx.onSettingsChange(() => ctx.canvases().forEach(schedule));
	},

	renderSettings(el, ctx) {
		new Setting(el)
			.setName(ctx.t("autoEdges.property.name"))
			.setDesc(ctx.t("autoEdges.property.desc"))
			.addText((t) => t.setPlaceholder(EXAMPLE_PROPERTY).setValue(ctx.settings.property).onChange((v) => ctx.updateSettings({ property: v })));
	},
});
