import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { EdgeSide } from "../../data/json-canvas";
import type { CanvasItemLike, CanvasLike, CanvasNodeLike } from "../../internals/types";
import { canvasDirection, mutate, nodeType, randomId, selectedNodes } from "../shared";
import { childPosition, childrenOf, descendants, directionBetween, logical, neighbor, parentOf, type Dir, type TEdge } from "./tree";

interface MindmapSettings {
	siblingKey: "Enter" | "Shift+Enter";
	direction: "right" | "down";
	mirrorRtl: boolean;
}

const SIDE: Record<Dir, EdgeSide> = { right: "right", left: "left", down: "bottom", up: "top" };
const OPPOSITE: Record<Dir, EdgeSide> = { right: "left", left: "right", down: "top", up: "bottom" };
const ARROW: Record<string, Dir> = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" };

function edgesOf(canvas: CanvasLike): TEdge[] {
	return [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id }));
}

function visible(n: CanvasNodeLike): boolean {
	return !n.nodeEl.hasClass("opc-hidden-by-collapse") && !n.nodeEl.hasClass("opc-hidden-by-branch");
}

/**
 * Mind-map editing (Canvas MindMap parity): Tab adds a child, Enter a sibling, Alt+Arrows move
 * between cards, Ctrl/Cmd+Arrows add a floating card and Ctrl/Cmd+Shift+Arrows a child in that
 * direction. Right and left are mirrored in right-to-left canvases (setting).
 */
