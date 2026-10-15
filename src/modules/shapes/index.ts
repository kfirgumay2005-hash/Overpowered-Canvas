import { defineModule } from "../../core/module";
import { SHAPES, STANDALONE_SHAPES, type OpcNode, type ShapeName } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { showPicker, type PickerItem } from "../../ui/picker";
import { renderNodeShape, shapePreviewSvg } from "../../ui/shape-renderer";
import { shapeNodeData } from "../free-lines/model";
import { shapeLabelKey } from "../node-shapes";
import { common, mutate, nodeType, onlyNodes, randomId } from "../shared";

const FILLS = ["tint", "solid", "none"] as const;
const WIDTHS = [0, 1, 2, 4, 6, 10];
const OPACITIES = [1, 0.75, 0.5, 0.25];
const ROTATIONS = [0, 15, 30, 45, 90, 135, 180, -45, -30, -15];
const VARS = ["--opc-fill", "--opc-stroke-width", "--opc-opacity", "--opc-rotation"];

function isShape(node: CanvasNodeLike, extra: OpcNode): boolean {
	return extra.kind === "shape" && nodeType(node) !== "group";
}

function apply(node: CanvasNodeLike, extra: OpcNode | null): void {
	const el = node.nodeEl;
	if (!extra) {
		if (el.getAttribute("data-opc-kind") === "shape") {
			el.removeAttribute("data-opc-kind");
			el.removeAttribute("data-opc-fill");
			renderNodeShape(node, null);
		}
		for (const v of VARS) el.style.removeProperty(v);
		return;
	}
	el.setAttribute("data-opc-kind", "shape");
	renderNodeShape(node, (extra.shape && SHAPES.includes(extra.shape) ? extra.shape : "rectangle"));
	const fill = extra.fill ?? "tint";
	el.setAttribute("data-opc-fill", (FILLS as readonly string[]).includes(fill) ? fill : "color");
	if (fill.startsWith("#")) el.style.setProperty("--opc-fill", fill);
	else el.style.removeProperty("--opc-fill");
	const set = (name: string, value: number | undefined, unit: string) => (value === undefined ? el.style.removeProperty(name) : el.style.setProperty(name, `${value}${unit}`));
	set("--opc-stroke-width", extra.strokeWidth, "px");
	set("--opc-opacity", extra.opacity, "");
	set("--opc-rotation", extra.rotation || undefined, "deg");
}

/**
 * Standalone shapes (kind "shape"): rectangles, ellipses, stars, clouds, block arrows…, with
 * fill, stroke width, opacity and rotation. Text typed into a shape stays upright. Shapes come
 * from the card menu, or from shape recognition while drawing.
 */
