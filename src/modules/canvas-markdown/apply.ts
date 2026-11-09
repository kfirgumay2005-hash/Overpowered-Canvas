/**
 * Outline (+ optional data block) → canvas data (pure apart from the injected ELK instance).
 *
 * Cards whose id is known keep their position, size and style (from the current canvas, else
 * from the data block) and take the note's text when it changed; lines without an id become
 * new cards placed by the layout engine; known cards missing from the note are deleted; a
 * changed parent re-links the card. Cards the note never knew about (added on the canvas after
 * the export) and drawings are left alone.
 */
import { pruneOrder } from "../mindmap/order";
import { autoHeader, headingMarks, NOT_HEADER, type AutoHeaders } from "./headers";
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData, EdgeSide } from "../../data/json-canvas";
import { SCHEMA_KEY, SCHEMA_VERSION } from "../../data/schema";
import { computeLayout, type ElkLike, type LayoutDirection, type LayoutOptions } from "../auto-layout/layout";
import { childPosition, directionBetween, logical, type Dir, type TEdge, type TNode } from "../mindmap/tree";
import type { MapLayout, NoteData } from "./note";
import { rootMapLayouts } from "./note";
import { normalizeText, type OutlineItem } from "./outline";
import { inlinePageLinks, outlinePageLinks, pageLinkTargets } from "./page-links";
import { estimateSize } from "./size";
import { tidyTree } from "./tidy";
import { isDrawing, nodeText, orderChildren, pageOfNode, pagesOfRoot } from "./structure";

export interface ApplyOptions {
	/** Layout for maps that are entirely new (logical: "right" means forward). */
	layout: MapLayout;
	rtl: boolean;
	spacing: number;
	levelSpacing: number;
	newId(): string;
	/** Vault path of the file an `![[embed]]` points to, or null. */
	resolveFile: (linktext: string) => string | null;
	/** Width of new text cards (height follows the text). */
	textWidth: number;
	fileSize: { width: number; height: number };
	/** Automatic header rules (see headers.ts): headings they make are not stored on the cards. */
	autoHeaders?: AutoHeaders | null;
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
	return { ...rest, ...fields };
}

/**
 * The node with the note's text, or itself when the text didn't change (whitespace aside, and the
 * links to its page written at the end of its line, see page-links.ts).
 */
