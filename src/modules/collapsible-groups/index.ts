import { setIcon, setTooltip } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasEdgeLike, CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mutate, nodeType, selectedNodes } from "../shared";

const COLLAPSED = "opc-collapsed";
const HIDDEN = "opc-hidden-by-collapse";

/** Nodes fully inside the group's rectangle (the core's notion of group membership). */
export function membersOf(canvas: CanvasLike, group: CanvasNodeLike): CanvasNodeLike[] {
	return canvas.getContainingNodes(group.getBBox()).filter((n) => n !== group);
}

/**
 * Collapsible groups: a toggle on each group's label hides everything inside it (cards and
 * their edges) and folds the group to its title bar. The group keeps its size in the file, so
 * vanilla Obsidian shows it expanded. The collapsed state is stored in x-opc.collapsed.
 */
export const collapsibleGroupsModule = defineModule({
	id: "collapsible-groups",
	name: "collapsibleGroups.name",
	description: "collapsibleGroups.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		/** Which hidden elements each canvas currently has, to undo exactly what we did. */
		const hidden = new WeakMap<CanvasLike, Set<Element>>();

		const refresh = (canvas: CanvasLike) => {
			const prev = hidden.get(canvas) ?? new Set<Element>();
			const next = new Set<Element>();
			const hiddenNodes = new Set<CanvasNodeLike>();
			for (const node of canvas.nodes.values()) {
				if (nodeType(node) !== "group" || !ctx.data.node(node).get().collapsed) continue;
				for (const m of membersOf(canvas, node)) hiddenNodes.add(m);
			}
			for (const n of hiddenNodes) next.add(n.nodeEl);
			for (const e of canvas.edges.values() as IterableIterator<CanvasEdgeLike>) {
				if (hiddenNodes.has(e.from.node) || hiddenNodes.has(e.to.node)) {
					next.add(e.lineGroupEl);
					next.add(e.lineEndGroupEl);
					if (e.labelElement) next.add(e.labelElement.wrapperEl);
				}
			}
			for (const el of prev) if (!next.has(el)) el.removeClass(HIDDEN);
			for (const el of next) el.addClass(HIDDEN);
			hidden.set(canvas, next);
			// A hidden card must not stay selected.
			for (const n of hiddenNodes) if (canvas.selection.has(n)) canvas.deselect(n);
		};

		const setCollapsed = (canvas: CanvasLike, groups: CanvasNodeLike[], collapsed: boolean) => {
			mutate(ctx, canvas, () => {
				for (const g of groups) ctx.data.node(g).set({ collapsed });
			});
			refresh(canvas);
			for (const g of groups) ctx.events.emit(collapsed ? "group-collapsed" : "group-expanded", g);
		};

		ctx.decorateNodes({
			apply: (node, extra) => {
				if (nodeType(node) !== "group") return;
				const collapsed = !!extra.collapsed;
				node.nodeEl.toggleClass(COLLAPSED, collapsed);
				let toggle = node.nodeEl.querySelector<HTMLElement>(":scope > .opc-collapse-toggle");
				if (!toggle) {
					toggle = node.nodeEl.createDiv({ cls: "opc-collapse-toggle clickable-icon", attr: { role: "button", tabindex: "0" } });
					const run = (evt: Event) => {
						evt.stopPropagation();
						evt.preventDefault();
						if (node.canvas.readonly) return;
						setCollapsed(node.canvas, [node], !ctx.data.node(node).get().collapsed);
					};
					toggle.addEventListener("click", run);
					toggle.addEventListener("pointerdown", (e) => e.stopPropagation());
					toggle.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && run(e));
				}
				setIcon(toggle, collapsed ? "chevron-right" : "chevron-down");
				setTooltip(toggle, ctx.t(collapsed ? "collapsibleGroups.expand" : "collapsibleGroups.collapse"));
				toggle.setAttr("aria-expanded", String(!collapsed));
				toggle.setAttr("aria-label", ctx.t(collapsed ? "collapsibleGroups.expand" : "collapsibleGroups.collapse"));
			},
			clear: (node) => {
				node.nodeEl.removeClass(COLLAPSED);
				node.nodeEl.querySelector(":scope > .opc-collapse-toggle")?.remove();
			},
		});

		// Membership changes whenever something moves, is added, removed or the file reloads.
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
			};
		});
		for (const hook of ["node-moved", "node-added", "node-removed", "node-set-data", "node-extra-change"] as const) ctx.on(hook, (node) => schedule(node.canvas));
		ctx.on("edge-added", (edge) => schedule(edge.canvas));
		ctx.on("data-load", schedule);
		ctx.on("history-apply", schedule);

		const groupsInSelection = (canvas: CanvasLike) => selectedNodes(canvas).filter((n) => nodeType(n) === "group");
		ctx.addCommand({
			id: "toggle-collapse-group",
			name: ctx.t("collapsibleGroups.command"),
			icon: "fold-vertical",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const groups = canvas ? groupsInSelection(canvas) : [];
				if (!canvas || canvas.readonly || groups.length === 0) return false;
				if (!checking) setCollapsed(canvas, groups, !groups.every((g) => ctx.data.node(g).get().collapsed));
				return true;
			},
		});
		ctx.onNodeMenu((menu, node) => {
			if (nodeType(node) !== "group" || node.canvas.readonly) return;
			const collapsed = !!ctx.data.node(node).get().collapsed;
			menu.addItem((item) =>
				item
					.setSection("canvas")
					.setTitle(ctx.t(collapsed ? "collapsibleGroups.expand" : "collapsibleGroups.collapse"))
					.setIcon(collapsed ? "unfold-vertical" : "fold-vertical")
					.onClick(() => setCollapsed(node.canvas, [node], !collapsed)),
			);
		});
	},
});
