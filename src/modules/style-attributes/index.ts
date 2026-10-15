import { normalizePath, parseYaml } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasEdgeLike, CanvasItemLike, CanvasNodeLike } from "../../internals/types";
import { showPicker } from "../../ui/picker";
import { common, mutate, onlyEdges, onlyNodes } from "../shared";
import { parseStyleAttributes, type StyleAttribute } from "./logic";

interface CustomCss {
	enabledSnippets?: Set<string>;
	snippets?: string[];
}

/**
 * Style attributes declared in CSS snippets (@opc-node-style / @opc-edge-style comment blocks)
 * appear as toolbar buttons; the chosen value is stored in x-opc.styles and exposed as
 * data-<key> on the element so the snippet can style it.
 */
export const styleAttributesModule = defineModule({
	id: "style-attributes",
	name: "styleAttributes.name",
	description: "styleAttributes.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		let attrs: StyleAttribute[] = [];
		const buttons: (() => void)[] = [];

		const load = async () => {
			const css = (ctx.app as unknown as { customCss?: CustomCss }).customCss;
			const names = [...(css?.enabledSnippets ?? [])];
			const dir = `${ctx.app.vault.configDir}/snippets`;
			const files: string[] = [];
			for (const name of names) {
				try {
					files.push(await ctx.app.vault.adapter.read(normalizePath(`${dir}/${name}.css`)));
				} catch {
					// snippet file missing
				}
			}
			attrs = parseStyleAttributes(files, (y) => parseYaml(y));
			rebuild();
			for (const canvas of ctx.canvases()) {
				canvas.nodes.forEach((n) => applyNode(n));
				canvas.edges.forEach((e) => applyEdge(e));
			}
		};

		const setAttrs = (el: Element, target: "node" | "edge", styles: Record<string, string> | undefined) => {
			for (const a of attrs) {
				if (a.target !== target) continue;
				const value = styles?.[a.key];
				if (value && a.options.some((o) => o.value === value)) el.setAttribute(`data-${a.key}`, value);
				else el.removeAttribute(`data-${a.key}`);
			}
		};
		const clearAll = (el: Element) => {
			for (const a of attrs) el.removeAttribute(`data-${a.key}`);
		};
		const applyNode = (node: CanvasNodeLike) => setAttrs(node.nodeEl, "node", ctx.data.node(node).get().styles);
		const applyEdge = (edge: CanvasEdgeLike) => {
			const styles = ctx.data.edge(edge).get().styles;
			setAttrs(edge.lineGroupEl, "edge", styles);
			setAttrs(edge.lineEndGroupEl, "edge", styles);
			if (edge.labelElement) setAttrs(edge.labelElement.wrapperEl, "edge", styles);
		};

		ctx.decorateNodes({ apply: applyNode, clear: (n) => clearAll(n.nodeEl) });
		ctx.decorateEdges({
			apply: applyEdge,
			clear: (e) => {
				clearAll(e.lineGroupEl);
				clearAll(e.lineEndGroupEl);
				if (e.labelElement) clearAll(e.labelElement.wrapperEl);
			},
		});

		const choose = (attr: StyleAttribute, selection: CanvasItemLike[], buttonEl: HTMLElement) => {
			const canvas = selection[0]?.canvas;
			if (!canvas) return;
			const handle = (item: CanvasItemLike) => ("nodeEl" in item ? ctx.data.node(item) : ctx.data.edge(item));
			const current = common(selection, (i) => handle(i).get().styles?.[attr.key] ?? null);
			showPicker(
				buttonEl,
				[{ title: attr.label, items: attr.options.map((o) => ({ id: o.value ?? "\u0000", label: o.label, icon: o.icon ?? (o.value === null ? "circle-off" : "circle"), active: current === o.value })), columns: Math.min(6, attr.options.length) }],
				(id) => {
					const value = id === "\u0000" ? null : id;
					mutate(ctx, canvas, () => {
						for (const item of selection) {
							const styles = { ...handle(item).get().styles };
							if (value === null) delete styles[attr.key];
							else styles[attr.key] = value;
							handle(item).set({ styles: Object.keys(styles).length ? styles : undefined });
						}
					});
					for (const item of selection) ctx.events.emit("style-attribute-changed", canvas, item, attr.key, value);
				},
			);
		};

		const rebuild = () => {
			for (const off of buttons.splice(0)) off();
			attrs.forEach((attr, i) => {
				buttons.push(
					ctx.addMenuButton({
						id: `style-${attr.target}-${attr.key}`,
						icon: attr.icon ?? "paintbrush",
						tooltip: attr.label,
						order: 50 + i,
						isVisible: (selection) => (attr.target === "node" ? !!onlyNodes(selection) : !!onlyEdges(selection)),
						onClick: ({ selection, buttonEl }) => choose(attr, selection, buttonEl),
					}),
				);
			});
		};

		void load();
		ctx.registerEvent(ctx.app.workspace.on("css-change", () => void load()));
	},
});
