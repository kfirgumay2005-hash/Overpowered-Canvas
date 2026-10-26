/**
 * Outline (+ optional data block) → canvas data (pure apart from the injected ELK instance).
 *
 * Cards whose id is known keep their position, size and style (from the current canvas, else
 * from the data block) and take the note's text when it changed; lines without an id become
 * new cards placed by the layout engine; known cards missing from the note are deleted; a
 * changed parent re-links the card. Cards the note never knew about (added on the canvas after
 * the export) and drawings are left alone.
 */
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData, EdgeSide } from "../../data/json-canvas";
import { SCHEMA_KEY, SCHEMA_VERSION } from "../../data/schema";
import { computeLayout, type ElkLike, type LayoutDirection, type LayoutOptions } from "../auto-layout/layout";
import { childPosition, directionBetween, logical, type Dir, type TEdge, type TNode } from "../mindmap/tree";
import type { MapLayout, NoteData } from "./note";
import { rootMapLayouts } from "./note";
import { normalizeText, type OutlineItem } from "./outline";
import { estimateSize } from "./size";
import { tidyTree } from "./tidy";
import { isDrawing, nodeText } from "./structure";

export interface ApplyOptions {
	/** Layout for maps that are entirely new (logical: "right" means forward). */
	layout: MapLayout;
	rtl: boolean;
	spacing: number;
	levelSpacing: number;
	newId(): string;
	/** Vault path of the file an `![[embed]]` points to, or null. */
	resolveFile(linktext: string): string | null;
	/** Width of new text cards (height follows the text). */
	textWidth: number;
	fileSize: { width: number; height: number };
}

export interface ApplyResult {
	data: CanvasFileData;
	added: number;
	removed: number;
	updated: number;
	/** Ids of the cards created from lines without an id. */
	created: string[];
}

const SIDE: Record<Dir, EdgeSide> = { right: "right", left: "left", down: "bottom", up: "top" };
const OPPOSITE: Record<Dir, EdgeSide> = { right: "left", left: "right", down: "top", up: "bottom" };
const GAP = 120;

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

