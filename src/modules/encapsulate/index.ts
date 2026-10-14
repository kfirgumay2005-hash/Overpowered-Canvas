import { Modal, Notice, Setting, TFile, normalizePath, type App } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasEdgeData, CanvasNodeData } from "../../data/json-canvas";
import type { Translate } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mutate, randomId, selectedNodes } from "../shared";

/** Shifts the selection so its top-left corner sits at (0, 0). Pure. */
export function normalizeSelection(nodes: CanvasNodeData[], edges: CanvasEdgeData[]): { nodes: CanvasNodeData[]; edges: CanvasEdgeData[] } {
	const minX = Math.min(...nodes.map((n) => n.x));
	const minY = Math.min(...nodes.map((n) => n.y));
	return { nodes: nodes.map((n) => ({ ...n, x: n.x - minX, y: n.y - minY })), edges: edges.map((e) => ({ ...e })) };
}

class NameModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private name: string,
		private readonly onSubmit: (name: string) => void,
	) {
		super(app);
	}
	override onOpen(): void {
		this.setTitle(this.t("encapsulate.command"));
		const submit = () => {
			const name = this.name.trim().replace(/[\\/:*?"<>|]/g, "-");
			if (!name) return;
			this.close();
			this.onSubmit(name);
		};
		new Setting(this.contentEl).setName(this.t("encapsulate.fileName")).addText((text) => {
			text.setValue(this.name).onChange((v) => (this.name = v));
			text.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && submit());
			setTimeout(() => text.inputEl.select());
		});
		new Setting(this.contentEl).addButton((b) => b.setButtonText(this.t("encapsulate.create")).setCta().onClick(submit));
	}
	override onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Encapsulate: the selected cards (with the edges between them) move to a new canvas, and a
 * card linking to it takes their place. Edges from the rest of the canvas now point to that card.
 */
export const encapsulateModule = defineModule({
	id: "encapsulate",
	name: "encapsulate.name",
	description: "encapsulate.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const run = (canvas: CanvasLike) => {
			const nodes = selectedNodes(canvas);
			const source = canvas.view.file;
			if (!source || nodes.length === 0) return;
			new NameModal(ctx.app, ctx.t, `${source.basename} - ${ctx.t("encapsulate.defaultName")}`, async (name) => {
				const folder = source.parent?.path ?? "";
				let path = normalizePath(`${folder}/${name}.canvas`);
				for (let i = 2; ctx.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}/${name} ${i}.canvas`);

				const selection = new Set<CanvasNodeLike>(nodes);
				const data = canvas.getSelectionData(new Set(nodes));
				const inner = normalizeSelection(data.nodes, data.edges);
				let file: TFile;
				try {
					file = await ctx.app.vault.create(path, JSON.stringify({ nodes: inner.nodes, edges: inner.edges }, null, "\t"));
				} catch (error) {
					console.error(error);
					new Notice(ctx.t("encapsulate.failed"));
					return;
				}
				const minX = Math.min(...nodes.map((n) => n.x));
				const minY = Math.min(...nodes.map((n) => n.y));
				const maxX = Math.max(...nodes.map((n) => n.x + n.width));
				const maxY = Math.max(...nodes.map((n) => n.y + n.height));
				// Edges with exactly one end in the selection get re-attached to the new card.
				const outside: CanvasEdgeData[] = [];
				for (const edge of canvas.edges.values()) {
					const a = selection.has(edge.from.node);
					const b = selection.has(edge.to.node);
					if (a !== b) outside.push(edge.getData());
				}
				mutate(ctx, canvas, () => {
					const card = canvas.createFileNode({ pos: { x: minX, y: minY }, size: { width: Math.max(200, maxX - minX), height: Math.max(150, maxY - minY) }, file, save: false, focus: false });
					for (const n of nodes) canvas.removeNode(n);
					const ids = new Set(nodes.map((n) => n.id));
					const edges = outside.map((e) => {
						const out: CanvasEdgeData = { ...e, id: randomId() };
						if (ids.has(e.fromNode)) {
							out.fromNode = card.id;
							delete out.fromSide;
						} else {
							out.toNode = card.id;
							delete out.toSide;
						}
						return out;
					});
					canvas.importData({ nodes: [], edges }, false);
					canvas.selectOnly(card);
				});
				ctx.events.emit("selection-encapsulated", canvas, file);
				new Notice(ctx.t("encapsulate.done", { name: file.basename }));
			}).open();
		};

		ctx.addCommand({
			id: "encapsulate-selection",
			name: ctx.t("encapsulate.command"),
			icon: "package",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly || selectedNodes(canvas).length === 0) return false;
				if (!checking) run(canvas);
				return true;
			},
		});
		ctx.onSelectionMenu((menu, canvas) => {
			if (!canvas.readonly) menu.addItem((item) => item.setSection("action").setTitle(ctx.t("encapsulate.command")).setIcon("package").onClick(() => run(canvas)));
		});
		ctx.onNodeMenu((menu, node) => {
			if (!node.canvas.readonly) menu.addItem((item) => item.setSection("action").setTitle(ctx.t("encapsulate.command")).setIcon("package").onClick(() => run(node.canvas)));
		});
	},
});
