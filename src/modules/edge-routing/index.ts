import { Setting } from "obsidian";
import { defineModule } from "../../core/module";
import { EDGE_ROUTES, type EdgeRoute, type OpcEdge } from "../../data/schema";
import { arrowAngle, anchor, astarRoute, orthogonalRoute, pointAlong, polylinePath, trim, type Box, type P } from "../../geometry/routing";
import type { I18nKey } from "../../i18n";
import type { CanvasEdgeLike, CanvasLike } from "../../internals/types";
import { showPicker } from "../../ui/picker";
import { common, mutate, nodeType, onlyEdges } from "../shared";

interface RoutingSettings {
	defaultRoute: EdgeRoute;
	cornerRadius: number;
}

/** Gap the core leaves between the path and a node side when an arrowhead is drawn there. */
const ARROW_GAP = 7;

const ROUTE_ICONS: Record<EdgeRoute, string> = { bezier: "spline", straight: "minus", orthogonal: "corner-down-right", astar: "route" };

export interface RoutedPath {
	points: P[];
	d: string;
}

/** Polyline for an edge, or null to keep the core bezier. */
export function routeEdge(edge: CanvasEdgeLike, extra: Readonly<OpcEdge>, defaultRoute: EdgeRoute, radius: number): RoutedPath | null {
	const route = extra.route ?? defaultRoute;
	const fromBox = edge.from.node.getBBox();
	const toBox = edge.to.node.getBBox();
	const a = anchor(fromBox, edge.from.side);
	const b = anchor(toBox, edge.to.side);
	let points: P[] | null = null;
	let r = 0;
	if (extra.waypoints?.length) {
		points = [a, ...extra.waypoints.map(([x, y]) => ({ x, y })), b];
	} else if (route === "straight") {
		points = [a, b];
	} else if (route === "orthogonal") {
		points = orthogonalRoute(a, edge.from.side, b, edge.to.side, [fromBox, toBox]);
		r = radius;
	} else if (route === "astar") {
		points = astarRoute(a, edge.from.side, b, edge.to.side, obstaclesFor(edge.canvas, fromBox, toBox)) ?? orthogonalRoute(a, edge.from.side, b, edge.to.side, [fromBox, toBox]);
		r = radius;
	}
	if (!points) return null;
	const shown = trim(points, edge.fromLineEnd ? ARROW_GAP : 0, edge.toLineEnd ? ARROW_GAP : 0);
	return { points, d: polylinePath(shown, r) };
}

function obstaclesFor(canvas: CanvasLike, a: Box, b: Box): Box[] {
	const area: Box = {
		minX: Math.min(a.minX, b.minX) - 400,
		minY: Math.min(a.minY, b.minY) - 400,
		maxX: Math.max(a.maxX, b.maxX) + 400,
		maxY: Math.max(a.maxY, b.maxY) + 400,
	};
	return canvas.getIntersectingNodes(area).filter((n) => nodeType(n) !== "group").map((n) => n.getBBox());
}

function cubicAt(t: number, bz: NonNullable<CanvasEdgeLike["bezier"]>): P {
	const u = 1 - t;
	return {
		x: u * u * u * bz.from.x + 3 * t * u * u * bz.cp1.x + 3 * t * t * u * bz.cp2.x + t * t * t * bz.to.x,
		y: u * u * u * bz.from.y + 3 * t * u * u * bz.cp1.y + 3 * t * t * u * bz.cp2.y + t * t * t * bz.to.y,
	};
}

