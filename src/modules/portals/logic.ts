/**
 * Portal data handling (pure, unit-tested).
 *
 * Ghost ids look like "<portalId>~<targetId>". Ghosts exist only in the live canvas; before
 * data leaves getData() they are removed, and edges attached to them are saved as edges to the
 * portal card with x-opc.portalTarget = { end, nodeId: targetId }.
 */
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData } from "../../data/json-canvas";
import { SCHEMA_KEY } from "../../data/schema";
import { isPlainObject } from "../../data/validate";

export const SEP = "~";

export function ghostId(portalId: string, targetId: string): string {
	return `${portalId}${SEP}${targetId}`;
}

export function parseGhostId(id: string): { portalId: string; targetId: string } | null {
	const i = id.indexOf(SEP);
	return i > 0 ? { portalId: id.slice(0, i), targetId: id.slice(i + 1) } : null;
}

function withExtra(edge: CanvasEdgeData, patch: Record<string, unknown> | undefined): CanvasEdgeData {
	const extra = isPlainObject(edge[SCHEMA_KEY]) ? { ...(edge[SCHEMA_KEY]) } : {};
	if (patch) Object.assign(extra, patch);
	else delete extra.portalTarget;
	const out: CanvasEdgeData = { ...edge };
	if (Object.keys(extra).length) out[SCHEMA_KEY] = extra;
	else delete out[SCHEMA_KEY];
	return out;
}

/** Removes ghosts and maps edges to ghosts back to their portal card. */
export function stripGhosts(data: CanvasFileData, isGhost: (id: string) => boolean): CanvasFileData {
	const nodes = (data.nodes ?? []).filter((n) => !isGhost(n.id));
	const edges: CanvasEdgeData[] = [];
	for (const e of data.edges ?? []) {
		const fromGhost = isGhost(e.fromNode) ? parseGhostId(e.fromNode) : null;
		const toGhost = isGhost(e.toNode) ? parseGhostId(e.toNode) : null;
		// Edges inside a portal (both ends ghosts of the same portal) belong to the other canvas.
		if (fromGhost && toGhost) continue;
		if (isGhost(e.id)) continue;
		if (fromGhost) edges.push(withExtra({ ...e, fromNode: fromGhost.portalId }, { portalTarget: { end: "from", nodeId: fromGhost.targetId } }));
		else if (toGhost) edges.push(withExtra({ ...e, toNode: toGhost.portalId }, { portalTarget: { end: "to", nodeId: toGhost.targetId } }));
		else edges.push(e);
	}
	return { ...data, nodes, edges };
}

/** Ghost nodes and edges for a portal: target content shifted into the portal frame. */
export function buildGhosts(
	portal: { id: string; x: number; y: number },
	target: CanvasFileData,
	padding: number,
	header: number,
): { nodes: CanvasNodeData[]; edges: CanvasEdgeData[]; width: number; height: number } {
	const src = (target.nodes ?? []).filter((n) => typeof n.id === "string");
	if (src.length === 0) return { nodes: [], edges: [], width: 400, height: 200 };
	const minX = Math.min(...src.map((n) => n.x));
	const minY = Math.min(...src.map((n) => n.y));
	const maxX = Math.max(...src.map((n) => n.x + n.width));
	const maxY = Math.max(...src.map((n) => n.y + n.height));
	const nodes = src.map((n) => {
		const { [SCHEMA_KEY]: extra, ...rest } = n;
		const copy: CanvasNodeData = { ...rest, id: ghostId(portal.id, n.id), x: portal.x + padding + (n.x - minX), y: portal.y + header + padding + (n.y - minY) };
		// Keep visual extra data, but never nested portals.
		if (isPlainObject(extra)) {
			const { portal: _p, ...keep } = extra;
			if (Object.keys(keep).length) copy[SCHEMA_KEY] = keep;
		}
		return copy;
	});
	const ids = new Set(src.map((n) => n.id));
	const edges = (target.edges ?? [])
		.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode))
		.map((e) => ({ ...e, id: ghostId(portal.id, e.id), fromNode: ghostId(portal.id, e.fromNode), toNode: ghostId(portal.id, e.toNode) }));
	return { nodes, edges, width: Math.round(maxX - minX + padding * 2), height: Math.round(maxY - minY + padding * 2 + header) };
}