function updateText(node: CanvasNodeData, text: string, resolveFile: ApplyOptions["resolveFile"], linkTargets: ReadonlySet<string> = new Set()): CanvasNodeData | null {
	if (normalizeText(nodeText(node)) === normalizeText(text)) return null;
	if (normalizeText(inlinePageLinks(nodeText(node), linkTargets)) === normalizeText(text)) return null;
	text = outlinePageLinks(text, linkTargets);
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
export async function layoutMap(elk: ElkLike, nodes: TNode[], edges: TEdge[], root: string, kids: Map<string, string[]>, layout: MapLayout, opts: Pick<ApplyOptions, "rtl" | "spacing" | "levelSpacing">) {
	if (layout === "right" || layout === "left" || layout === "down" || layout === "up" || layout === "balanced") {
		const direction = layout === "right" || layout === "left" ? logical(layout, opts.rtl) : layout;
		return tidyTree(nodes, kids, root, { direction, spacing: opts.spacing, levelSpacing: opts.levelSpacing, rtl: opts.rtl });
	}
	// Radial maps too go around in the given order (the outline's, or the map's stored one).
	return computeLayout(elk, nodes, edges, { ...layoutOptions(layout, opts.rtl, opts.spacing, opts.levelSpacing), order: Object.fromEntries(kids), rtl: opts.rtl });
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
	// A page's root card heads a map of its own, wherever the note nests it.
	const pageRefs = pagesOfRoot(base ?? note?.root);
	const pageRoots = new Set(pageRefs.map((p) => p.root));
	const linkTargets = pageLinkTargets(pageRefs);
	const known = new Set(fromNote.keys());
	// The outline parent each known card had when the note was written.
	const oldParent = new Map<string, string>();
	for (const [alias, e] of Object.entries(note?.edges ?? {})) {
		const child = aliasToId.get(alias);
		if (child) oldParent.set(child, e.fromNode === child ? e.toNode : e.fromNode);
	}

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
	/**
	 * Header cards (see headers.ts): a heading under a card's heading is a header card, at the
	 * automatic level (0) or one of its own; a card written as a plain line under a heading where
	 * it could have been one isn't a header any more. Cards whose text carries the marks keep them,
	 * at the level the note gives.
	 */
	const headerFor = (item: OutlineItem, parent: string | null, parentLevel: number | undefined, pageRoot: boolean, depth: number): number | null | undefined => {
		if (!parent || pageRoot || parentLevel === undefined) return undefined;
		// What the automatic rules make of this card, as the note has it.
		const byRule = autoHeader(opts.autoHeaders, item.children.length, depth);
		if (item.heading !== undefined) {
			const auto = item.heading === parentLevel + 1;
			// A heading the rules make anyway is nothing of the card's own (no level stored).
			if (auto && byRule) return null;
			return auto ? 0 : item.heading;
		}
		// A plain line where the rules would make a heading: this card is never a header.
		if (byRule) return NOT_HEADER;
		return parentLevel < 6 ? null : undefined;
	};
	const textFor = (item: OutlineItem, existing: CanvasNodeData | undefined, header: number | null | undefined): string => {
		const marks = existing?.type === "text" && typeof existing.text === "string" ? headingMarks(existing.text) : 0;
		if (!marks || item.heading === undefined) return item.text;
		// A map's root keeps its own marks; a header card's marks follow the level in the note.
		return `${"#".repeat(header === undefined ? marks : item.heading)} ${item.text}`;
	};
	const markHeader = (node: CanvasNodeData, header: number | null | undefined): CanvasNodeData => {
		if (header === undefined || (node.type === "text" && typeof node.text === "string" && headingMarks(node.text))) return node;
		const extra = isPlainObject(node[SCHEMA_KEY]) ? node[SCHEMA_KEY] : undefined;
		const had = typeof extra?.header === "number" ? extra.header : undefined;
		const want = header === null ? undefined : header;
		if (had === want) return node;
		const { header: _old, ...rest } = extra ?? { v: SCHEMA_VERSION };
		return { ...node, [SCHEMA_KEY]: want === undefined ? rest : { ...rest, header: want } };
	};
	/** Where each card was placed (its outline parent), and which cards are headings in the note. */
	const placedParent = new Map<string, string | null>();
	const headingCards = new Set<string>();
	/** Header cards put back under the plain line they were lifted out from (see headers.ts). */
	const lifted = new Set<string>();
	/**
	 * A header card the export lifted out of the outline sits under the nearest heading in the
	 * note; on the board it stays under the card it had, when that card is still in this
	 * heading's outline (only plain lines between them and the heading).
	 */
	const parentOf = (item: OutlineItem, id: string, parent: string | null): string | null => {
		const old = oldParent.get(id);
		if (!parent || item.heading === undefined || !old || old === parent || old === id || !placedParent.has(old)) return parent;
		for (let cur: string | null | undefined = old; cur !== parent; cur = placedParent.get(cur)) if (!cur || headingCards.has(cur)) return parent;
		lifted.add(id);
		return old;
	};
	const walk = (list: OutlineItem[], parent: string | null, group: string | null, parentLevel?: number, depth = 1) => {
		for (const item of list) {
			if (item.kind === "free") {
				walk(item.children, null, group);
				continue;
			}
			const existing = resolve(item.id);
			if (item.kind === "group" && existing?.type === "group") {
				const next = updateText(existing, item.text, opts.resolveFile, linkTargets);
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
				const header = headerFor(item, parent, parentLevel, pageRoots.has(existing.id), depth);
				const next = updateText(existing, textFor(item, existing, header), opts.resolveFile, linkTargets);
				const marked = markHeader(next ?? existing, header);
				if (next || marked !== (next ?? existing)) updated++;
				nodes.set(existing.id, marked);
				const at = pageRoots.has(existing.id) ? null : parentOf(item, existing.id, parent);
				placed.push({ id: existing.id, parent: at, group, isNew: false });
				placedParent.set(existing.id, at);
				if (item.heading !== undefined) headingCards.add(existing.id);
				walk(item.children, existing.id, group, item.heading, pageRoots.has(existing.id) ? 2 : depth + 1);
				continue;
			}
			if (!item.text.trim() && item.children.length === 0) continue;
			const fields = contentFields(item.text, opts.resolveFile);
			const size = fields.type === "file" ? opts.fileSize : estimateSize(fields.type === "link" ? (fields.url ?? "") : item.text, opts.textWidth);
			const id = opts.newId();
			// A new line under a card of a page belongs to that page; in a note with pages, a new
			// line of its own belongs to the page whose section it is in.
			const page = parent && nodes.get(parent) ? pageOfNode(nodes.get(parent)!) : section;
			const fresh = { id, x: 0, y: 0, width: size.width, height: size.height, ...fields, ...(page ? { [SCHEMA_KEY]: { v: SCHEMA_VERSION, page } } : {}) } as CanvasNodeData;
			const header = headerFor(item, parent, parentLevel, false, depth);
			nodes.set(id, header ? markHeader(fresh, header) : header === 0 ? markHeader(fresh, 0) : fresh);
			unplaced.add(id);
			created.push(id);
			placed.push({ id, parent, group, isNew: true });
			placedParent.set(id, parent);
			if (item.heading !== undefined) headingCards.add(id);
			walk(item.children, id, group, item.heading, depth + 1);
		}
	};
	// In a note with pages, each page's section starts with its root: what follows is on that page.
	let section = "";
	const knownPages = new Set(pagesOfRoot(base ? (base as unknown as Record<string, unknown>) : note?.root).map((p) => p.id));
	for (const item of items) {
		if (note?.paged && item.kind !== "free" && item.id) {
			const id = aliasToId.get(item.id) ?? (baseNodes.has(item.id) ? item.id : undefined);
			const node = id ? (baseNodes.get(id) ?? fromNote.get(id)) : undefined;
			if (node) section = knownPages.has(pageOfNode(node)) ? pageOfNode(node) : "";
		}
		walk([item], null, null);
	}
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
	/** A card's children as they were when the note was written, in the board's order. */
	const originalOrder = (parent: string): string[] => {
		const was = (id: string) => baseNodes.get(id) ?? fromNote.get(id);
		const parentNode = was(parent);
		const siblings = [...oldParent].filter(([child, p]) => p === parent && was(child)).map(([child]) => was(child)!);
		if (!parentNode) return siblings.map((n) => n.id);
		const before: Record<string, unknown> | undefined = base ?? note?.root;
		const stored = isPlainObject(before?.[SCHEMA_KEY]) && isPlainObject(before[SCHEMA_KEY].childOrder) ? (before[SCHEMA_KEY].childOrder as Record<string, string[]>)[parent] : undefined;
		return orderChildren(parentNode, siblings, opts.rtl, stored).map((n) => n.id);
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
	/**
	 * Under a heading, the note lists the plain lines first and the sub-headings after them
	 * (headers.ts): children read back in exactly that split of their old order are in their old
	 * order, not moved by hand. New lines stay after the line they follow in the note.
	 */
	for (const [parent, list] of kids) {
		if (!headingCards.has(parent)) continue;
		const orig = originalOrder(parent).filter((id) => list.includes(id));
		if (orig.length < 2) continue;
		const split = [...orig.filter((id) => !headingCards.has(id)), ...orig.filter((id) => headingCards.has(id))];
		const inNote = list.filter((id) => orig.includes(id));
		if (split.join() !== inNote.join() || split.join() === orig.join()) continue;
		const out = [...orig];
		list.forEach((id, i) => {
			if (orig.includes(id)) return;
			const after = list.slice(0, i).reverse().find((k) => out.includes(k));
			out.splice(after ? out.indexOf(after) + 1 : 0, 0, id);
		});
		list.splice(0, list.length, ...out);
	}
	// A lifted header goes back to its place among its siblings (the note lists it after them).
	for (const id of lifted) {
		const parent = placedById.get(id)!.parent!;
		const list = kids.get(parent)!;
		const before = originalOrder(parent).filter((k) => k === id || list.includes(k));
		const next = before.slice(before.indexOf(id) + 1).find((k) => k !== id && !lifted.has(k));
		list.splice(list.indexOf(id), 1);
		list.splice(next ? list.indexOf(next) : list.length, 0, id);
	}
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
		const floating = isPlainObject(e[SCHEMA_KEY]) && isPlainObject(e[SCHEMA_KEY].floating) ? (e[SCHEMA_KEY].floating as { from?: boolean; to?: boolean }) : {};
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

	// 8. Root data: map layouts and sibling order follow the note; entries of deleted cards go.
	for (const id of Object.keys(layouts)) if (!outById.has(id)) delete layouts[id];
	const extra = isPlainObject(rootData[SCHEMA_KEY]) ? { ...rootData[SCHEMA_KEY] } : null;
	const order: Record<string, string[]> = { ...(isPlainObject(extra?.childOrder) ? (extra.childOrder as Record<string, string[]>) : {}) };
	// Stored where the board alone would read another order (or where one was kept before).
	for (const p of placed) {
		const list = kids.get(p.id) ?? [];
		const byBoard = orderChildren(box(p.id), list.map(box), opts.rtl).map((n) => n.id);
		if (list.length > 1 && (order[p.id] || byBoard.join() !== list.join())) order[p.id] = list;
		else delete order[p.id];
	}
	const childOrder = pruneOrder(order, (id) => outById.has(id));
	const next: Record<string, unknown> = { ...(extra ?? { v: SCHEMA_VERSION }) };
	if (Object.keys(layouts).length) next.mapLayouts = layouts;
	else delete next.mapLayouts;
	if (childOrder) next.childOrder = childOrder;
	else delete next.childOrder;
	if (extra || next.mapLayouts || next.childOrder) rootData[SCHEMA_KEY] = next;

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