/** Pathfinding modes: bezier (core), straight, orthogonal and A* (routes around cards). */
export const edgeRoutingModule = defineModule<RoutingSettings>({
	id: "edge-routing",
	name: "edgeRouting.name",
	description: "edgeRouting.desc",
	group: "edges",
	defaultEnabled: true,
	defaultSettings: { defaultRoute: "bezier", cornerRadius: 8 },
	overlapsWith: ["advanced-canvas"],
	sanitizeSettings: (raw, defaults) => {
		const r = (raw ?? {}) as Partial<RoutingSettings>;
		return {
			defaultRoute: EDGE_ROUTES.includes(r.defaultRoute as EdgeRoute) ? (r.defaultRoute as EdgeRoute) : defaults.defaultRoute,
			cornerRadius: typeof r.cornerRadius === "number" && r.cornerRadius >= 0 && r.cornerRadius <= 40 ? r.cornerRadius : defaults.cornerRadius,
		};
	},

	enable(ctx) {
		const routed = new WeakSet<CanvasEdgeLike>();

		ctx.on("edge-path", (edge) => {
			if (!edge.path) return;
			const extra = ctx.data.edge(edge).get();
			const result = routeEdge(edge, extra, ctx.settings.defaultRoute, ctx.settings.cornerRadius);
			if (result) {
				routed.add(edge);
				edge.path.display.setAttribute("d", result.d);
				edge.path.interaction.setAttribute("d", result.d);
				const pts = result.points;
				const placeEnd = (end: { el: SVGGElement } | null | undefined, tip: P, toward: P) => {
					if (end) end.el.style.transform = `translate(${tip.x}px, ${tip.y}px) rotate(${arrowAngle(tip, toward)}deg)`;
				};
				placeEnd(edge.fromLineEnd, pts[0]!, pts[1]!);
				placeEnd(edge.toLineEnd, pts[pts.length - 1]!, pts[pts.length - 2]!);
				const mid = pointAlong(pts, extra.labelT ?? 0.5).point;
				edge.bezier = { from: mid, to: mid, cp1: mid, cp2: mid, path: result.d };
			} else if (extra.labelT !== undefined && edge.bezier) {
				// Bezier route with a moved label: getCenter() evaluates the bezier at 0.5.
				const p = cubicAt(extra.labelT, edge.bezier);
				edge.bezier = { ...edge.bezier, from: p, to: p, cp1: p, cp2: p };
			} else routed.delete(edge);
		});

		// Settings or module changes: recompute every visible edge.
		const rerouteAll = () => {
			for (const canvas of ctx.canvases()) for (const edge of canvas.edges.values()) canvas.markDirty(edge);
		};
		rerouteAll();
		ctx.onSettingsChange(rerouteAll);
		// After the hooks are gone, let the core redraw its own paths.
		ctx.register(() => window.setTimeout(rerouteAll));

		ctx.addMenuButton({
			id: "edge-route",
			icon: (selection) => {
				const edges = onlyEdges(selection) ?? [];
				const current = common(edges, (e) => ctx.data.edge(e).get().route ?? ctx.settings.defaultRoute) ?? "bezier";
				return ROUTE_ICONS[current];
			},
			tooltip: () => ctx.t("edgeRouting.button"),
			order: 22,
			isVisible: (selection) => !!onlyEdges(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const edges = onlyEdges(selection) ?? [];
				const current = common(edges, (e) => ctx.data.edge(e).get().route ?? ctx.settings.defaultRoute);
				showPicker(
					buttonEl,
					[{ items: EDGE_ROUTES.map((route) => ({ id: route, label: ctx.t(`edgeRouting.${route}` as I18nKey), icon: ROUTE_ICONS[route], active: current === route })), columns: 4 }],
					(id) => {
						mutate(ctx, canvas, () => {
							for (const edge of edges) {
								// Picking a route discards manual bend points, which would override it.
								ctx.data.edge(edge).set({ route: id as EdgeRoute, waypoints: undefined });
								canvas.markDirty(edge);
							}
						});
						canvas.menu.render(true);
					},
				);
			},
		});
	},

	renderSettings(el, ctx) {
		new Setting(el)
			.setName(ctx.t("edgeRouting.default.name"))
			.setDesc(ctx.t("edgeRouting.default.desc"))
			.addDropdown((d) => {
				for (const route of EDGE_ROUTES) d.addOption(route, ctx.t(`edgeRouting.${route}` as I18nKey));
				d.setValue(ctx.settings.defaultRoute).onChange((v) => ctx.updateSettings({ defaultRoute: v as EdgeRoute }));
			});
		new Setting(el)
			.setName(ctx.t("edgeRouting.radius.name"))
			.addSlider((s) => s.setLimits(0, 30, 1).setValue(ctx.settings.cornerRadius).setDynamicTooltip().onChange((v) => ctx.updateSettings({ cornerRadius: v })));
	},
});
