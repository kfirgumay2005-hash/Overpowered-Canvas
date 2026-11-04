/**
 * Canvas data → outline structure (pure). Every connected set of cards is a map: its root
 * becomes a heading, the rest nested bullets along a spanning tree. Edges outside the tree are
 * "cross edges"; cards without edges are listed as free cards; groups become headings around
 * the maps and cards inside them; drawings (ink, free lines, infinite lines) stay out of the text.
 * Pages (a branch moved to its own page) follow the card they come from: a heading one level
 * below the map holding that card, or, past the sixth level, nested bullets under the card.
 */
import type { CanvasFileData, CanvasNodeData } from "../../data/json-canvas";
import { followStored, type ChildOrder } from "../mindmap/order";
import type { TNode } from "../mindmap/tree";
import type { OutlineItem } from "./outline";
import { extractHeaders, headerOf } from "./headers";
import { inlinePageLinks, pageLinkTargets } from "./page-links";

/** Node kinds that are drawings, not text: kept only in the data block. */
const DRAWING_KINDS: ReadonlySet<string> = new Set(["ink", "line", "guide"]);

export interface Structure {
	items: OutlineItem[];
	/** Canvas id → alias written in the note. */
	alias: Map<string, string>;
	/** Child id → id of the edge that links it to its outline parent. */
	treeEdges: Map<string, string>;
	/** Edge ids outside the spanning trees. */
	crossEdges: string[];
	/** Drawing node ids. */
	drawings: string[];
	/** Map root ids, in outline order. */
	roots: string[];
}

