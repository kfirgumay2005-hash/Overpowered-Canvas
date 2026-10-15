import { Menu } from "obsidian";
import { defineModule } from "../../core/module";
import type { GuideData, OpcNode } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { showPicker } from "../../ui/picker";
import { common, mutate, nodeType, onlyNodes, randomId } from "../shared";

type Axis = GuideData["axis"];

/** The selectable handle of a line (a small invisible card on the line). */
const HANDLE_LONG = 160;
const HANDLE_SHORT = 24;
/** Half the drawn length of a line, in canvas units: "infinite" for any practical board. */
const REACH = 1_000_000;
const WIDTHS = [1, 2, 4, 6, 10, 16];
const DEFAULT_WIDTH = 2;

const handleSize = (axis: Axis) => (axis === "h" ? { width: HANDLE_LONG, height: HANDLE_SHORT } : { width: HANDLE_SHORT, height: HANDLE_LONG });
const isGuide = (node: CanvasNodeLike, extra: Readonly<OpcNode>) => extra.kind === "guide" && !!extra.guide && nodeType(node) === "text";

/** One canvas' line layer: a div under all cards holding one element per line. */
class GuideLayer {
	readonly el: HTMLElement;
	private readonly lines = new Map<CanvasNodeLike, HTMLElement>();

	constructor(
		private readonly canvas: CanvasLike,
		private readonly onLineDown: (node: CanvasNodeLike, evt: PointerEvent) => void,
	) {
		this.el = createDiv({ cls: "opc-guides" });
		canvas.canvasEl.prepend(this.el);
	}

	render(node: CanvasNodeLike, guide: GuideData): void {
		let line = this.lines.get(node);
		if (!line) {
			line = this.el.createDiv({ cls: "opc-guide" });
			line.createDiv({ cls: "opc-guide-stroke" });
			line.addEventListener("pointerdown", (evt) => this.onLineDown(node, evt));
			// A double-click on the line must not create a card underneath.
			line.addEventListener("dblclick", (evt) => evt.stopPropagation());
			this.lines.set(node, line);
		}
		line.dataset.axis = guide.axis;
		line.style.setProperty("--opc-guide-width", `${guide.width}px`);
		if (guide.axis === "h") line.setCssStyles({ left: `${-REACH}px`, width: `${2 * REACH}px`, top: `${node.y + node.height / 2}px`, height: "", bottom: "" });
		else line.setCssStyles({ top: `${-REACH}px`, height: `${2 * REACH}px`, left: `${node.x + node.width / 2}px`, width: "" });
		// Colors: palette numbers use the core's classes, anything else is a hex value.
		for (const cls of [...line.classList]) if (cls.startsWith("mod-canvas-color-")) line.removeClass(cls);
		line.style.removeProperty("--canvas-color");
		if (/^\d+$/.test(node.color)) line.addClass(`mod-canvas-color-${node.color}`);
		else if (node.color) line.style.setProperty("--canvas-color", node.color);
		line.toggleClass("is-themed", !!node.color);
		line.toggleClass("is-selected", this.canvas.selection.has(node));
	}

	remove(node: CanvasNodeLike): void {
		this.lines.get(node)?.remove();
		this.lines.delete(node);
	}

	syncSelection(): void {
		for (const [node, line] of this.lines) line.toggleClass("is-selected", this.canvas.selection.has(node));
	}

	destroy(): void {
		this.el.remove();
		this.lines.clear();
	}
}

/**
 * Infinite lines: horizontal or vertical lines across the whole board, with their own color and
 * thickness (selection toolbar). Each is stored as a small handle card on the line; the line is
 * drawn on a layer under all cards, so it stays visible wherever the handle is.
 */
