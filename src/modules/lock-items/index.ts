import { setIcon } from "obsidian";
import { defineModule } from "../../core/module";
import { SCHEMA_KEY } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mutate, onlyNodes, selectedNodes } from "../shared";

function badge(node: CanvasNodeLike, locked: boolean, label: string): void {
	const el = node.nodeEl;
	let b = el.querySelector<HTMLElement>(":scope > .opc-lock-badge");
	if (!locked) {
		b?.remove();
		el.removeAttribute("data-opc-locked");
		return;
	}
	el.setAttribute("data-opc-locked", "");
	if (!b) {
		b = el.createDiv({ cls: "opc-lock-badge", attr: { "aria-label": label } });
		setIcon(b, "lock");
	}
}

/**
 * Lock cards in place: locked cards can't be moved, resized or edited (they can still be
 * selected, linked and copied). Toggle from the selection toolbar, the context menu or a command.
 */
export const lockItemsModule = defineModule({
	id: "lock-items",
	name: "lockItems.name",
	description: "lockItems.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		// Read straight from the data: nodes off screen may not be decorated yet.
		const isLocked = (node: CanvasNodeLike) => (node.unknownData[SCHEMA_KEY] as { locked?: unknown } | undefined)?.locked === true;
		ctx.decorateNodes({
			apply: (node, extra) => badge(node, !!extra.locked, ctx.t("lockItems.locked")),
			clear: (node) => badge(node, false, ""),
		});
		ctx.intercept("node-pointerdown", (node) => (isLocked(node) ? true : undefined));
		ctx.intercept("node-move", (node) => (isLocked(node) ? true : undefined));
		ctx.intercept("node-start-editing", (node) => (isLocked(node) ? true : undefined));

		const toggle = (canvas: CanvasLike, nodes: CanvasNodeLike[]) => {
			const lock = !nodes.every(isLocked);
			mutate(ctx, canvas, () => {
				for (const n of nodes) ctx.data.node(n).set({ locked: lock || undefined });
			});
			canvas.menu.render?.(true);
		};

		ctx.addMenuButton({
			id: "lock",
			icon: (selection) => ((onlyNodes(selection) ?? []).every(isLocked) ? "lock" : "lock-open"),
			tooltip: () => ctx.t("lockItems.toggle"),
			order: 90,
			isVisible: (selection) => !!onlyNodes(selection),
			isActive: (selection) => (onlyNodes(selection) ?? []).every(isLocked),
			onClick: ({ canvas, selection }) => toggle(canvas, onlyNodes(selection) ?? []),
		});
		ctx.onNodeMenu((menu, node) => {
			if (node.canvas.readonly) return;
			const nodes = node.canvas.selection.has(node) ? selectedNodes(node.canvas) : [node];
			menu.addItem((item) =>
				item
					.setTitle(nodes.every(isLocked) ? ctx.t("lockItems.unlock") : ctx.t("lockItems.lock"))
					.setIcon(nodes.every(isLocked) ? "lock-open" : "lock")
					.onClick(() => toggle(node.canvas, nodes)),
			);
		});
		ctx.addCommand({
			id: "toggle-lock",
			name: ctx.t("lockItems.toggle"),
			icon: "lock",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const nodes = canvas ? selectedNodes(canvas) : [];
				if (!canvas || canvas.readonly || nodes.length === 0) return false;
				if (!checking) toggle(canvas, nodes);
				return true;
			},
		});
	},
});