export const shapesModule = defineModule({
	id: "shapes",
	name: "shapes.name",
	description: "shapes.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		ctx.decorateNodes({
			apply: (node, extra) => apply(node, isShape(node, extra) ? extra : null),
			clear: (node) => apply(node, null),
		});

		const create = (canvas: CanvasLike, shape: ShapeName, at?: { x: number; y: number }) => {
			const view = canvas.getViewportBBox();
			const width = shape === "ellipse" || shape === "star" || shape === "pentagon" || shape === "hexagon" || shape === "octagon" ? 160 : 200;
			const height = shape.startsWith("block-arrow-left") || shape.startsWith("block-arrow-right") || shape === "block-arrow-double" ? 100 : 160;
			const cx = at?.x ?? (view.minX + view.maxX) / 2;
			const cy = at?.y ?? (view.minY + view.maxY) / 2;
			const id = randomId();
			mutate(ctx, canvas, () => {
				canvas.importData({ nodes: [shapeNodeData(id, shape, { x: cx - width / 2, y: cy - height / 2, width, height }, {})], edges: [] }, false);
			});
			const node = canvas.nodes.get(id);
			if (node) {
				canvas.selectOnly(node);
				ctx.events.emit("shape-created", canvas, node);
			}
		};
		const shapeItems = (current?: ShapeName): PickerItem[] => STANDALONE_SHAPES.map((s) => ({ id: s, label: ctx.t(shapeLabelKey(s)), svg: shapePreviewSvg(s), active: current === s }));

		ctx.addCardMenuButton({
			id: "shape",
			icon: "shapes",
			tooltip: () => ctx.t("shapes.add"),
			order: 110,
			onClick: (canvas, evt) => showPicker(evt.currentTarget as HTMLElement, [{ title: ctx.t("shapes.add"), items: shapeItems() }], (id) => create(canvas, id as ShapeName)),
			drag: { size: () => ({ width: 200, height: 160 }), drop: (canvas, pos) => create(canvas, "rectangle", { x: pos.x + 100, y: pos.y + 80 }) },
		});

		const selectedShapes = (selection: Parameters<typeof onlyNodes>[0]) => {
			const nodes = onlyNodes(selection);
			return nodes && nodes.every((n) => isShape(n, ctx.data.node(n).get())) ? nodes : null;
		};

		ctx.addMenuButton({
			id: "shape-style",
			icon: "shapes",
			tooltip: () => ctx.t("shapes.style"),
			order: 10,
			isVisible: (selection) => !!selectedShapes(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = selectedShapes(selection) ?? [];
				const get = <K extends keyof OpcNode>(k: K) => common(nodes, (n) => ctx.data.node(n).get()[k]);
				const fill = get("fill") ?? "tint";
				const width = get("strokeWidth");
				const opacity = get("opacity") ?? 1;
				const rotation = get("rotation") ?? 0;
				const bar = (svg: string) => `<svg viewBox="0 0 26 16" width="26" height="16">${svg}</svg>`;
				showPicker(
					buttonEl,
					[
						{ title: ctx.t("shapes.shape"), items: shapeItems(get("shape")).map((i) => ({ ...i, id: `shape:${i.id}` })) },
						{
							title: ctx.t("shapes.fill"),
							columns: 3,
							items: FILLS.map((f) => ({ id: `fill:${f}`, label: ctx.t(`shapes.fill.${f}`), icon: f === "none" ? "square-dashed" : f === "solid" ? "square" : "square-dot", active: fill === f })),
						},
						{
							title: ctx.t("shapes.strokeWidth"),
							items: WIDTHS.map((w) => ({
								id: `width:${w}`,
								label: w === 0 ? ctx.t("shapes.noStroke") : `${w}px`,
								svg: bar(w === 0 ? `<path d="M3 8 L23 8" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3"/>` : `<path d="M3 8 L23 8" stroke="currentColor" stroke-width="${w}" stroke-linecap="round"/>`),
								active: (width ?? 1.5) === w,
							})),
						},
						{ title: ctx.t("shapes.opacity"), columns: 4, items: OPACITIES.map((o) => ({ id: `opacity:${o}`, label: `${o * 100}%`, svg: bar(`<rect x="5" y="2" width="16" height="12" rx="2" fill="currentColor" fill-opacity="${o}"/>`), active: opacity === o })) },
						{
							title: ctx.t("shapes.rotation"),
							columns: 5,
							items: ROTATIONS.map((r) => ({ id: `rotation:${r}`, label: `${r}°`, svg: bar(`<rect x="8" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.5" transform="rotate(${r} 13 8)"/>`), active: rotation === r })),
						},
					],
					(id) => {
						const [kind, value] = id.split(":") as [string, string];
						mutate(ctx, canvas, () => {
							for (const n of nodes) {
								const access = ctx.data.node(n);
								if (kind === "shape") access.set({ shape: value as ShapeName });
								else if (kind === "fill") access.set({ fill: value === "tint" ? undefined : value });
								else if (kind === "width") access.set({ strokeWidth: Number(value) });
								else if (kind === "opacity") access.set({ opacity: Number(value) });
								else access.set({ rotation: Number(value) });
							}
						});
					},
				);
			},
		});
	},
});