export const infiniteLinesModule = defineModule({
	id: "infinite-lines",
	name: "infiniteLines.name",
	description: "infiniteLines.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		const layers = new Map<CanvasLike, GuideLayer>();

		/**
		 * Clicking the line far from its handle first slides the handle along the line to the
		 * pointer, so the selection box and toolbar appear where the user clicked.
		 */
		const onLineDown = (node: CanvasNodeLike, evt: PointerEvent) => {
			const canvas = node.canvas;
			if (evt.button !== 0 && evt.pointerType === "mouse") return;
			evt.stopPropagation();
			const guide = ctx.data.node(node).get().guide;
			if (!guide) return;
			if (!canvas.readonly) {
				const p = canvas.posFromEvt(evt);
				const pos = guide.axis === "h" ? { x: Math.round(p.x - node.width / 2), y: node.y } : { x: node.x, y: Math.round(p.y - node.height / 2) };
				if (Math.abs(pos.x - node.x) > 1 || Math.abs(pos.y - node.y) > 1) {
					node.moveTo(pos);
					node.render();
					canvas.requestSave(false);
				}
			}
			(node as unknown as { onPointerdown(e: PointerEvent): void }).onPointerdown(evt);
		};

		const apply = (node: CanvasNodeLike, extra: Readonly<OpcNode>) => {
			const layer = layers.get(node.canvas);
			if (isGuide(node, extra)) {
				node.nodeEl.setAttribute("data-opc-kind", "guide");
				node.nodeEl.setAttribute("data-opc-axis", extra.guide!.axis);
				layer?.render(node, extra.guide!);
			} else {
				if (node.nodeEl.getAttribute("data-opc-kind") === "guide") {
					node.nodeEl.removeAttribute("data-opc-kind");
					node.nodeEl.removeAttribute("data-opc-axis");
				}
				layer?.remove(node);
			}
		};
		ctx.onCanvas((canvas) => {
			layers.set(canvas, new GuideLayer(canvas, onLineDown));
			for (const node of canvas.nodes.values()) apply(node, ctx.data.node(node).get());
			return () => {
				layers.get(canvas)?.destroy();
				layers.delete(canvas);
			};
		});

		ctx.decorateNodes({
			apply,
			clear: (node) => {
				if (node.nodeEl.getAttribute("data-opc-kind") === "guide") {
					node.nodeEl.removeAttribute("data-opc-kind");
					node.nodeEl.removeAttribute("data-opc-axis");
				}
				layers.get(node.canvas)?.remove(node);
			},
		});
		ctx.on("node-moved", (node) => {
			const extra = ctx.data.node(node).get();
			if (isGuide(node, extra)) layers.get(node.canvas)?.render(node, extra.guide!);
		});
		ctx.on("node-removed", (node) => layers.get(node.canvas)?.remove(node));
		ctx.on("selection-change", (canvas) => layers.get(canvas)?.syncSelection());
		// Lines are not text to edit.
		ctx.intercept("node-start-editing", (node) => (isGuide(node, ctx.data.node(node).get()) ? true : undefined));

		const create = (canvas: CanvasLike, axis: Axis, center?: { x: number; y: number }) => {
			const v = canvas.getViewportBBox();
			const c = center ?? { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 };
			const size = handleSize(axis);
			const id = randomId();
			mutate(ctx, canvas, () => {
				canvas.importData(
					{ nodes: [{ id, type: "text", text: "", x: Math.round(c.x - size.width / 2), y: Math.round(c.y - size.height / 2), ...size, "x-opc": { kind: "guide", guide: { axis, width: DEFAULT_WIDTH } } }], edges: [] },
					false,
				);
			});
			const node = canvas.nodes.get(id);
			if (node) canvas.selectOnly(node);
		};

		ctx.addCardMenuButton({
			id: "infinite-line",
			icon: "separator-horizontal",
			tooltip: () => ctx.t("infiniteLines.add.tooltip"),
			order: 110,
			onClick: (canvas) => create(canvas, "h"),
			onContextMenu: (canvas, evt) => {
				const menu = new Menu();
				menu.addItem((i) => i.setTitle(ctx.t("infiniteLines.add.h")).setIcon("separator-horizontal").onClick(() => create(canvas, "h")));
				menu.addItem((i) => i.setTitle(ctx.t("infiniteLines.add.v")).setIcon("separator-vertical").onClick(() => create(canvas, "v")));
				menu.showAtMouseEvent(evt);
			},
			drag: { size: () => handleSize("h"), drop: (canvas, pos) => create(canvas, "h", { x: pos.x + HANDLE_LONG / 2, y: pos.y + HANDLE_SHORT / 2 }) },
		});
		for (const axis of ["h", "v"] as const)
			ctx.addCommand({
				id: `add-${axis}`,
				name: ctx.t(axis === "h" ? "infiniteLines.add.h" : "infiniteLines.add.v"),
				icon: axis === "h" ? "separator-horizontal" : "separator-vertical",
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || canvas.readonly) return false;
					if (!checking) create(canvas, axis);
					return true;
				},
			});

		// Selection toolbar: thickness and direction.
		const selectedGuides = (selection: Parameters<typeof onlyNodes>[0]) => {
			const nodes = onlyNodes(selection);
			return nodes && nodes.every((n) => isGuide(n, ctx.data.node(n).get())) ? nodes : null;
		};
		ctx.addMenuButton({
			id: "guide-width",
			icon: "minus",
			tooltip: () => ctx.t("infiniteLines.width"),
			order: 6,
			isVisible: (selection) => !!selectedGuides(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = selectedGuides(selection) ?? [];
				const current = common(nodes, (n) => ctx.data.node(n).get().guide?.width);
				showPicker(
					buttonEl,
					[{ columns: 6, items: WIDTHS.map((w) => ({ id: String(w), label: `${w}px`, svg: widthSwatch(w), active: current === w })) }],
					(id) =>
						mutate(ctx, canvas, () => {
							for (const n of nodes) {
								const guide = ctx.data.node(n).get().guide!;
								ctx.data.node(n).set({ guide: { ...guide, width: Number(id) } });
							}
						}),
				);
			},
		});
		ctx.addMenuButton({
			id: "guide-axis",
			icon: (selection) => ((selectedGuides(selection) ?? [])[0] && ctx.data.node(selectedGuides(selection)![0]!).get().guide?.axis === "v" ? "separator-horizontal" : "separator-vertical"),
			tooltip: () => ctx.t("infiniteLines.rotate"),
			order: 7,
			isVisible: (selection) => !!selectedGuides(selection),
			onClick: ({ canvas, selection }) => {
				const nodes = selectedGuides(selection) ?? [];
				mutate(ctx, canvas, () => {
					for (const n of nodes) {
						const guide = ctx.data.node(n).get().guide!;
						const axis: Axis = guide.axis === "h" ? "v" : "h";
						const cx = n.x + n.width / 2;
						const cy = n.y + n.height / 2;
						const size = handleSize(axis);
						n.moveAndResize({ x: Math.round(cx - size.width / 2), y: Math.round(cy - size.height / 2), ...size });
						ctx.data.node(n).set({ guide: { ...guide, axis } });
					}
				});
				canvas.menu.render(true);
			},
		});
	},
});

function widthSwatch(width: number): string {
	return `<svg viewBox="0 0 24 24" width="20" height="20"><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="${Math.min(width, 12)}" stroke-linecap="round"/></svg>`;
}