export const mindmapModule = defineModule<MindmapSettings>({
	id: "mindmap",
	name: "mindmap.name",
	description: "mindmap.desc",
	group: "mindmap",
	defaultEnabled: true,
	defaultSettings: { siblingKey: "Enter", direction: "right", mirrorRtl: true },
	overlapsWith: ["canvas-mindmap"],

	enable(ctx) {
		const dirFor = (canvas: CanvasLike, dir: Dir) => (ctx.settings.mirrorRtl ? logical(dir, canvasDirection(canvas) === "rtl") : dir);
		const single = (canvas: CanvasLike) => {
			const nodes = selectedNodes(canvas);
			return nodes.length === 1 && canvas.selection.size === 1 ? nodes[0]! : null;
		};

		const startEditing = (canvas: CanvasLike, node: CanvasNodeLike) => {
			canvas.selectOnly(node);
			node.attach();
			node.render();
			// Let the selection render before opening the editor.
			window.setTimeout(() => node.startEditing(), 20);
		};

		const create = (canvas: CanvasLike, pos: { x: number; y: number }, link: { from: CanvasNodeLike; dir: Dir } | null): CanvasNodeLike | null => {
			let created: CanvasNodeLike | null = null;
			mutate(ctx, canvas, () => {
				const size = canvas.config.defaultTextNodeDimensions;
				created = canvas.createTextNode({ pos, size, save: false, focus: false });
				if (link) {
					const color = link.from.color;
					canvas.importData({ nodes: [], edges: [{ id: randomId(), fromNode: link.from.id, fromSide: SIDE[link.dir], toNode: created.id, toSide: OPPOSITE[link.dir], ...(color ? { color } : {}) }] }, false);
				}
			});
			if (created) startEditing(canvas, created);
			return created;
		};

		const addChild = (canvas: CanvasLike, parent: CanvasNodeLike, physicalDir?: Dir) => {
			const dir = physicalDir ?? dirFor(canvas, ctx.settings.direction);
			const kids = childrenOf(edgesOf(canvas), parent.id).map((id) => canvas.nodes.get(id)).filter((n): n is CanvasNodeLike => !!n);
			return create(canvas, childPosition(parent, kids, canvas.config.defaultTextNodeDimensions, dir), { from: parent, dir });
		};

		const addSibling = (canvas: CanvasLike, node: CanvasNodeLike) => {
			const parentId = parentOf(edgesOf(canvas), node.id);
			const parent = parentId ? canvas.nodes.get(parentId) : null;
			if (parent) return addChild(canvas, parent, directionBetween(parent, node));
			const gap = 30;
			return create(canvas, { x: node.x, y: node.y + node.height + gap }, null);
		};

		const addFloating = (canvas: CanvasLike, node: CanvasNodeLike, dir: Dir) => {
			const size = canvas.config.defaultTextNodeDimensions;
			const gap = 80;
			const pos = dir === "right" ? { x: node.x + node.width + gap, y: node.y } : dir === "left" ? { x: node.x - gap - size.width, y: node.y } : dir === "down" ? { x: node.x, y: node.y + node.height + gap } : { x: node.x, y: node.y - gap - size.height };
			return create(canvas, pos, null);
		};

		const navigate = (canvas: CanvasLike, node: CanvasNodeLike, dir: Dir) => {
			const others = [...canvas.nodes.values()].filter((n) => n !== node && visible(n) && nodeType(n) !== "group");
			const id = neighbor(node, others, dir);
			const next = id ? canvas.nodes.get(id) : null;
			if (!next) return;
			canvas.selectOnly(next);
			canvas.panIntoView(next.getBBox());
		};

		const selectSubtree = (canvas: CanvasLike, node: CanvasNodeLike) => {
			const ids = [node.id, ...descendants(edgesOf(canvas), node.id)];
			const items = new Set<CanvasItemLike>(ids.map((id) => canvas.nodes.get(id)).filter((n): n is CanvasNodeLike => !!n));
			for (const e of canvas.edges.values()) if (items.has(e.from.node) && items.has(e.to.node)) items.add(e);
			canvas.selectAll(items);
		};

		const colorEdges = (canvas: CanvasLike, nodes: CanvasNodeLike[]) =>
			mutate(ctx, canvas, () => {
				for (const node of nodes) for (const e of canvas.getEdgesForNode(node)) if (e.from.node === node) e.setColor(node.color);
			});

		// Canvas-local keys (shared keymap: sticky notes take Tab / Ctrl+Arrows on stickies first).
		const key = (modifiers: ("Mod" | "Shift" | "Alt")[], k: string, fn: (canvas: CanvasLike, node: CanvasNodeLike) => void) =>
			ctx.addCanvasKey({
				modifiers,
				key: k,
				handle: (canvas) => {
					const node = single(canvas);
					if (!node || canvas.readonly) return false;
					fn(canvas, node);
					return true;
				},
			});
		key([], "Tab", (c, n) => addChild(c, n));
		key([], "Enter", (c, n) => ctx.settings.siblingKey === "Enter" && addSibling(c, n));
		key(["Shift"], "Enter", (c, n) => ctx.settings.siblingKey === "Shift+Enter" && addSibling(c, n));
		for (const [k, dir] of Object.entries(ARROW)) {
			key(["Alt"], k, (c, n) => navigate(c, n, dir));
			key(["Mod"], k, (c, n) => addFloating(c, n, dir));
			key(["Mod", "Shift"], k, (c, n) => addChild(c, n, dir));
		}

		const command = (id: string, name: string, icon: string, fn: (c: CanvasLike, n: CanvasNodeLike) => void, needsWrite = true) =>
			ctx.addCommand({
				id,
				name,
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					const node = canvas ? single(canvas) : null;
					if (!canvas || !node || (needsWrite && canvas.readonly)) return false;
					if (!checking) fn(canvas, node);
					return true;
				},
			});
		command("add-child", ctx.t("mindmap.addChild"), "git-branch-plus", (c, n) => addChild(c, n));
		command("add-sibling", ctx.t("mindmap.addSibling"), "list-plus", addSibling);
		command("add-floating", ctx.t("mindmap.addFloating"), "square-plus", (c, n) => addFloating(c, n, dirFor(c, "right")));
		command("select-subtree", ctx.t("mindmap.selectSubtree"), "network", selectSubtree, false);
		command("color-edges", ctx.t("mindmap.colorEdges"), "palette", (c, n) => colorEdges(c, [n]));
		command("edit", ctx.t("mindmap.edit"), "pencil", (c, n) => startEditing(c, n));
		ctx.addCommand({
			id: "stop-editing",
			name: ctx.t("mindmap.stopEditing"),
			icon: "check",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const node = canvas ? [...canvas.nodes.values()].find((n) => n.isEditing) : undefined;
				if (!canvas || !node) return false;
				if (!checking) {
					node.blur();
					canvas.selectOnly(node);
					canvas.wrapperEl.focus();
				}
				return true;
			},
		});

		ctx.onNodeMenu((menu, node) => {
			const canvas = node.canvas;
			if (childrenOf(edgesOf(canvas), node.id).length === 0) return;
			menu.addItem((item) => item.setSection("selection").setTitle(ctx.t("mindmap.selectSubtree")).setIcon("network").onClick(() => selectSubtree(canvas, node)));
			if (!canvas.readonly) menu.addItem((item) => item.setSection("canvas").setTitle(ctx.t("mindmap.colorEdges")).setIcon("palette").onClick(() => colorEdges(canvas, [node])));
		});
	},

	renderSettings(el, ctx: ModuleContext<MindmapSettings>) {
		new Setting(el)
			.setName(ctx.t("mindmap.siblingKey.name"))
			.setDesc(ctx.t("mindmap.siblingKey.desc"))
			.addDropdown((d) => d.addOptions({ Enter: "Enter", "Shift+Enter": "Shift+Enter" }).setValue(ctx.settings.siblingKey).onChange((v) => ctx.updateSettings({ siblingKey: v as MindmapSettings["siblingKey"] })));
		new Setting(el)
			.setName(ctx.t("mindmap.direction.name"))
			.addDropdown((d) =>
				d
					.addOptions({ right: ctx.t("mindmap.direction.forward"), down: ctx.t("mindmap.direction.down") })
					.setValue(ctx.settings.direction)
					.onChange((v) => ctx.updateSettings({ direction: v as MindmapSettings["direction"] })),
			);
		new Setting(el)
			.setName(ctx.t("mindmap.mirror.name"))
			.setDesc(ctx.t("mindmap.mirror.desc"))
			.addToggle((t) => t.setValue(ctx.settings.mirrorRtl).onChange((v) => ctx.updateSettings({ mirrorRtl: v })));
	},
});
