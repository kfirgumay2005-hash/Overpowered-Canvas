import { setIcon, setTooltip } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { childrenOf, descendants, directionBetween, type TEdge } from "../mindmap/tree";
import { mutate, nodeType, selectedNodes } from "../shared";

const HIDDEN = "opc-hidden-by-branch";

function edgesOf(canvas: CanvasLike): TEdge[] {
	return [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id }));
}

/**
 * Collapse / expand mind-map branches: a badge on the side of a card's children folds its whole
 * subtree away and shows how many cards are hidden. Stored in x-opc.collapsed on the card.
 */
export const branchCollapseModule = defineModule({
	id: "branch-collapse",
	name: "branchCollapse.name",
	description: "branchCollapse.desc",
	group: "mindmap",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["canvas-mindmap", "cammvas"],

	enable(ctx) {
		const hidden = new WeakMap<CanvasLike, Set<Element>>();

		const toggle = (canvas: CanvasLike, nodes: CanvasNodeLike[], collapsed?: boolean) => {
			const value = collapsed ?? !nodes.every((n) => ctx.data.node(n).get().collapsed);
			mutate(ctx, canvas, () => {
				for (const n of nodes) ctx.data.node(n).set({ collapsed: value });
			});
			refresh(canvas);
			for (const n of nodes) ctx.events.emit(value ? "branch-collapsed" : "branch-expanded", n);
		};

		const refresh = (canvas: CanvasLike) => {
			const edges = edgesOf(canvas);
			const hide = new Set<string>();
			const counts = new Map<CanvasNodeLike, number>();
			for (const node of canvas.nodes.values()) {
				if (nodeType(node) === "group" || !ctx.data.node(node).get().collapsed) continue;
				const desc = descendants(edges, node.id).filter((id) => id !== node.id);
				counts.set(node, desc.length);
				for (const id of desc) hide.add(id);
			}
			const next = new Set<Element>();
			for (const id of hide) {
				const n = canvas.nodes.get(id);
				if (n) next.add(n.nodeEl);
			}
			for (const e of canvas.edges.values()) if (hide.has(e.to.node.id) || hide.has(e.from.node.id)) {
				next.add(e.lineGroupEl);
				next.add(e.lineEndGroupEl);
				if (e.labelElement) next.add(e.labelElement.wrapperEl);
			}
			const prev = hidden.get(canvas) ?? new Set<Element>();
			for (const el of prev) if (!next.has(el)) el.removeClass(HIDDEN);
			for (const el of next) el.addClass(HIDDEN);
			hidden.set(canvas, next);
			for (const id of hide) {
				const n = canvas.nodes.get(id);
				if (n && canvas.selection.has(n)) canvas.deselect(n);
			}
			// Badges: on every card that has children (hidden cards' badges don't matter).
			for (const node of canvas.nodes.values()) {
				const kids = nodeType(node) === "group" ? [] : childrenOf(edges, node.id);
				let badge = node.nodeEl.querySelector<HTMLElement>(":scope > .opc-branch-toggle");
				if (kids.length === 0) {
					badge?.remove();
					continue;
				}
				if (!badge) {
					badge = node.nodeEl.createDiv({ cls: "opc-branch-toggle", attr: { role: "button", tabindex: "0" } });
					const run = (evt: Event) => {
						evt.preventDefault();
						evt.stopPropagation();
						if (!canvas.readonly) toggle(canvas, [node]);
					};
					badge.addEventListener("click", run);
					badge.addEventListener("pointerdown", (e) => e.stopPropagation());
					badge.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && run(e));
				}
				const first = canvas.nodes.get(kids[0]!);
				badge.dataset.side = first ? directionBetween(node, first) : "right";
				const collapsed = counts.has(node);
				badge.toggleClass("is-collapsed", collapsed);
				badge.empty();
				if (collapsed) badge.setText(String(counts.get(node)));
				else setIcon(badge, "minus");
				const label = ctx.t(collapsed ? "branchCollapse.expand" : "branchCollapse.collapse");
				setTooltip(badge, label);
				badge.setAttr("aria-label", label);
				badge.setAttr("aria-expanded", String(!collapsed));
			}
		};

		const timers = new WeakMap<CanvasLike, number>();
		const schedule = (canvas: CanvasLike) => {
			if (timers.get(canvas)) return;
			timers.set(
				canvas,
				window.setTimeout(() => {
					timers.delete(canvas);
					refresh(canvas);
				}, 30),
			);
		};
		ctx.onCanvas((canvas) => {
			schedule(canvas);
			return () => {
				for (const el of hidden.get(canvas) ?? []) el.removeClass(HIDDEN);
				hidden.delete(canvas);
				canvas.nodes.forEach((n) => n.nodeEl.querySelector(":scope > .opc-branch-toggle")?.remove());
			};
		});
		for (const hook of ["node-added", "node-removed", "node-set-data", "node-extra-change"] as const) ctx.on(hook, (n) => schedule(n.canvas));
		for (const hook of ["edge-added", "edge-removed", "edge-set-data"] as const) ctx.on(hook, (e) => schedule(e.canvas));
		ctx.on("data-load", schedule);
		ctx.on("history-apply", schedule);

		const branchNodes = (canvas: CanvasLike) => selectedNodes(canvas).filter((n) => nodeType(n) !== "group" && childrenOf(edgesOf(canvas), n.id).length > 0);
		ctx.addCommand({
			id: "toggle-branch",
			name: ctx.t("branchCollapse.command"),
			icon: "list-collapse",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const nodes = canvas ? branchNodes(canvas) : [];
				if (!canvas || canvas.readonly || nodes.length === 0) return false;
				if (!checking) toggle(canvas, nodes);
				return true;
			},
		});
		ctx.addCommand({
			id: "expand-all",
			name: ctx.t("branchCollapse.expandAll"),
			icon: "list-tree",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const nodes = canvas ? [...canvas.nodes.values()].filter((n) => ctx.data.node(n).get().collapsed && nodeType(n) !== "group") : [];
				if (!canvas || canvas.readonly || nodes.length === 0) return false;
				if (!checking) toggle(canvas, nodes, false);
				return true;
			},
		});
	},
});
