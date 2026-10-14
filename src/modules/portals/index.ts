import { TFile, debounce } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasFileData } from "../../data/json-canvas";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mutate, nodeType, onlyNodes } from "../shared";
import { buildGhosts, ghostId, parseGhostId, stripGhosts } from "./logic";

const PADDING = 40;
const HEADER = 36;

interface OpenPortal {
	portal: CanvasNodeLike;
	ghosts: Set<string>;
	pos: { x: number; y: number };
}

const isCanvasFileNode = (n: CanvasNodeLike) => nodeType(n) === "file" && n.file instanceof TFile && n.file.extension === "canvas";

/**
 * Portals: a card that links to another canvas can be opened to show that canvas's cards
 * inline (read-only). You can draw edges from this canvas to cards inside the portal; they are
 * saved as edges to the portal card with x-opc.portalTarget, so vanilla Obsidian shows them
 * attached to the card. Portal contents are never written into this file.
 */
export const portalsModule = defineModule({
	id: "portals",
	name: "portals.name",
	description: "portals.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const open = new Map<CanvasLike, Map<string, OpenPortal>>();
		const ghostSet = (canvas: CanvasLike) => {
			const ids = new Set<string>();
			for (const p of open.get(canvas)?.values() ?? []) for (const id of p.ghosts) ids.add(id);
			return ids;
		};
		const isGhost = (node: CanvasNodeLike) => !!parseGhostId(node.id) && ghostSet(node.canvas).has(node.id);

		// Ghosts never reach the file, history or clipboard data.
		ctx.transformData((data, canvas) => {
			const ids = ghostSet(canvas);
			return ids.size ? stripGhosts(data, (id) => ids.has(id)) : data;
		});

		// Ghosts are read-only: no moving (except with their portal), no editing.
		let movingPortal = false;
		ctx.intercept("node-move", (node) => (!movingPortal && isGhost(node) ? true : undefined));
		ctx.intercept("node-start-editing", (node) => (isGhost(node) ? true : undefined));

		const closePortal = (canvas: CanvasLike, id: string) => {
			const state = open.get(canvas)?.get(id);
			if (!state) return;
			// Re-attach our edges that point into the portal to the portal card before removing ghosts.
			for (const edge of [...canvas.edges.values()]) {
				const fromGhost = state.ghosts.has(edge.from.node.id);
				const toGhost = state.ghosts.has(edge.to.node.id);
				if (fromGhost && toGhost) continue;
				if (fromGhost) edge.update({ ...edge.from, node: state.portal }, edge.to);
				else if (toGhost) edge.update(edge.from, { ...edge.to, node: state.portal });
			}
			for (const gid of state.ghosts) {
				const g = canvas.nodes.get(gid);
				if (g) canvas.removeNode(g);
			}
			open.get(canvas)?.delete(id);
			state.portal.nodeEl.removeClass("opc-portal-open");
			state.portal.nodeEl.style.removeProperty("--opc-portal-header");
			state.portal.containerEl?.removeAttribute("data-portal-title");
			canvas.requestFrame();
		};

		const openPortal = async (canvas: CanvasLike, portal: CanvasNodeLike) => {
			const file = portal.file;
			if (!(file instanceof TFile) || file === canvas.view.file) return;
			let target: CanvasFileData;
			try {
				target = JSON.parse(await ctx.app.vault.cachedRead(file)) as CanvasFileData;
			} catch {
				return;
			}
			if (!canvas.nodes.has(portal.id)) return;
			closePortal(canvas, portal.id);
			const built = buildGhosts(portal, target, PADDING, HEADER);
			// Size the portal around its content; not a user action, so no undo step.
			if (portal.width !== built.width || portal.height !== built.height) portal.resize({ width: built.width, height: built.height });
			canvas.importData({ nodes: built.nodes, edges: built.edges }, false);
			const state: OpenPortal = { portal, ghosts: new Set(built.nodes.map((n) => n.id)), pos: { x: portal.x, y: portal.y } };
			let map = open.get(canvas);
			if (!map) open.set(canvas, (map = new Map()));
			map.set(portal.id, state);
			for (const gid of state.ghosts) canvas.nodes.get(gid)?.nodeEl.addClass("opc-portal-ghost");
			portal.nodeEl.addClass("opc-portal-open");
			portal.nodeEl.style.setProperty("--opc-portal-header", `${HEADER}px`);
			portal.containerEl?.setAttribute("data-portal-title", file.basename);
			// Edges saved against the portal card with a portal target go back to their ghost.
			for (const edge of canvas.edges.values()) {
				const target = ctx.data.edge(edge).get().portalTarget;
				if (!target) continue;
				const end = target.end === "from" ? edge.from : edge.to;
				if (end.node !== portal) continue;
				const ghost = canvas.nodes.get(ghostId(portal.id, target.nodeId));
				if (!ghost) continue;
				if (target.end === "from") edge.update({ ...edge.from, node: ghost }, edge.to);
				else edge.update(edge.from, { ...edge.to, node: ghost });
			}
			canvas.requestFrame();
			ctx.events.emit("portal-opened", canvas, portal);
		};

		/** Opens every portal marked open and closes the rest. */
		const sync = (canvas: CanvasLike) => {
			const wanted = new Set<string>();
			for (const node of canvas.nodes.values()) {
				if (parseGhostId(node.id)) continue;
				if (isCanvasFileNode(node) && ctx.data.node(node).get().portal?.open) wanted.add(node.id);
			}
			for (const id of [...(open.get(canvas)?.keys() ?? [])]) if (!wanted.has(id)) closePortal(canvas, id);
			for (const id of wanted) {
				const portal = canvas.nodes.get(id);
				const state = open.get(canvas)?.get(id);
				// After undo/redo the ghosts were removed by the core's importData(clear=true).
				const intact = state && [...state.ghosts].every((g) => canvas.nodes.has(g));
				if (portal && !intact) {
					if (state) open.get(canvas)?.delete(id);
					void openPortal(canvas, portal);
				}
			}
		};
		const syncSoon = new WeakMap<CanvasLike, () => void>();
		const schedule = (canvas: CanvasLike) => {
			let fn = syncSoon.get(canvas);
			if (!fn) syncSoon.set(canvas, (fn = debounce(() => sync(canvas), 50, true)));
			fn();
		};

		ctx.onCanvas((canvas) => {
			schedule(canvas);
			return () => {
				for (const id of [...(open.get(canvas)?.keys() ?? [])]) closePortal(canvas, id);
				open.delete(canvas);
			};
		});
		ctx.on("data-load", schedule);
		ctx.on("history-apply", schedule);
		ctx.on("node-extra-change", (node) => isCanvasFileNode(node) && schedule(node.canvas));

		// The portal carries its contents along when it moves.
		ctx.on("node-moved", (node) => {
			const state = open.get(node.canvas)?.get(node.id);
			if (!state) return;
			const dx = node.x - state.pos.x;
			const dy = node.y - state.pos.y;
			if (!dx && !dy) return;
			state.pos = { x: node.x, y: node.y };
			movingPortal = true;
			try {
				for (const gid of state.ghosts) {
					const g = node.canvas.nodes.get(gid);
					if (g) g.moveTo({ x: g.x + dx, y: g.y + dy });
				}
			} finally {
				movingPortal = false;
			}
		});
		ctx.on("node-removed", (node) => {
			if (open.get(node.canvas)?.has(node.id)) closePortal(node.canvas, node.id);
		});

		// Refresh open portals when their canvas changes on disk.
		ctx.registerEvent(
			ctx.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile) || file.extension !== "canvas") return;
				for (const [canvas, map] of open) for (const state of map.values()) if (state.portal.file === file) {
					map.delete(state.portal.id);
					void openPortal(canvas, state.portal);
				}
			}),
		);

		ctx.register(() => {
			for (const [canvas, map] of open) for (const id of [...map.keys()]) closePortal(canvas, id);
			open.clear();
		});

		const toggle = (canvas: CanvasLike, nodes: CanvasNodeLike[]) => {
			const openNow = !nodes.every((n) => ctx.data.node(n).get().portal?.open);
			mutate(ctx, canvas, () => {
				for (const n of nodes) ctx.data.node(n).set({ portal: openNow ? { open: true } : undefined });
			});
			if (!openNow) for (const n of nodes) {
				closePortal(canvas, n.id);
				ctx.events.emit("portal-closed", canvas, n);
			}
			schedule(canvas);
			canvas.menu.render(true);
		};
		const portalNodes = (selection: Parameters<typeof onlyNodes>[0]) => {
			const nodes = onlyNodes(selection);
			return nodes && nodes.every((n) => isCanvasFileNode(n) && !parseGhostId(n.id)) ? nodes : null;
		};
		ctx.addMenuButton({
			id: "portal",
			icon: "door-open",
			tooltip: () => ctx.t("portals.toggle"),
			order: 30,
			isVisible: (selection) => !!portalNodes(selection),
			isActive: (selection) => (portalNodes(selection) ?? []).every((n) => ctx.data.node(n).get().portal?.open),
			onClick: ({ canvas, selection }) => toggle(canvas, portalNodes(selection) ?? []),
		});
		ctx.addCommand({
			id: "toggle-portal",
			name: ctx.t("portals.toggle"),
			icon: "door-open",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const nodes = canvas ? portalNodes([...canvas.selection]) : null;
				if (!canvas || canvas.readonly || !nodes) return false;
				if (!checking) toggle(canvas, nodes);
				return true;
			},
		});
	},
});

