import { FuzzySuggestModal, TFile, type App } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { Translate } from "../../i18n";
import type { CanvasItemLike, CanvasLike, CanvasNodeLike } from "../../internals/types";
import { TextPromptModal } from "../../ui/text-prompt";
import { instantiate } from "../board-templates/logic";
import { mutate, randomId, selectedNodes } from "../shared";

class FilePicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		t: Translate,
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(t("canvasCommands.pickFile"));
	}

	getItems(): TFile[] {
		return this.app.vault.getFiles();
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

type Ctx = ModuleContext<object>;

/** The point at the middle of the view, offset so a card of `size` is centered there. */
function centered(canvas: CanvasLike, size: { width: number; height: number }) {
	const v = canvas.getViewportBBox();
	return { x: Math.round((v.minX + v.maxX) / 2 - size.width / 2), y: Math.round((v.minY + v.maxY) / 2 - size.height / 2) };
}

/**
 * The canvas command suite: create cards, select, delete, duplicate, group, nudge and zoom from
 * the command palette (so every action can get a hotkey). Style commands come from the
 * selection toolbar ("Selection: …").
 */
export const canvasCommandsModule = defineModule({
	id: "canvas-commands",
	name: "canvasCommands.name",
	description: "canvasCommands.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		const command = (id: string, icon: string, can: (c: CanvasLike) => boolean, run: (c: CanvasLike) => void) =>
			ctx.addCommand({
				id,
				name: ctx.t(`canvasCommands.${id}` as Parameters<Translate>[0]),
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || !can(canvas)) return false;
					if (!checking) run(canvas);
					return true;
				},
			});
		const writable = (c: CanvasLike) => !c.readonly;
		const hasSelection = (c: CanvasLike) => c.selection.size > 0;
		const select = (canvas: CanvasLike, items: Iterable<CanvasItemLike>) => {
			canvas.deselectAll();
			canvas.selectAll(new Set(items));
		};

		// ---------- create ----------
		const addData = (canvas: CanvasLike, node: Record<string, unknown> & { width: number; height: number }, edit = false) => {
			const id = randomId();
			mutate(ctx as Ctx, canvas, () => {
				canvas.importData({ nodes: [{ id, ...centered(canvas, node), ...node } as never], edges: [] }, false);
			});
			const created = canvas.nodes.get(id);
			if (!created) return;
			canvas.selectOnly(created);
			if (edit) window.setTimeout(() => created.startEditing(), 20);
		};
		command("add-text", "sticky-note", writable, (c) => addData(c, { type: "text", text: "", ...c.config.defaultTextNodeDimensions }, true));
		command("add-note", "file-text", writable, (c) =>
			new FilePicker(ctx.app, ctx.t, (file) => addData(c, { type: "file", file: file.path, ...c.config.defaultFileNodeDimensions })).open(),
		);
		command("add-link", "link", writable, (c) =>
			new TextPromptModal(ctx.app, ctx.t, { title: ctx.t("canvasCommands.add-link"), placeholder: "https://" }, (url) =>
				addData(c, { type: "link", url: /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`, ...c.config.defaultFileNodeDimensions }),
			).open(),
		);
		command("group-selection", "box-select", (c) => writable(c) && selectedNodes(c).length > 0, (c) => {
			const nodes = selectedNodes(c);
			const pad = 40;
			const minX = Math.min(...nodes.map((n) => n.x)) - pad;
			const minY = Math.min(...nodes.map((n) => n.y)) - pad;
			const maxX = Math.max(...nodes.map((n) => n.x + n.width)) + pad;
			const maxY = Math.max(...nodes.map((n) => n.y + n.height)) + pad;
			const id = randomId();
			mutate(ctx as Ctx, c, () => {
				c.importData({ nodes: [{ id, type: "group", label: "", x: minX, y: minY, width: maxX - minX, height: maxY - minY }], edges: [] }, false);
			});
			const group = c.nodes.get(id);
			if (group) c.selectOnly(group);
		});

		// ---------- select / edit ----------
		command("select-all", "box-select", (c) => c.nodes.size > 0, (c) => select(c, [...c.nodes.values(), ...c.edges.values()]));
		command("select-cards", "square-stack", (c) => c.nodes.size > 0, (c) => select(c, c.nodes.values()));
		command("deselect", "square-dashed", hasSelection, (c) => c.deselectAll());
		command("delete-selection", "trash-2", (c) => writable(c) && hasSelection(c), (c) => c.deleteSelection());
		command("duplicate-selection", "copy", (c) => writable(c) && selectedNodes(c).length > 0, (c) => {
			const data = c.getSelectionData();
			const nodes = data.nodes;
			if (nodes.length === 0) return;
			const minX = Math.min(...nodes.map((n) => n.x));
			const minY = Math.min(...nodes.map((n) => n.y));
			const offset = c.gridSpacing * 2 || 40;
			const copy = instantiate({ nodes, edges: data.edges }, { x: minX + offset, y: minY + offset }, () => randomId());
			let added: Set<CanvasNodeLike> | undefined;
			mutate(ctx as Ctx, c, () => {
				added = c.importData({ nodes: copy.nodes, edges: copy.edges }, false);
			});
			if (added?.size) select(c, added);
		});
		const nudge = (dx: number, dy: number) => (c: CanvasLike) => {
			const step = c.gridSpacing || 20;
			mutate(ctx as Ctx, c, () => {
				for (const n of selectedNodes(c)) n.moveAndResize({ x: n.x + dx * step, y: n.y + dy * step, width: n.width, height: n.height });
			});
		};
		const canNudge = (c: CanvasLike) => writable(c) && selectedNodes(c).length > 0;
		command("move-up", "arrow-up", canNudge, nudge(0, -1));
		command("move-down", "arrow-down", canNudge, nudge(0, 1));
		command("move-left", "arrow-left", canNudge, nudge(-1, 0));
		command("move-right", "arrow-right", canNudge, nudge(1, 0));

		// ---------- view ----------
		command("zoom-in", "zoom-in", () => true, (c) => c.zoomBy(0.5));
		command("zoom-out", "zoom-out", () => true, (c) => c.zoomBy(-0.5));
		command("zoom-reset", "scan", () => true, (c) => c.setViewport(c.x, c.y, 0));
		command("zoom-fit", "maximize", () => true, (c) => c.zoomToFit());
		command("zoom-selection", "focus", hasSelection, (c) => c.zoomToSelection());
		command("toggle-readonly", "lock", () => true, (c) => c.setReadonly(!c.readonly));
	},
});
