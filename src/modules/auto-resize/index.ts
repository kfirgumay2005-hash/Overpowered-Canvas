import { defineModule } from "../../core/module";
import type { CanvasNodeLike } from "../../internals/types";
import { mutate, nodeType, onlyNodes } from "../shared";

interface Watch {
	observer: ResizeObserver;
	onInput: () => void;
	frame: number;
}

/**
 * Measures how tall the node must be to show all of its text, in reading or editing mode.
 * Returns the new node height, or null when it cannot be measured right now.
 */
function neededHeight(node: CanvasNodeLike): number | null {
	const content = node.contentEl;
	if (!content || !content.isConnected) return null;
	if (node.isEditing) {
		const scroller = content.querySelector<HTMLElement>(".cm-scroller");
		const cm = content.querySelector<HTMLElement>(".cm-content");
		if (!scroller || !cm) return null;
		const style = getComputedStyle(scroller);
		const inner = cm.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
		return node.height + (inner - scroller.clientHeight);
	}
	const preview = content.querySelector<HTMLElement>(".markdown-embed-content > .markdown-preview-view");
	if (!preview || !preview.isShown()) return null;
	const available = preview.clientHeight;
	preview.style.height = "1px";
	const needed = preview.scrollHeight;
	preview.style.height = "";
	return node.height + (needed - available) + 1;
}

/** Per-node toggle: the card grows and shrinks to fit its text. */
export const autoResizeModule = defineModule({
	id: "auto-resize",
	name: "autoResize.name",
	description: "autoResize.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const watches = new Map<CanvasNodeLike, Watch>();

		const fit = (node: CanvasNodeLike) => {
			const target = neededHeight(node);
			if (target === null) return;
			const height = Math.max(node.canvas.config.minContainerDimension, Math.round(target));
			if (Math.abs(height - node.height) <= 1) return;
			node.resize({ width: node.width, height });
			node.render();
			// An automatic fit is not a user action: fold it into the current undo step.
			node.canvas.overrideHistory();
		};

		const schedule = (node: CanvasNodeLike) => {
			const w = watches.get(node);
			if (!w || w.frame) return;
			w.frame = requestAnimationFrame(() => {
				w.frame = 0;
				observeTargets(node, w);
				fit(node);
			});
		};

		const observeTargets = (node: CanvasNodeLike, w: Watch) => {
			for (const el of node.contentEl?.querySelectorAll<HTMLElement>(".markdown-preview-sizer, .cm-content") ?? []) w.observer.observe(el);
		};

		const watch = (node: CanvasNodeLike) => {
			if (watches.has(node)) return schedule(node);
			const w: Watch = { observer: new ResizeObserver(() => schedule(node)), onInput: () => schedule(node), frame: 0 };
			watches.set(node, w);
			node.nodeEl.addEventListener("input", w.onInput, true);
			observeTargets(node, w);
			schedule(node);
		};

		const unwatch = (node: CanvasNodeLike) => {
			const w = watches.get(node);
			if (!w) return;
			w.observer.disconnect();
			if (w.frame) cancelAnimationFrame(w.frame);
			node.nodeEl.removeEventListener("input", w.onInput, true);
			watches.delete(node);
		};

		ctx.decorateNodes({
			apply: (node, extra) => {
				const on = !!extra.autoResize && (nodeType(node) === "text" || nodeType(node) === "file");
				node.nodeEl.toggleAttribute("data-opc-auto-resize", on);
				if (on) watch(node);
				else unwatch(node);
			},
			clear: (node) => {
				node.nodeEl.removeAttribute("data-opc-auto-resize");
				unwatch(node);
			},
		});
		ctx.on("node-removed", unwatch);
		ctx.register(() => {
			for (const node of [...watches.keys()]) unwatch(node);
		});

		const eligible = (selection: Parameters<typeof onlyNodes>[0]) => {
			const nodes = onlyNodes(selection);
			return nodes && nodes.every((n) => nodeType(n) === "text" || nodeType(n) === "file") ? nodes : null;
		};

		ctx.addMenuButton({
			id: "auto-resize",
			icon: "fold-vertical",
			tooltip: () => ctx.t("autoResize.button"),
			order: 13,
			isVisible: (selection) => !!eligible(selection),
			isActive: (selection) => (eligible(selection) ?? []).every((n) => ctx.data.node(n).get().autoResize === true),
			onClick: ({ canvas, selection }) => {
				const nodes = eligible(selection) ?? [];
				const turnOn = !nodes.every((n) => ctx.data.node(n).get().autoResize === true);
				mutate(ctx, canvas, () => {
					for (const node of nodes) ctx.data.node(node).set({ autoResize: turnOn });
				});
				canvas.menu.render(true);
			},
		});
	},
});