const EMBED = /^!\[\[([^\]|#^]+)((?:#|\^)[^\]|]*)?(?:\|[^\]]*)?\]\]$/;
const URL_LINE = /^https?:\/\/\S+$/;

/** Text → the node fields it describes (an embed of a vault file, a web link, or text). */
function contentFields(text: string, resolveFile: ApplyOptions["resolveFile"]): Partial<CanvasNodeData> {
	const t = text.trim();
	const embed = EMBED.exec(t);
	if (embed) {
		const path = resolveFile(embed[1]!.trim());
		if (path) return { type: "file", file: path, ...(embed[2] ? { subpath: embed[2] } : {}) };
	}
	if (URL_LINE.test(t)) return { type: "link", url: t };
	return { type: "text", text };
}

function withContent(node: CanvasNodeData, fields: Partial<CanvasNodeData>): CanvasNodeData {
	const { text: _t, file: _f, subpath: _s, url: _u, ...rest } = node;
	return { ...rest, ...fields } as CanvasNodeData;
}

/** The node with the note's text, or itself when the text didn't change (whitespace aside). */
function updateText(node: CanvasNodeData, text: string, resolveFile: ApplyOptions["resolveFile"]): CanvasNodeData | null {
	if (normalizeText(nodeText(node)) === normalizeText(text)) return null;
	if (node.type === "group") return { ...node, label: text };
	if (node.type === "text") return withContent(node, { type: "text", text });
	const fields = contentFields(text, resolveFile);
	return withContent(node, fields.type === node.type ? fields : { type: "text", text });
}

function layoutOptions(layout: MapLayout, rtl: boolean, spacing: number, levelSpacing: number): LayoutOptions {
	const mirror = (d: LayoutDirection): LayoutDirection => (d === "right" || d === "left" ? logical(d, rtl) : d);
	if (layout === "grid") return { algorithm: "grid", direction: "right", spacing, levelSpacing };
	if (layout.startsWith("layered-")) return { algorithm: "layered", direction: mirror(layout.slice(8) as LayoutDirection), spacing, levelSpacing };
	return { algorithm: "mindmap", direction: mirror(layout as LayoutDirection), spacing, levelSpacing };
}

/** Directional and balanced maps keep outline order (tidy layout); the rest use ELK. */
async function layoutMap(elk: ElkLike, nodes: TNode[], edges: TEdge[], root: string, kids: Map<string, string[]>, layout: MapLayout, opts: ApplyOptions) {
	if (layout === "right" || layout === "left" || layout === "down" || layout === "up" || layout === "balanced") {
		const direction = layout === "right" || layout === "left" ? logical(layout, opts.rtl) : layout;
		return tidyTree(nodes, kids, root, { direction, spacing: opts.spacing, levelSpacing: opts.levelSpacing, rtl: opts.rtl });
	}
	return computeLayout(elk, nodes, edges, layoutOptions(layout, opts.rtl, opts.spacing, opts.levelSpacing));
}

interface Placed {
	id: string;
	parent: string | null;
	group: string | null;
	isNew: boolean;
}

export async function applyNote(items: OutlineItem[], note: NoteData | null, base: CanvasFileData | null, elk: ElkLike, opts: ApplyOptions): Promise<ApplyResult> {
	const aliasToId = new Map<string, string>();
	const fromNote = new Map<string, CanvasNodeData>();
	for (const [alias, n] of Object.entries(note?.nodes ?? {})) {
		aliasToId.set(alias, n.id);
		fromNote.set(n.id, n);
	}
	const idToAlias = new Map([...aliasToId].map(([a, id]) => [id, a]));
	const baseNodes = new Map((base?.nodes ?? []).map((n) => [n.id, n]));
	const known = new Set(fromNote.keys());

	// 1. Walk the outline: resolve ids, update text, create cards.
	const nodes = new Map<string, CanvasNodeData>();
	const placed: Placed[] = [];
	const unplaced = new Set<string>();
	let updated = 0;
	const created: string[] = [];
	const resolve = (alias: string | undefined): CanvasNodeData | undefined => {
		if (!alias) return undefined;
		const id = aliasToId.get(alias) ?? (baseNodes.has(alias) ? alias : undefined);
		if (!id || nodes.has(id)) return undefined;
		return baseNodes.get(id) ?? fromNote.get(id);
	};
	const walk = (list: OutlineItem[], parent: string | null, group: string | null) => {
		for (const item of list) {
			if (item.kind === "free") {
				walk(item.children, null, group);
				continue;
			}
			const existing = resolve(item.id);
			if (item.kind === "group" && existing?.type === "group") {
				const next = updateText(existing, item.text, opts.resolveFile);
				if (next) updated++;
				nodes.set(existing.id, next ?? existing);
				walk(item.children, null, existing.id);
				continue;
			}
			// A group the canvas no longer has (or no data block): keep what is inside, drop the heading.
			if (item.kind === "group") {
				walk(item.children, null, group);
				continue;
			}
			if (existing && existing.type !== "group" && !isDrawing(existing)) {
				const next = updateText(existing, item.text, opts.resolveFile);
				if (next) updated++;
				nodes.set(existing.id, next ?? existing);
				placed.push({ id: existing.id, parent, group, isNew: false });
				walk(item.children, existing.id, group);
				continue;
			}
			if (!item.text.trim() && item.children.length === 0) continue;
			const fields = contentFields(item.text, opts.resolveFile);
			const size = fields.type === "file" ? opts.fileSize : estimateSize(fields.type === "link" ? (fields.url ?? "") : item.text, opts.textWidth);
			const id = opts.newId();
			nodes.set(id, { id, x: 0, y: 0, width: size.width, height: size.height, ...fields } as CanvasNodeData);
			unplaced.add(id);
			created.push(id);
			placed.push({ id, parent, group, isNew: true });
			walk(item.children, id, group);
		}
	};
	walk(items, null, null);
	const placedById = new Map(placed.map((p) => [p.id, p]));

	// 2. Final node list: kept, deleted, untouched.
	const out: CanvasNodeData[] = [];
	let removed = 0;
	const removedIds = new Set<string>();
	if (base) {
		for (const n of base.nodes ?? []) {
			if (nodes.has(n.id)) out.push(nodes.get(n.id)!);
			else if (known.has(n.id)) {
				removed++;
				removedIds.add(n.id);
			} else out.push(n);
		}
	} else {
		const rank = new Map((note?.order ?? []).map((id, i) => [id, i]));
		const drawings = note?.drawings ?? [];
		const ordered = [...drawings, ...[...nodes.values()].filter((n) => !unplaced.has(n.id))].sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
		out.push(...ordered);
		for (const id of known) if (!nodes.has(id)) removedIds.add(id);
	}
	const recreated = base ? [...nodes.values()].filter((n) => !unplaced.has(n.id) && !baseNodes.has(n.id)) : [];
	out.push(...recreated);
	for (const id of created) out.push(nodes.get(id)!);
	const outById = new Map(out.map((n) => [n.id, n]));
	const added = created.length + recreated.length;

	// 3. Edges: keep the edge behind every outline link, create missing ones, drop stale tree edges.
	const edges: CanvasEdgeData[] = base ? [...(base.edges ?? [])] : [...Object.values(note?.edges ?? {}), ...(note?.crossEdges ?? [])];
	const treeIds = new Set(Object.values(note?.edges ?? {}).map((e) => e.id));
	const oldParent = new Map<string, string>();
	for (const [alias, e] of Object.entries(note?.edges ?? {})) {
		const child = aliasToId.get(alias);
		if (child) oldParent.set(child, e.fromNode === child ? e.toNode : e.fromNode);
	}
	const used = new Set<string>();
	const fresh: CanvasEdgeData[] = [];
	const links = (e: CanvasEdgeData, a: string, b: string) => (e.fromNode === a && e.toNode === b) || (e.fromNode === b && e.toNode === a);
	for (const p of placed) {
		if (!p.parent) continue;
		const alias = idToAlias.get(p.id);
		const preferred = alias ? note?.edges?.[alias] : undefined;
		const edge =
			(preferred && edges.find((e) => e.id === preferred.id && !used.has(e.id) && links(e, p.parent!, p.id))) ||
			edges.find((e) => !used.has(e.id) && links(e, p.parent!, p.id));
		if (edge) used.add(edge.id);
		else {
			const color = outById.get(p.parent)?.color;
			fresh.push({ id: opts.newId(), fromNode: p.parent, fromSide: "right", toNode: p.id, toSide: "left", ...(color ? { color } : {}) });
		}
	}
	const finalEdges = [...edges.filter((e) => outById.has(e.fromNode) && outById.has(e.toNode) && (used.has(e.id) || !treeIds.has(e.id))), ...fresh];

	// 4. Which maps changed shape, and how each is arranged.
	const rootOf = (id: string): string => {
		let cur = placedById.get(id);
		while (cur?.parent) cur = placedById.get(cur.parent);
		return cur?.id ?? id;
	};
	const dirty = new Set<string>();
	for (const p of placed) if (p.isNew || (oldParent.get(p.id) ?? null) !== p.parent) dirty.add(rootOf(p.id));
	for (const id of removedIds) {
		const parent = oldParent.get(id);
		if (parent && placedById.has(parent)) dirty.add(rootOf(parent));
	}
	const rootData = { ...(base ? stripNodesEdges(base) : (note?.root ?? {})) };
	const layouts = { ...rootMapLayouts(rootData) };
	for (const [alias, m] of Object.entries(note?.maps ?? {})) {
		const id = aliasToId.get(alias);
		if (!id) continue;
		if (m.layout === "free") delete layouts[id];
		else layouts[id] = m.layout;
	}
	const kids = new Map<string, string[]>();
	for (const p of placed) if (p.parent) (kids.get(p.parent) ?? kids.set(p.parent, []).get(p.parent)!).push(p.id);
	const subtree = (root: string): string[] => {
		const ids: string[] = [];
		const stack = [root];
		while (stack.length) {
			const id = stack.pop()!;
			ids.push(id);
			stack.push(...(kids.get(id) ?? []));
		}
		return ids;
	};

	const relaid = new Set<string>();
	/** Which way each re-arranged card's map grows: its edges attach on those sides. */
	const mapGrowth = new Map<string, Dir | "balanced">();
	const box =(id: string) => outById.get(id)!;
	const roots = placed.filter((p) => !p.parent).map((p) => p.id);
	const blocks: { ids: string[]; group: string | null }[] = [];
	for (const root of roots) {
		const isNewRoot = unplaced.has(root);
		if (isNewRoot && !layouts[root] && (kids.get(root)?.length ?? 0) > 0) layouts[root] = opts.layout;
		const layout = layouts[root];
		const ids = subtree(root);
		if (!layout || !(dirty.has(root) || isNewRoot) || ids.length < 2) {
			if (isNewRoot && ids.length === 1) blocks.push({ ids, group: placedById.get(root)!.group });
			continue;
		}
		const tnodes: TNode[] = ids.map((id) => {
			const n = box(id);
			return { id, x: n.x, y: n.y, width: n.width, height: n.height };
		});
		const tedges: TEdge[] = ids.filter((id) => id !== root).map((id) => ({ from: placedById.get(id)!.parent!, to: id }));
		const positions = await layoutMap(elk, tnodes, tedges, root, kids, layout, opts);
		const growth = layout === "right" || layout === "left" ? logical(layout, opts.rtl) : layout === "down" || layout === "up" || layout === "balanced" ? layout : null;
		for (const id of ids) {
			const p = positions.get(id);
			if (p) outById.set(id, { ...box(id), x: p.x, y: p.y });
			relaid.add(id);
			if (growth) mapGrowth.set(id, growth);
		}
		// A new map moves as one block later; cards added to an existing map are placed now.
		if (isNewRoot) blocks.push({ ids, group: placedById.get(root)!.group });
		else for (const id of ids) unplaced.delete(id);
	}

	// 5. New cards in hand-arranged maps go beside their parent, after its other children.
	for (const p of placed) {
		if (!unplaced.has(p.id) || !p.parent || relaid.has(p.id)) continue;
		const parent = box(p.parent);
		const siblings = (kids.get(p.parent) ?? []).filter((id) => id !== p.id && !unplaced.has(id)).map(box);
		const grand = placedById.get(p.parent)?.parent;
		const dir: Dir = siblings.length ? directionBetween(asT(parent), asT(siblings[0]!)) : grand && !unplaced.has(grand) ? directionBetween(asT(box(grand)), asT(parent)) : logical("right", opts.rtl);
		const pos = childPosition(asT(parent), siblings.map(asT), box(p.id), dir);
		outById.set(p.id, { ...box(p.id), x: Math.round(pos.x), y: Math.round(pos.y) });
		unplaced.delete(p.id);
	}

	// 6. New maps and free cards: into their group (which grows to fit), else below everything.
	placeBlocks(blocks, outById, unplaced, opts.rtl);

	// 7. Edge sides follow the layout for new links and re-arranged maps.
	const freshIds = new Set(fresh.map((e) => e.id));
	const edgesOut = finalEdges.map((e) => {
		const touched = freshIds.has(e.id) || (relaid.has(e.fromNode) && relaid.has(e.toNode) && used.has(e.id));
		if (!touched) return e;
		const floating = isPlainObject(e[SCHEMA_KEY]) && isPlainObject((e[SCHEMA_KEY] as Record<string, unknown>).floating) ? ((e[SCHEMA_KEY] as Record<string, unknown>).floating as { from?: boolean; to?: boolean }) : {};
		// Sides for parent → child, from the map's growth direction when it has one.
		const reversed = placedById.get(e.fromNode)?.parent === e.toNode;
		const parent = outById.get(reversed ? e.toNode : e.fromNode)!;
		const child = outById.get(reversed ? e.fromNode : e.toNode)!;
		const growth = mapGrowth.get(child.id);
		const dir: Dir =
			growth === "balanced" ? (child.x + child.width / 2 >= parent.x + parent.width / 2 ? "right" : "left") : (growth ?? directionBetween(asT(parent), asT(child)));
		const [fromSide, toSide] = reversed ? [OPPOSITE[dir], SIDE[dir]] : [SIDE[dir], OPPOSITE[dir]];
		return { ...e, fromSide: floating.from ? e.fromSide : fromSide, toSide: floating.to ? e.toSide : toSide };
	});

	// 8. Root data: map layouts follow the note; entries of deleted cards go.
	for (const id of Object.keys(layouts)) if (!outById.has(id)) delete layouts[id];
	const extra = isPlainObject(rootData[SCHEMA_KEY]) ? { ...(rootData[SCHEMA_KEY] as Record<string, unknown>) } : null;
	if (Object.keys(layouts).length) rootData[SCHEMA_KEY] = { ...(extra ?? { v: SCHEMA_VERSION }), mapLayouts: layouts };
	else if (extra) {
		delete extra.mapLayouts;
		rootData[SCHEMA_KEY] = extra;
	}

	const finalNodes = out.map((n) => outById.get(n.id)!);
	return { data: { ...rootData, nodes: finalNodes, edges: edgesOut }, added, removed, updated, created };
}

function stripNodesEdges(data: CanvasFileData): Record<string, unknown> {
	const { nodes: _n, edges: _e, ...rest } = data;
	return rest;
}

function asT(n: CanvasNodeData): TNode {
	return { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
}

interface BBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

function bboxOf(list: CanvasNodeData[]): BBox | null {
	if (!list.length) return null;
	return {
		minX: Math.min(...list.map((n) => n.x)),
		minY: Math.min(...list.map((n) => n.y)),
		maxX: Math.max(...list.map((n) => n.x + n.width)),
		maxY: Math.max(...list.map((n) => n.y + n.height)),
	};
}

/**
 * Places new maps (already laid out relative to each other) and new free cards. Maps stack
 * downwards; free cards of the same place share a row-wrapped grid.
 */
function placeBlocks(blocks: { ids: string[]; group: string | null }[], nodes: Map<string, CanvasNodeData>, unplaced: Set<string>, rtl: boolean): void {
	const settled = () => [...nodes.values()].filter((n) => !unplaced.has(n.id));
	const singles = new Map<string | null, string[]>();
	const maps: { ids: string[]; group: string | null }[] = [];
	for (const b of blocks) {
		if (b.ids.length === 1) (singles.get(b.group) ?? singles.set(b.group, []).get(b.group)!).push(b.ids[0]!);
		else maps.push(b);
	}
	// Free cards become one grid block per place.
	const gridBlocks = [...singles].map(([group, ids]) => {
		const cols = Math.min(4, ids.length);
		const colWidth = Math.max(...ids.map((id) => nodes.get(id)!.width)) + 40;
		let y = 0;
		for (let row = 0; row * cols < ids.length; row++) {
			const rowIds = ids.slice(row * cols, row * cols + cols);
			rowIds.forEach((id, i) => {
				const n = nodes.get(id)!;
				nodes.set(id, { ...n, x: rtl ? -(i * colWidth) - n.width : i * colWidth, y });
			});
			y += Math.max(...rowIds.map((id) => nodes.get(id)!.height)) + 40;
		}
		return { ids, group };
	});

	for (const block of [...maps, ...gridBlocks]) {
		const members = block.ids.map((id) => nodes.get(id)!);
		const b = bboxOf(members)!;
		const group = block.group ? nodes.get(block.group) : undefined;
		let x: number;
		let y: number;
		if (group) {
			const inside = settled().filter((n) => n.id !== group.id && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height);
			const ib = bboxOf(inside);
			y = ib ? ib.maxY + 60 : group.y + 60;
			x = rtl ? group.x + group.width - 40 - (b.maxX - b.minX) : group.x + 40;
		} else {
			const all = bboxOf(settled());
			y = all ? all.maxY + GAP * 2 : 0;
			x = all ? (rtl ? all.maxX - (b.maxX - b.minX) : all.minX) : 0;
		}
		const dx = Math.round(x - b.minX);
		const dy = Math.round(y - b.minY);
		for (const n of members) {
			nodes.set(n.id, { ...nodes.get(n.id)!, x: n.x + dx, y: n.y + dy });
			unplaced.delete(n.id);
		}
		if (group) {
			const moved = bboxOf(block.ids.map((id) => nodes.get(id)!))!;
			const width = Math.max(group.width, moved.maxX + 40 - group.x);
			const height = Math.max(group.height, moved.maxY + 40 - group.y);
			// Right-to-left content may reach past the group's left side: grow that way too.
			const left = Math.min(group.x, moved.minX - 40);
			nodes.set(group.id, { ...group, x: left, width: width + (group.x - left), height });
		}
	}
}

