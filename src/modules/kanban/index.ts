import { Modal, Notice, Setting, TFile, type App } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { KanbanBinding } from "../../data/schema";
import { freeSlot } from "../../geometry/grid";
import type { Translate } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { orderFrames } from "../frames/logic";
import { canvasDirection, mutate, nodeType } from "../shared";
import { columnAt, propertyMatches, slug, targetColumn, type Column } from "./logic";
import { logError } from "../../core/log";

interface KanbanSettings {
	/** Move cards while the canvas is open when a note's property changes. */
	liveSync: boolean;
}


const boxOf = (n: CanvasNodeLike) => ({ x: n.x, y: n.y, width: n.width, height: n.height });

function noteOf(node: CanvasNodeLike): TFile | null {
	return nodeType(node) === "file" && node.file instanceof TFile && node.file.extension === "md" ? node.file : null;
}

class BindingModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly initial: KanbanBinding,
		private readonly onSubmit: (binding: KanbanBinding) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { t } = this;
		this.setTitle(t("kanban.bindTitle"));
		this.contentEl.createEl("p", { cls: "setting-item-description", text: t("kanban.bindHelp") });
		const value = { ...this.initial };
		new Setting(this.contentEl).setName(t("kanban.key")).addText((x) => x.setValue(value.key).onChange((v) => (value.key = v.trim())));
		new Setting(this.contentEl).setName(t("kanban.value")).addText((x) => x.setValue(value.value).onChange((v) => (value.value = v.trim())));
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(t("common.apply"))
					.setCta()
					.onClick(() => {
						if (!value.key || !value.value) return;
						this.close();
						this.onSubmit(value);
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Kanban with two-way sync: a group bound to a frontmatter value (e.g. status: doing) sets
 * that property on notes dropped into it; when the property changes elsewhere, the card moves
 * to the matching group (on open, on "Sync", and live while the canvas is open).
 */
export const kanbanModule = defineModule<KanbanSettings>({
	id: "kanban",
	name: "kanban.name",
	description: "kanban.desc",
	group: "data",
	defaultEnabled: true,
	defaultSettings: { liveSync: true },
	sanitizeSettings: (raw, defaults) => mergeWithDefaults(raw, defaults),

	enable(ctx) {
		const app = ctx.app;
		/** Our own moves must not write notes back. */
		let applying = false;
		const pending = new Map<CanvasLike, Set<CanvasNodeLike>>();
		/** Column each card was last seen in, so undo/redo only writes cards it actually moved. */
		const lastColumn = new WeakMap<CanvasLike, Map<string, string | null>>();
		const remember = (canvas: CanvasLike, cols: Column[]) => {
			const map = new Map<string, string | null>();
			for (const n of canvas.nodes.values()) if (noteOf(n)) map.set(n.id, columnAt(cols, boxOf(n))?.id ?? null);
			lastColumn.set(canvas, map);
		};
		const timers = new Map<CanvasLike, number>();

		const columns = (canvas: CanvasLike): Column[] => {
			const groups = [...canvas.nodes.values()].filter((n) => nodeType(n) === "group" && ctx.data.node(n).get().kanban);
			const ordered = orderFrames(groups.map((g) => ({ id: g.id, x: g.x, y: g.y, label: g.label ?? "" })), undefined, canvasDirection(canvas) === "rtl");
			return ordered.map((f) => {
				const g = canvas.nodes.get(f.id)!;
				const b = ctx.data.node(g).get().kanban!;
				return { id: g.id, box: boxOf(g), key: b.key, value: b.value };
			});
		};

		/** Canvas → notes: cards sitting in a column carry its value. */
		const writeBack = (canvas: CanvasLike, nodes: Iterable<CanvasNodeLike>) => {
			const cols = columns(canvas);
			if (cols.length === 0) return;
			const seen = lastColumn.get(canvas);
			for (const node of nodes) {
				const file = noteOf(node);
				if (!file || !canvas.nodes.has(node.id)) continue;
				const col = columnAt(cols, boxOf(node));
				seen?.set(node.id, col?.id ?? null);
				if (!col) continue;
				const current: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.[col.key];
				if (propertyMatches(current, col.value)) continue;
				void app.fileManager
					.processFrontMatter(file, (fm: Record<string, unknown>) => {
						fm[col.key] = col.value;
					})
					.then(() => ctx.events.emit("kanban-moved", canvas, node, file, col.value))
					.catch((error) => {
						logError("[overpowered-canvas] kanban: could not update", file.path, error);
						new Notice(ctx.t("kanban.writeFailed", { name: file.basename }));
					});
			}
		};

		/** Notes → canvas: cards whose property points at another column move there. */
		const sync = (canvas: CanvasLike) => {
			if (canvas.readonly) return 0;
			const cols = columns(canvas);
			if (cols.length === 0) return 0;
			const rtl = canvasDirection(canvas) === "rtl";
			const moves: { node: CanvasNodeLike; to: Column }[] = [];
			for (const node of canvas.nodes.values()) {
				const file = noteOf(node);
				if (!file) continue;
				const col = columnAt(cols, boxOf(node));
				if (!col) continue;
				const target = targetColumn(cols, col, app.metadataCache.getFileCache(file)?.frontmatter?.[col.key]);
				if (target) moves.push({ node, to: target });
			}
			if (moves.length === 0) {
				remember(canvas, cols);
				return 0;
			}
			applying = true;
			try {
				mutate(ctx, canvas, () => {
					for (const { node, to } of moves) {
						const group = canvas.nodes.get(to.id);
						if (!group) continue;
						const box = boxOf(group);
						const occupied = [...canvas.nodes.values()].filter((n) => n !== node && n !== group && nodeType(n) !== "group" && columnAt([{ ...to, box }], boxOf(n))).map(boxOf);
						const slot = freeSlot(box, occupied, node.width, node.height, rtl);
						if (slot.grow > 0) group.moveAndResize({ ...box, height: box.height + slot.grow });
						node.moveAndResize({ x: slot.x, y: slot.y, width: node.width, height: node.height });
						const file = noteOf(node);
						if (file) ctx.events.emit("kanban-moved", canvas, node, file, to.value);
					}
				});
			} finally {
				applying = false;
			}
			remember(canvas, columns(canvas));
			return moves.length;
		};

		ctx.on("node-moved", (node) => {
			if (applying || !noteOf(node)) return;
			const canvas = node.canvas;
			let set = pending.get(canvas);
			if (!set) pending.set(canvas, (set = new Set()));
			set.add(node);
			const flush = () => {
				timers.delete(canvas);
				// Wait for the drag to end.
				if ((canvas as CanvasLike & { isDragging?: boolean }).isDragging) {
					timers.set(canvas, window.setTimeout(flush, 250));
					return;
				}
				const nodes = pending.get(canvas);
				pending.delete(canvas);
				if (nodes) writeBack(canvas, nodes);
			};
			window.clearTimeout(timers.get(canvas));
			timers.set(canvas, window.setTimeout(flush, 300));
		});
		// Undo/redo: cards it moved to another column update their notes.
		ctx.on("history-apply", (canvas) => {
			const seen = lastColumn.get(canvas);
			const cols = columns(canvas);
			writeBack(canvas, [...canvas.nodes.values()].filter((n) => noteOf(n) && (seen?.get(n.id) ?? null) !== (columnAt(cols, boxOf(n))?.id ?? null)));
		});
		ctx.on("data-load", (canvas) => window.setTimeout(() => sync(canvas), 300));
		ctx.registerEvent(
			app.metadataCache.on("changed", (file) => {
				if (!ctx.settings.liveSync || file.extension !== "md") return;
				for (const canvas of ctx.canvases()) if ([...canvas.nodes.values()].some((n) => noteOf(n) === file)) sync(canvas);
			}),
		);
		ctx.register(() => timers.forEach((t) => window.clearTimeout(t)));

		// Column badge.
		ctx.decorateNodes({
			apply: (node, extra) => {
				let badge = node.nodeEl.querySelector<HTMLElement>(":scope > .opc-kanban-badge");
				if (!extra.kanban || nodeType(node) !== "group") return badge?.remove();
				badge ??= node.nodeEl.createDiv({ cls: "opc-kanban-badge" });
				badge.setText(`${extra.kanban.key}: ${extra.kanban.value}`);
			},
			clear: (node) => node.nodeEl.querySelector(":scope > .opc-kanban-badge")?.remove(),
		});

		const bind = (canvas: CanvasLike, group: CanvasNodeLike) => {
			const current = ctx.data.node(group).get().kanban;
			new BindingModal(app, ctx.t, current ?? { key: "status", value: slug(group.label ?? "") || "todo" }, (binding) => {
				mutate(ctx, canvas, () => ctx.data.node(group).set({ kanban: binding }));
				writeBack(canvas, canvas.nodes.values());
			}).open();
		};
		ctx.onNodeMenu((menu, node) => {
			if (node.canvas.readonly || nodeType(node) !== "group") return;
			const bound = !!ctx.data.node(node).get().kanban;
			menu.addItem((item) => item.setTitle(ctx.t(bound ? "kanban.edit" : "kanban.bind")).setIcon("columns-3").onClick(() => bind(node.canvas, node)));
			if (bound)
				menu.addItem((item) =>
					item
						.setTitle(ctx.t("kanban.unbind"))
						.setIcon("unlink")
						.onClick(() => mutate(ctx, node.canvas, () => ctx.data.node(node).set({ kanban: undefined }))),
				);
		});
		ctx.addCommand({
			id: "sync",
			name: ctx.t("kanban.sync"),
			icon: "refresh-cw",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) new Notice(ctx.t("kanban.synced", { count: sync(canvas) }));
				return true;
			},
		});
	},

	renderSettings(el, ctx: ModuleContext<KanbanSettings>) {
		new Setting(el)
			.setName(ctx.t("kanban.live.name"))
			.setDesc(ctx.t("kanban.live.desc"))
			.addToggle((t) => t.setValue(ctx.settings.liveSync).onChange((v) => ctx.updateSettings({ liveSync: v })));
	},
});
