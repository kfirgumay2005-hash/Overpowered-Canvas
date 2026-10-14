import { defineModule } from "../../core/module";
import { ARROW_STYLES, EDGE_PATH_STYLES, type ArrowStyle, type EdgePathStyle } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import type { CanvasEdgeLike } from "../../internals/types";
import { showPicker } from "../../ui/picker";
import { common, mutate, onlyEdges } from "../shared";

/**
 * Arrowheads in the core's local frame: tip at (0,0), body along +y (away from the node),
 * core triangle is 13 wide and 10.4 long.
 */
export const ARROW_GEOMETRY: Record<Exclude<ArrowStyle, "none">, { d: string; filled: boolean }> = {
	triangle: { d: "M0 0 L6.5 10.4 L-6.5 10.4 Z", filled: true },
	"triangle-outline": { d: "M0 0 L6.5 10.4 L-6.5 10.4 Z", filled: false },
	"halved-triangle": { d: "M0 0 L6.5 10.4 L0 10.4 Z", filled: true },
	"thin-triangle": { d: "M-6.5 10.4 L0 0 L6.5 10.4", filled: false },
	diamond: { d: "M0 0 L5.5 7.5 L0 15 L-5.5 7.5 Z", filled: true },
	"diamond-outline": { d: "M0 0 L5.5 7.5 L0 15 L-5.5 7.5 Z", filled: false },
	circle: { d: "M0 0 A5.5 5.5 0 1 1 0 11 A5.5 5.5 0 1 1 0 0 Z", filled: true },
	"circle-outline": { d: "M0 0 A5.5 5.5 0 1 1 0 11 A5.5 5.5 0 1 1 0 0 Z", filled: false },
	blunted: { d: "M-6.5 0 L6.5 0 L6.5 2.5 L-6.5 2.5 Z", filled: true },
};

const SVG_NS = "http://www.w3.org/2000/svg";

function arrowPreview(style: ArrowStyle): string {
	if (style === "none") return `<svg viewBox="0 0 26 16" width="26" height="16"><path d="M3 8 L23 8" stroke="currentColor" stroke-width="1.6"/></svg>`;
	const g = ARROW_GEOMETRY[style];
	return `<svg viewBox="0 0 26 16" width="26" height="16"><path d="M3 8 L14 8" stroke="currentColor" stroke-width="1.6"/><g transform="translate(23 8) rotate(90)"><path d="${g.d}" fill="${g.filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></g></svg>`;
}

function pathPreview(style: EdgePathStyle): string {
	const dash = { solid: "", dotted: "0.1 4", "short-dashed": "4 3", "long-dashed": "9 4" }[style];
	return `<svg viewBox="0 0 26 16" width="26" height="16"><path d="M3 8 L23 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ""}/></svg>`;
}

/** Puts our arrowhead shape into a core line-end group, replacing the core triangle. */
function renderArrow(end: { el: SVGGElement } | null | undefined, style: ArrowStyle | undefined): void {
	if (!end) return;
	let path = end.el.querySelector<SVGPathElement>(":scope > path.opc-arrow");
	if (!style || style === "triangle" || style === "none") {
		path?.remove();
		end.el.removeAttribute("data-opc-arrow");
		return;
	}
	if (!path) {
		path = document.createElementNS(SVG_NS, "path") as SVGPathElement;
		path.classList.add("opc-arrow");
		end.el.appendChild(path);
	}
	const g = ARROW_GEOMETRY[style];
	path.setAttribute("d", g.d);
	path.classList.toggle("is-outline", !g.filled);
	end.el.setAttribute("data-opc-arrow", style);
}

function clearEdge(edge: CanvasEdgeLike): void {
	edge.lineGroupEl.removeAttribute("data-opc-path");
	edge.lineEndGroupEl.removeAttribute("data-opc-path");
	renderArrow(edge.fromLineEnd, undefined);
	renderArrow(edge.toLineEnd, undefined);
}

/** Line styles (dotted, dashed…) and arrowhead styles for edges. */
export const edgeStylesModule = defineModule({
	id: "edge-styles",
	name: "edgeStyles.name",
	description: "edgeStyles.desc",
	group: "edges",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		ctx.decorateEdges({
			apply: (edge, extra) => {
				if (extra.path && extra.path !== "solid") {
					edge.lineGroupEl.setAttribute("data-opc-path", extra.path);
					edge.lineEndGroupEl.setAttribute("data-opc-path", extra.path);
				} else {
					edge.lineGroupEl.removeAttribute("data-opc-path");
					edge.lineEndGroupEl.removeAttribute("data-opc-path");
				}
				renderArrow(edge.fromLineEnd, extra.arrows?.from);
				renderArrow(edge.toLineEnd, extra.arrows?.to);
			},
			clear: clearEdge,
		});
		// updatePath() recreates a line end when its type changes; re-apply right after.
		ctx.on("edge-path", (edge) => {
			const extra = ctx.data.edge(edge).get();
			renderArrow(edge.fromLineEnd, extra.arrows?.from);
			renderArrow(edge.toLineEnd, extra.arrows?.to);
		});

		ctx.addMenuButton({
			id: "edge-path-style",
			icon: "spline",
			tooltip: () => ctx.t("edgeStyles.pathButton"),
			order: 20,
			isVisible: (selection) => !!onlyEdges(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const edges = onlyEdges(selection) ?? [];
				const current = common(edges, (e) => ctx.data.edge(e).get().path ?? "solid");
				showPicker(
					buttonEl,
					[{ items: EDGE_PATH_STYLES.map((style) => ({ id: style, label: ctx.t(`edgeStyles.path.${style}` as I18nKey), svg: pathPreview(style), active: current === style })), columns: 4 }],
					(id) =>
						mutate(ctx, canvas, () => {
							for (const edge of edges) ctx.data.edge(edge).set({ path: id as EdgePathStyle });
						}),
				);
			},
		});

		ctx.addMenuButton({
			id: "edge-arrows",
			icon: "move-right",
			tooltip: () => ctx.t("edgeStyles.arrowButton"),
			order: 21,
			isVisible: (selection) => !!onlyEdges(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const edges = onlyEdges(selection) ?? [];
				const currentOf = (end: "from" | "to") =>
					common(edges, (e) => {
						const core = end === "from" ? e.from.end : e.to.end;
						if (core === "none") return "none";
						return ctx.data.edge(e).get().arrows?.[end] ?? "triangle";
					});
				const items = (end: "from" | "to") =>
					ARROW_STYLES.map((style) => ({
						id: `${end}:${style}`,
						label: ctx.t(`edgeStyles.arrow.${style}` as I18nKey),
						svg: arrowPreview(style),
						active: currentOf(end) === style,
					}));
				showPicker(
					buttonEl,
					[
						{ title: ctx.t("edgeStyles.arrowStart"), items: items("from"), columns: 5 },
						{ title: ctx.t("edgeStyles.arrowEnd"), items: items("to"), columns: 5 },
					],
					(id) => {
						const [end, style] = id.split(":") as ["from" | "to", ArrowStyle];
						mutate(ctx, canvas, () => {
							for (const edge of edges) {
								const arrows = { ...ctx.data.edge(edge).get().arrows };
								if (style === "triangle" || style === "none") delete arrows[end];
								else arrows[end] = style;
								ctx.data.edge(edge).set({ arrows: Object.keys(arrows).length ? arrows : undefined });
								// Keep the standard end in sync so vanilla Obsidian shows a similar edge.
								(end === "from" ? edge.from : edge.to).end = style === "none" ? "none" : "arrow";
								canvas.markDirty(edge);
							}
						});
					},
				);
			},
		});
	},
});
