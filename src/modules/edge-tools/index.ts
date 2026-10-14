import { Setting, type Menu } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasEdgeLike, CanvasItemLike, CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mutate, onlyEdges, selectedEdges, selectedNodes } from "../shared";

interface EdgeToolsSettings {
	highlightConnected: boolean;
}

const HIGHLIGHT = "is-opc-highlighted";

/** Reverses an edge's direction (the arrowheads stay at the same ends of the new direction). */
export function flipEdge(edge: CanvasEdgeLike, extra: { arrows?: { from?: string; to?: string }; floating?: { from?: boolean; to?: boolean } }) {
	const { from, to } = edge;
	edge.update({ node: to.node, side: to.side, end: from.end }, { node: from.node, side: from.side, end: to.end });
	return {
		floating: extra.floating ? { from: extra.floating.to, to: extra.floating.from } : undefined,
	};
}

type Direction = "all" | "incoming" | "outgoing";

function connectedEdges(canvas: CanvasLike, nodes: CanvasNodeLike[], direction: Direction): CanvasEdgeLike[] {
	const set = new Set<CanvasEdgeLike>();
	for (const node of nodes) for (const edge of canvas.getEdgesForNode(node)) {
		if (direction === "incoming" && edge.to.node !== node) continue;
		if (direction === "outgoing" && edge.from.node !== node) continue;
		set.add(edge);
	}
	return [...set];
}

/** Flip edges, highlight edges of selected cards, select connected / incoming / outgoing edges. */
export const edgeToolsModule = defineModule<EdgeToolsSettings>({
	id: "edge-tools",
	name: "edgeTools.name",
	description: "edgeTools.desc",
	group: "edges",
	defaultEnabled: true,
	defaultSettings: { highlightConnected: true },
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		// ---- highlight ----
		const highlighted = new WeakMap<CanvasLike, Set<CanvasEdgeLike>>();
		const refresh = (canvas: CanvasLike) => {
			const prev = highlighted.get(canvas) ?? new Set();
			const next = new Set(ctx.settings.highlightConnected ? connectedEdges(canvas, selectedNodes(canvas), "all") : []);
			for (const e of prev) if (!next.has(e)) {
				e.lineGroupEl.removeClass(HIGHLIGHT);
				e.lineEndGroupEl.removeClass(HIGHLIGHT);
			}
			for (const e of next) {
				e.lineGroupEl.addClass(HIGHLIGHT);
				e.lineEndGroupEl.addClass(HIGHLIGHT);
			}
			highlighted.set(canvas, next);
		};
		ctx.on("selection-change", refresh);
		ctx.on("edge-added", (edge) => refresh(edge.canvas));
		ctx.onSettingsChange(() => ctx.canvases().forEach(refresh));
		ctx.register(() => {
			for (const canvas of ctx.canvases()) for (const e of highlighted.get(canvas) ?? []) {
				e.lineGroupEl.removeClass(HIGHLIGHT);
				e.lineEndGroupEl.removeClass(HIGHLIGHT);
			}
		});

		// Keeps the edge-index repair in CanvasHooks active: undoing a flip re-attaches ends via setData.
		ctx.on("edge-set-data", () => {});

		// ---- flip ----
		const flip = (canvas: CanvasLike, edges: CanvasEdgeLike[]) =>
			mutate(ctx, canvas, () => {
				for (const edge of edges) {
					const extra = ctx.data.edge(edge).get();
					const result = flipEdge(edge, extra);
					if (extra.floating) ctx.data.edge(edge).set({ floating: result.floating });
					canvas.markDirty(edge);
				}
			});
		ctx.addMenuButton({
			id: "edge-flip",
			icon: "arrow-left-right",
			tooltip: () => ctx.t("edgeTools.flip"),
			order: 23,
			isVisible: (selection) => !!onlyEdges(selection),
			onClick: ({ canvas, selection }) => flip(canvas, onlyEdges(selection) ?? []),
		});
		ctx.onEdgeMenu((menu, edge) => {
			if (!edge.canvas.readonly) menu.addItem((item) => item.setSection("canvas").setTitle(ctx.t("edgeTools.flip")).setIcon("arrow-left-right").onClick(() => flip(edge.canvas, [edge])));
		});
		ctx.addCommand({
			id: "flip-edges",
			name: ctx.t("edgeTools.flip"),
			icon: "arrow-left-right",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const edges = canvas ? selectedEdges(canvas) : [];
				if (!canvas || canvas.readonly || edges.length === 0) return false;
				if (!checking) flip(canvas, edges);
				return true;
			},
		});

		// ---- select connected ----
		const select = (canvas: CanvasLike, direction: Direction) => {
			const edges = connectedEdges(canvas, selectedNodes(canvas), direction);
			if (edges.length) canvas.selectAll(new Set<CanvasItemLike>(edges));
		};
		const SELECTS: { dir: Direction; key: "edgeTools.selectConnected" | "edgeTools.selectIncoming" | "edgeTools.selectOutgoing"; icon: string }[] = [
			{ dir: "all", key: "edgeTools.selectConnected", icon: "git-fork" },
			{ dir: "incoming", key: "edgeTools.selectIncoming", icon: "arrow-down-to-dot" },
			{ dir: "outgoing", key: "edgeTools.selectOutgoing", icon: "arrow-up-from-dot" },
		];
		for (const { dir, key, icon } of SELECTS) {
			ctx.addCommand({
				id: `select-${dir === "all" ? "connected" : dir}-edges`,
				name: ctx.t(key),
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || selectedNodes(canvas).length === 0) return false;
					if (!checking) select(canvas, dir);
					return true;
				},
			});
		}
		const addSelectItems = (menu: Menu, canvas: CanvasLike) => {
			if (connectedEdges(canvas, selectedNodes(canvas), "all").length === 0) return;
			for (const { dir, key, icon } of SELECTS) menu.addItem((item) => item.setSection("selection").setTitle(ctx.t(key)).setIcon(icon).onClick(() => select(canvas, dir)));
		};
		ctx.onNodeMenu((menu, node) => addSelectItems(menu, node.canvas));
		ctx.onSelectionMenu((menu, canvas) => addSelectItems(menu, canvas));
	},

	renderSettings(el, ctx) {
		new Setting(el)
			.setName(ctx.t("edgeTools.highlight.name"))
			.setDesc(ctx.t("edgeTools.highlight.desc"))
			.addToggle((t) => t.setValue(ctx.settings.highlightConnected).onChange((v) => ctx.updateSettings({ highlightConnected: v })));
	},
});