export interface StructureOptions {
	rtl: boolean;
	/** Heading text of the free-cards list. */
	freeLabel: string;
	/** Only these node ids (a selection); default: every node. */
	scope?: ReadonlySet<string>;
	/**
	 * Pages as sections of their own, one after the other (main page first, then each page before
	 * its own pages), each starting with its root as a top heading. Without it, each page's map
	 * nests under the card it comes from.
	 */
	paged?: boolean;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function kindOf(node: CanvasNodeData): string | undefined {
	const extra = node["x-opc"];
	return isPlainObject(extra) && typeof extra.kind === "string" ? extra.kind : undefined;
}

/** The map's stored child order (root x-opc `childOrder`); empty when there is none. */
export function childOrderOf(data: CanvasFileData): ChildOrder {
	const extra = data["x-opc"];
	const raw = isPlainObject(extra) ? extra.childOrder : undefined;
	return isPlainObject(raw) ? (raw as ChildOrder) : {};
}

/** The page a node is on ("" = the main page). */
export function pageOfNode(node: CanvasNodeData): string {
	const extra = node["x-opc"];
	return isPlainObject(extra) && typeof extra.page === "string" ? extra.page : "";
}

export interface PageRef {
	id: string;
	anchor: string;
	root: string;
	parent?: string;
}

/** The pages listed in a canvas root (x-opc `pages`). */
export function pagesOfRoot(root: Record<string, unknown> | undefined): PageRef[] {
	const extra = root?.["x-opc"];
	const list = isPlainObject(extra) && Array.isArray(extra.pages) ? extra.pages : [];
	return list.filter((p): p is PageRef => isPlainObject(p) && typeof p.id === "string" && typeof p.anchor === "string" && typeof p.root === "string");
}

export function isDrawing(node: CanvasNodeData): boolean {
	return node.type === "text" && DRAWING_KINDS.has(kindOf(node) ?? "");
}

/** The text a card shows in the outline. */
export function nodeText(node: CanvasNodeData): string {
	if (node.type === "file") return `![[${node.file ?? ""}${node.subpath ?? ""}]]`;
	if (node.type === "link") return node.url ?? "";
	if (node.type === "group") return node.label ?? "";
	return typeof node.text === "string" ? node.text : "";
}

/** Shortest unique id prefixes (at least 4 characters); ids with unusual characters get "x<n>". */
export function makeAliases(ids: string[]): Map<string, string> {
	const out = new Map<string, string>();
	const plain = [...new Set(ids.filter((id) => /^[A-Za-z0-9_-]+$/.test(id)))].sort();
	const lcp = (a: string, b: string) => {
		let i = 0;
		while (i < a.length && i < b.length && a[i] === b[i]) i++;
		return i;
	};
	plain.forEach((id, i) => {
		const prev = i > 0 ? lcp(id, plain[i - 1]!) : 0;
		const next = i < plain.length - 1 ? lcp(id, plain[i + 1]!) : 0;
		out.set(id, id.slice(0, Math.min(id.length, Math.max(4, prev + 1, next + 1))));
	});
	const taken = new Set(out.values());
	let n = 0;
	for (const id of ids) {
		if (out.has(id)) continue;
		while (taken.has(`x${n}`)) n++;
		out.set(id, `x${n}`);
		taken.add(`x${n}`);
	}
	return out;
}

type Box = Pick<TNode, "x" | "y" | "width" | "height">;

/** The way a map's children follow each other: down the side (left / right maps) or across (up / down maps). */
export type MapAxis = "sideways" | "vertical";

/** The axis of a recorded map layout (none for radial, layered, grid and free maps, or the root of a balanced one). */
export function axisOf(layout: string | undefined, isRoot = false): MapAxis | undefined {
	if (layout === "right" || layout === "left" || (layout === "balanced" && !isRoot)) return "sideways";
	if (layout === "up" || layout === "down") return "vertical";
	return undefined;
}

const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

/** Top-to-bottom, then by reading direction. */
export function readingOrder(rtl: boolean) {
	return (a: Box, b: Box) => a.y - b.y || (rtl ? b.x + b.width - (a.x + a.width) : a.x - b.x);
}

/**
 * Orders children so the outline reads like the map: top to bottom when they sit beside the
 * parent, along the reading direction when above or below it, clockwise from 12 o'clock
 * (counter-clockwise in right-to-left canvases) when they surround it. With `stored` (the
 * parent's list in the map's child order), that order wins; children it doesn't name keep their
 * board place (see followStored). `axis`: the way the map grows (from its recorded layout),
 * which settles cards that sit both beside and above / below their parent.
 */
export function orderChildren<T extends Box & { id?: string }>(parent: Box, kids: T[], rtl: boolean, stored?: readonly string[], axis?: MapAxis): T[] {
	if (kids.length < 2) return [...kids];
	if (stored?.length) return followStored(orderChildren(parent, kids, rtl, undefined, axis) as (T & { id: string })[], stored);
	// A whole side of the parent, judged by edges (wide trees reach far across).
	const sideways = axis === "sideways" || (axis !== "vertical" && (kids.every((k) => k.x >= parent.x + parent.width) || kids.every((k) => k.x + k.width <= parent.x)));
	const vertical = axis === "vertical" || kids.every((k) => k.y >= parent.y + parent.height) || kids.every((k) => k.y + k.height <= parent.y);
	if (sideways) return [...kids].sort((a, b) => center(a).y - center(b).y || center(a).x - center(b).x);
	if (vertical) return [...kids].sort((a, b) => (rtl ? center(b).x - center(a).x : center(a).x - center(b).x) || center(a).y - center(b).y);
	const pc = center(parent);
	const angle = (k: Box) => {
		const dx = center(k).x - pc.x;
		const dy = center(k).y - pc.y;
		return (Math.atan2(rtl ? -dx : dx, -dy) + 2 * Math.PI) % (2 * Math.PI);
	};
	return [...kids].sort((a, b) => angle(a) - angle(b));
}

function contains(outer: Box, inner: Box): boolean {
	return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/** Smallest group fully containing each node (groups included, never themselves). */
export function containers(nodes: CanvasNodeData[]): Map<string, string> {
	const groups = nodes.filter((n) => n.type === "group").sort((a, b) => a.width * a.height - b.width * b.height);
	const out = new Map<string, string>();
	for (const n of nodes) {
		const g = groups.find((g) => g.id !== n.id && contains(g, n) && !(n.type === "group" && g.width * g.height <= n.width * n.height));
		if (g) out.set(n.id, g.id);
	}
	return out;
}

export function buildStructure(data: CanvasFileData, opts: StructureOptions): Structure {
	const all = (data.nodes ?? []).filter((n) => !opts.scope || opts.scope.has(n.id));
	const byId = new Map(all.map((n) => [n.id, n]));
	const drawings = all.filter(isDrawing).map((n) => n.id);
	const content = all.filter((n) => n.type !== "group" && !isDrawing(n));
	const contentIds = new Set(content.map((n) => n.id));
	const groups = all.filter((n) => n.type === "group");
	const edges = (data.edges ?? []).filter((e) => byId.has(e.fromNode) && byId.has(e.toNode));
	// Links between pages are cross edges: each page's map is a tree of its own.
	const samePage = (a: string, b: string) => pageOfNode(byId.get(a)!) === pageOfNode(byId.get(b)!);
	const treeLike = edges.filter((e) => contentIds.has(e.fromNode) && contentIds.has(e.toNode) && e.fromNode !== e.toNode && samePage(e.fromNode, e.toNode));
	const alias = makeAliases([...content, ...groups].map((n) => n.id));
	const order = readingOrder(opts.rtl);

	// Connected components (union-find).
	const up = new Map<string, string>();
	const find = (id: string): string => {
		let r = id;
		while (up.get(r) !== r) r = up.get(r)!;
		up.set(id, r);
		return r;
	};
	for (const n of content) up.set(n.id, n.id);
	for (const e of treeLike) up.set(find(e.fromNode), find(e.toNode));
	const components = new Map<string, string[]>();
	for (const n of content) {
		const r = find(n.id);
		const list = components.get(r) ?? [];
		list.push(n.id);
		components.set(r, list);
	}

	const out = new Map<string, string[]>();
	const inc = new Map<string, string[]>();
	for (const e of treeLike) {
		(out.get(e.fromNode) ?? out.set(e.fromNode, []).get(e.fromNode)!).push(e.id);
		(inc.get(e.toNode) ?? inc.set(e.toNode, []).get(e.toNode)!).push(e.id);
	}
	const edgeById = new Map(edges.map((e) => [e.id, e]));
	const reach = (id: string) => {
		const seen = new Set([id]);
		const queue = [id];
		while (queue.length) for (const eid of out.get(queue.shift()!) ?? []) {
			const to = edgeById.get(eid)!.toNode;
			if (!seen.has(to)) {
				seen.add(to);
				queue.push(to);
			}
		}
		return seen.size;
	};

	const treeEdges = new Map<string, string>();
	const children = new Map<string, string[]>();
	const roots: string[] = [];
	const free: string[] = [];
	for (const ids of components.values()) {
		if (ids.length === 1) {
			free.push(ids[0]!);
			continue;
		}
		const sources = ids.filter((id) => !(inc.get(id)?.length));
		const candidates = (sources.length ? sources : ids).map((id) => ({ id, reach: reach(id), node: byId.get(id)! }));
		candidates.sort((a, b) => b.reach - a.reach || order(a.node, b.node));
		const root = candidates[0]!.id;
		roots.push(root);
		// Spanning tree: along edge directions first, then against them for what is left.
		const visited = new Set([root]);
		const queue = [root];
		const attach = (parent: string, child: string, edgeId: string) => {
			visited.add(child);
			treeEdges.set(child, edgeId);
			(children.get(parent) ?? children.set(parent, []).get(parent)!).push(child);
			queue.push(child);
		};
		while (visited.size < ids.length) {
			while (queue.length) {
				const cur = queue.shift()!;
				for (const eid of out.get(cur) ?? []) {
					const to = edgeById.get(eid)!.toNode;
					if (!visited.has(to)) attach(cur, to, eid);
				}
			}
			if (visited.size >= ids.length) break;
			const link = treeLike.find((e) => visited.has(e.toNode) !== visited.has(e.fromNode));
			if (!link) break;
			if (visited.has(link.toNode)) attach(link.toNode, link.fromNode, link.id);
			else attach(link.fromNode, link.toNode, link.id);
		}
	}
	const used = new Set(treeEdges.values());
	const crossEdges = edges.filter((e) => !used.has(e.id)).map((e) => e.id);

	// A link between a break-point card and its page goes at the end of the card's line.
	const linkTargets = pageLinkTargets(pagesOfRoot(data));
	const stored = childOrderOf(data);
	const rootExtra = data["x-opc"];
	const layouts = isPlainObject(rootExtra) && isPlainObject(rootExtra.mapLayouts) ? (rootExtra.mapLayouts as Record<string, string>) : {};
	// `layout`: the map's recorded layout, read from its root down.
	const bullet = (id: string, layout = layouts[id], isRoot = true): OutlineItem => {
		const node = byId.get(id)!;
		const kids = orderChildren(node, (children.get(id) ?? []).map((c) => byId.get(c)!), opts.rtl, stored[id], axisOf(layout, isRoot));
		const header = headerOf(node);
		return { kind: "node", text: inlinePageLinks(nodeText(node), linkTargets), id: alias.get(id), ...(header !== undefined ? { header } : {}), children: kids.map((k) => bullet(k.id, layout, false)) };
	};

	const container = containers(all.filter((n) => n.type === "group" || contentIds.has(n.id)));
	const inGroup = (id: string | undefined) => (n: { id: string }) => container.get(n.id) === id;
	const level = (depth: number) => Math.min(6, depth);

	const sectionsIn = (groupId: string | undefined, depth: number): OutlineItem[] => {
		const maps = roots.filter((r) => container.get(r) === groupId).map((r) => byId.get(r)!);
		const subgroups = groups.filter(inGroup(groupId));
		return [...maps, ...subgroups].sort(order).map((n) => {
			if (n.type !== "group") return { ...bullet(n.id), heading: level(depth + 1) };
			const freeHere = free.filter((id) => container.get(id) === n.id).map((id) => byId.get(id)!).sort(order);
			return {
				kind: "group" as const,
				text: nodeText(n),
				id: alias.get(n.id),
				heading: level(depth + 1),
				children: [...freeHere.map((f) => bullet(f.id)), ...sectionsIn(n.id, depth + 1)],
			};
		});
	};

	let items = sectionsIn(undefined, 0);
	const topFree = free.filter((id) => !container.has(id)).map((id) => byId.get(id)!).sort(order);
	if (topFree.length) items.push({ kind: "free", text: opts.freeLabel, heading: 1, children: topFree.map((n) => bullet(n.id)) });

	if (opts.paged) items = pageSections(items, data, byId, alias);
	else nestPages(items, data, roots, children, alias);
	// Header cards become headings, below the headings their maps and pages already have.
	extractHeaders(items);

	const rootOrder: string[] = [];
	const byAlias = new Map([...alias].map(([id, a]) => [a, id]));
	const rootSet = new Set(roots);
	const collect = (list: OutlineItem[]) => {
		for (const item of list) {
			if (item.kind === "node" && (item.heading !== undefined || item.page)) {
				const id = item.id ? byAlias.get(item.id) : undefined;
				if (id && rootSet.has(id)) rootOrder.push(id);
			}
			collect(item.children);
		}
	};
	collect(items);
	return { items, alias, treeEdges, crossEdges, drawings, roots: rootOrder };
}

/**
 * Moves each page's map under the card it comes from: a heading one level deeper than the
 * section of the map holding that card, or, below the sixth heading level, bullets nested under
 * the card itself. Parent pages first, so deeper pages land inside their parents.
 */
function nestPages(items: OutlineItem[], data: CanvasFileData, roots: string[], children: Map<string, string[]>, alias: Map<string, string>): void {
	const pages = pagesOfRoot(data);
	if (pages.length === 0) return;
	const rootSet = new Set(roots);
	const parentOf = new Map<string, string>();
	for (const [p, kids] of children) for (const k of kids) parentOf.set(k, p);
	const mapRoot = (id: string) => {
		let cur = id;
		const seen = new Set<string>();
		while (parentOf.has(cur) && !seen.has(cur)) {
			seen.add(cur);
			cur = parentOf.get(cur)!;
		}
		return cur;
	};
	const find = (list: OutlineItem[], aliasId: string | undefined): { list: OutlineItem[]; item: OutlineItem } | null => {
		if (!aliasId) return null;
		for (const item of list) {
			if (item.kind !== "free" && item.id === aliasId) return { list, item };
			const inner = find(item.children, aliasId);
			if (inner) return inner;
		}
		return null;
	};
	const depth = (p: PageRef) => {
		let d = 0;
		const seen = new Set<string>();
		for (let cur: PageRef | undefined = p; cur?.parent && !seen.has(cur.id); cur = pages.find((q) => q.id === cur.parent)) {
			seen.add(cur.id);
			d++;
		}
		return d;
	};
	for (const page of [...pages].sort((a, b) => depth(a) - depth(b))) {
		if (!rootSet.has(page.root)) continue;
		const own = find(items, alias.get(page.root));
		const holder = find(items, alias.get(mapRoot(page.anchor)));
		const anchor = find(items, alias.get(page.anchor));
		if (!own || !holder || !anchor || own.item === holder.item) continue;
		own.list.splice(own.list.indexOf(own.item), 1);
		const level = (holder.item.heading ?? 6) + 1;
		if (holder.item.heading !== undefined && level <= 6) {
			own.item.heading = level;
			holder.item.children.push(own.item);
		} else {
			delete own.item.heading;
			anchor.item.children.push(own.item);
		}
		own.item.page = true;
	}
}

/** Pages in reading order: the main page (""), then each page followed by its own pages. */
export function pageOrder(pages: PageRef[]): string[] {
	const ids = new Set(pages.map((p) => p.id));
	const children = new Map<string, PageRef[]>();
	for (const p of pages) {
		const parent = p.parent && ids.has(p.parent) ? p.parent : "";
		(children.get(parent) ?? children.set(parent, []).get(parent)!).push(p);
	}
	const out: string[] = [];
	const seen = new Set<string>();
	const visit = (id: string) => {
		if (seen.has(id)) return;
		seen.add(id);
		out.push(id);
		for (const child of children.get(id) ?? []) visit(child.id);
	};
	visit("");
	return out;
}

/**
 * Splits the top-level sections by page: the main page's first, then each page's, starting with
 * its root (a card alone on its page becomes that page's heading). Free cards are listed per page.
 */
function pageSections(items: OutlineItem[], data: CanvasFileData, byId: Map<string, CanvasNodeData>, alias: Map<string, string>): OutlineItem[] {
	const pages = pagesOfRoot(data);
	if (pages.length === 0) return items;
	const known = new Set(pages.map((p) => p.id));
	const byAlias = new Map([...alias].map(([id, a]) => [a, id]));
	const pageOf = (item: OutlineItem) => {
		const id = item.id ? byAlias.get(item.id) : undefined;
		const node = id ? byId.get(id) : undefined;
		const page = node ? pageOfNode(node) : "";
		return known.has(page) ? page : "";
	};
	const sections = new Map<string, OutlineItem[]>();
	const put = (page: string, item: OutlineItem) => (sections.get(page) ?? sections.set(page, []).get(page)!).push(item);
	for (const item of items) {
		if (item.kind !== "free") {
			put(pageOf(item), item);
			continue;
		}
		const split = new Map<string, OutlineItem[]>();
		for (const card of item.children) (split.get(pageOf(card)) ?? split.set(pageOf(card), []).get(pageOf(card))!).push(card);
		for (const [page, cards] of split) put(page, { ...item, children: cards });
	}
	const out: OutlineItem[] = [];
	for (const page of pageOrder(pages)) {
		const list = sections.get(page) ?? [];
		const ref = pages.find((p) => p.id === page);
		const rootAlias = ref ? alias.get(ref.root) : undefined;
		if (rootAlias) {
			let root = list.find((i) => i.kind !== "free" && i.id === rootAlias);
			if (!root) {
				// Alone on its page: it was listed with the free cards.
				const free = list.find((i) => i.kind === "free" && i.children.some((c) => c.id === rootAlias));
				const own = free?.children.find((c) => c.id === rootAlias);
				if (free && own) {
					free.children.splice(free.children.indexOf(own), 1);
					if (free.children.length === 0) list.splice(list.indexOf(free), 1);
					root = { ...own, heading: 1 };
					list.unshift(root);
				}
			}
			if (root) {
				list.splice(list.indexOf(root), 1);
				list.unshift({ ...root, page: true });
			}
		}
		out.push(...list);
	}
	return out;
}
