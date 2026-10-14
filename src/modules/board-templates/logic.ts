/**
 * Board template transforms (pure, unit-tested): cut a selection out of a canvas, move it to
 * the origin, give it fresh ids and mirror it for RTL boards.
 */
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData, EdgeSide } from "../../data/json-canvas";
import { SCHEMA_KEY } from "../../data/schema";

type Data = { nodes: CanvasNodeData[]; edges: CanvasEdgeData[]; [key: string]: unknown };

function parts(data: CanvasFileData): Data {
	return { ...data, nodes: data.nodes ?? [], edges: data.edges ?? [] };
}

/** The given nodes and the edges between them. */
export function extract(data: CanvasFileData, ids: ReadonlySet<string>): Data {
	const d = parts(data);
	return {
		nodes: structuredClone(d.nodes.filter((n) => ids.has(n.id))),
		edges: structuredClone(d.edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))),
	};
}

export function bounds(data: CanvasFileData): { minX: number; minY: number; maxX: number; maxY: number } {
	const nodes = data.nodes ?? [];
	if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	return {
		minX: Math.min(...nodes.map((n) => n.x)),
		minY: Math.min(...nodes.map((n) => n.y)),
		maxX: Math.max(...nodes.map((n) => n.x + n.width)),
		maxY: Math.max(...nodes.map((n) => n.y + n.height)),
	};
}

/** Moves everything so the top-left corner is at (dx, dy) relative to the current bounds. */
export function translate(data: CanvasFileData, dx: number, dy: number): Data {
	const d = parts(data);
	const edges = d.edges.map((e) => {
		const extra = e[SCHEMA_KEY] as { waypoints?: [number, number][] } | undefined;
		if (!extra?.waypoints) return e;
		return { ...e, [SCHEMA_KEY]: { ...extra, waypoints: extra.waypoints.map(([x, y]) => [x + dx, y + dy]) } };
	});
	return { ...d, nodes: d.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })), edges };
}

/** Top-left at (0, 0). */
export function normalize(data: CanvasFileData): Data {
	const b = bounds(data);
	return translate(data, -b.minX, -b.minY);
}

/** Fresh ids for every node and edge, with references inside our extra data remapped. */
export function reid(data: CanvasFileData, newId: () => string): Data {
	const d = parts(data);
	const map = new Map<string, string>();
	for (const n of d.nodes) map.set(n.id, newId());
	const mapped = (id: string | undefined) => (id !== undefined ? (map.get(id) ?? id) : id);
	const nodes = d.nodes.map((n) => {
		const out: CanvasNodeData = { ...n, id: map.get(n.id)! };
		const extra = n[SCHEMA_KEY] as Record<string, unknown> | undefined;
		if (extra) {
			const x = structuredClone(extra) as { line?: { from?: { node: string }; to?: { node: string } }; queryOwner?: string };
			if (x.line?.from) x.line.from.node = mapped(x.line.from.node)!;
			if (x.line?.to) x.line.to.node = mapped(x.line.to.node)!;
			if (x.queryOwner) x.queryOwner = mapped(x.queryOwner);
			out[SCHEMA_KEY] = x;
		}
		return out;
	});
	const edges = d.edges.map((e) => ({ ...e, id: newId(), fromNode: mapped(e.fromNode)!, toNode: mapped(e.toNode)! }));
	const root = d[SCHEMA_KEY] as { presentation?: { start?: string; last?: string }; frameOrder?: string[] } | undefined;
	const out: Data = { ...d, nodes, edges };
	if (root) {
		const r = structuredClone(root);
		if (r.presentation?.start) r.presentation.start = mapped(r.presentation.start);
		if (r.presentation?.last) r.presentation.last = mapped(r.presentation.last);
		if (r.frameOrder) r.frameOrder = r.frameOrder.map((id) => mapped(id)!);
		out[SCHEMA_KEY] = r;
	}
	return out;
}

const FLIP: Record<EdgeSide, EdgeSide> = { left: "right", right: "left", top: "top", bottom: "bottom" };

/** Mirrors left↔right around x = 0 (for right-to-left boards). */
export function mirror(data: CanvasFileData): Data {
	const d = parts(data);
	const nodes = d.nodes.map((n) => {
		const out: CanvasNodeData = { ...n, x: -(n.x + n.width) };
		const extra = n[SCHEMA_KEY] as { line?: { points: [number, number][] } } | undefined;
		if (extra?.line) out[SCHEMA_KEY] = { ...extra, line: { ...extra.line, points: extra.line.points.map(([x, y]) => [n.width - x, y]) } };
		return out;
	});
	const edges = d.edges.map((e) => {
		const out: CanvasEdgeData = { ...e };
		if (e.fromSide) out.fromSide = FLIP[e.fromSide];
		if (e.toSide) out.toSide = FLIP[e.toSide];
		const extra = e[SCHEMA_KEY] as { waypoints?: [number, number][] } | undefined;
		if (extra?.waypoints) out[SCHEMA_KEY] = { ...extra, waypoints: extra.waypoints.map(([x, y]) => [-x, y]) };
		return out;
	});
	return { ...d, nodes, edges };
}

/** Ready-to-insert copy of a template with its top-left at `at`. */
export function instantiate(template: CanvasFileData, at: { x: number; y: number }, newId: () => string, rtl = false): Data {
	const base = rtl ? mirror(template) : template;
	const n = normalize(base);
	return reid(translate(n, Math.round(at.x), Math.round(at.y)), newId);
}

/** A file name that doesn't collide: "Name", "Name 2", "Name 3", … */
export function uniqueName(base: string, exists: (name: string) => boolean): string {
	if (!exists(base)) return base;
	for (let i = 2; ; i++) if (!exists(`${base} ${i}`)) return `${base} ${i}`;
}
