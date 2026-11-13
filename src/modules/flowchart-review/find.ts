/**
 * Finds the flowcharts to review in a canvas file (pure, unit-tested).
 *
 * A flowchart is a set of two or more cards joined by edges. Two sources:
 * - a group whose label is the review group's name (default "toreview"): the cards inside it;
 * - a canvas tagged with the review tag (its properties, or a `#tag` in one of its cards): all of it.
 */
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData, EdgeSide } from "../../data/json-canvas";
import { SCHEMA_KEY } from "../../data/schema";

/** Kinds that are drawings or lines, never steps of a flowchart. */
const NOT_A_STEP = new Set(["ink", "line", "guide"]);

export interface ChartNode {
	id: string;
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** Text card: its text. File card: the file path. Link card: the URL. */
	text: string;
	shape?: string;
	color?: string;
}

export interface ChartEdge {
	id: string;
	from: string;
	to: string;
	fromSide?: EdgeSide;
	toSide?: EdgeSide;
	fromEnd: "none" | "arrow";
	toEnd: "none" | "arrow";
	label?: string;
}

export interface Flowchart {
	/** `<canvas path>::<id of the first card>`: stays the same while the chart is edited. */
	key: string;
	path: string;
	/** The first card: no edge comes into it (top one, then left one). */
	firstId: string;
	nodes: ChartNode[];
	edges: ChartEdge[];
	/** Changes when a card or an edge is added, removed or its text changed (not when moved). */
	hash: string;
}

export interface FindOptions {
	groupName: string;
	tag: string;
}

const clean = (s: string) => s.trim().replace(/^#/, "").toLowerCase();

/** The canvas' tags: its properties (x-opc.frontmatter.tags) and `#tags` written in its text cards. */
export function canvasTags(data: CanvasFileData): string[] {
	const out = new Set<string>();
	const root = data[SCHEMA_KEY] as { frontmatter?: { tags?: unknown; tag?: unknown } } | undefined;
	const raw = root?.frontmatter?.tags ?? root?.frontmatter?.tag;
	const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,]+/) : [];
	for (const t of list) if (typeof t === "string" && clean(t)) out.add(clean(t));
	for (const n of data.nodes ?? [])
		if (n.type === "text" && typeof n.text === "string") for (const m of n.text.matchAll(/(?:^|\s)#([^\s#.,;:!?()[\]{}"'`]+)/gu)) out.add(clean(m[1]!));
	return [...out];
}

function extra(n: CanvasNodeData): Record<string, unknown> {
	const x = n[SCHEMA_KEY];
	return x && typeof x === "object" ? (x as Record<string, unknown>) : {};
}

function isStep(n: CanvasNodeData): boolean {
	if (n.type === "group") return false;
	const kind = extra(n).kind;
	return !(typeof kind === "string" && NOT_A_STEP.has(kind));
}

function toChartNode(n: CanvasNodeData): ChartNode {
	const x = extra(n);
	const text = n.type === "text" ? (n.text ?? "") : n.type === "file" ? (n.file ?? "") : n.type === "link" ? (n.url ?? "") : "";
	return {
		id: n.id,
		type: n.type,
		x: n.x,
		y: n.y,
		width: n.width,
		height: n.height,
		text,
		// Flowchart shapes on cards and standalone shapes both keep their outline in `shape`.
		...(typeof x.shape === "string" ? { shape: x.shape } : {}),
		...(n.color ? { color: n.color } : {}),
	};
}

const center = (n: CanvasNodeData) => ({ x: n.x + n.width / 2, y: n.y + n.height / 2 });
const inside = (n: CanvasNodeData, g: CanvasNodeData) => {
	const c = center(n);
	return c.x >= g.x && c.x <= g.x + g.width && c.y >= g.y && c.y <= g.y + g.height;
};

/** FNV-1a, 32 bits, as 8 hex digits. */
export function hashText(text: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

/** What the chart is made of: cards (id, type, text, shape) and edges (ends, label); not where they are. */
export function chartHash(nodes: readonly ChartNode[], edges: readonly ChartEdge[]): string {
	const ns = [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1)).map((n) => [n.id, n.type, n.text, n.shape ?? ""].join("\u0001"));
	const es = [...edges].sort((a, b) => (a.from + a.to + a.id < b.from + b.to + b.id ? -1 : 1)).map((e) => [e.from, e.to, e.label ?? ""].join("\u0001"));
	return hashText(ns.join("\u0002") + "\u0003" + es.join("\u0002"));
}

/** The first card: no edge comes into it; the top one, then the one most to the left. */
export function firstNode(nodes: readonly ChartNode[], edges: readonly ChartEdge[]): ChartNode {
	const incoming = new Set<string>();
	for (const e of edges) {
		if (e.toEnd === "arrow" || e.fromEnd !== "arrow") incoming.add(e.to);
		if (e.fromEnd === "arrow" && e.toEnd !== "arrow") incoming.add(e.from);
	}
	const starts = nodes.filter((n) => !incoming.has(n.id));
	const pool = starts.length ? starts : nodes;
	return [...pool].sort((a, b) => a.y - b.y || a.x - b.x)[0]!;
}

/** Splits cards and edges into connected sets of two or more cards. */
function components(path: string, nodes: CanvasNodeData[], edges: CanvasEdgeData[]): Flowchart[] {
	const ids = new Set(nodes.map((n) => n.id));
	const links = edges.filter((e) => ids.has(e.fromNode) && ids.has(e.toNode) && e.fromNode !== e.toNode);
	const parent = new Map<string, string>(nodes.map((n) => [n.id, n.id]));
	const find = (id: string): string => {
		let r = id;
		while (parent.get(r) !== r) r = parent.get(r)!;
		parent.set(id, r);
		return r;
	};
	for (const e of links) parent.set(find(e.fromNode), find(e.toNode));
	const sets = new Map<string, CanvasNodeData[]>();
	for (const n of nodes) {
		const r = find(n.id);
		const list = sets.get(r) ?? [];
		list.push(n);
		sets.set(r, list);
	}
	const out: Flowchart[] = [];
	for (const list of sets.values()) {
		if (list.length < 2) continue;
		const own = new Set(list.map((n) => n.id));
		const chartNodes = list.map(toChartNode);
		const chartEdges: ChartEdge[] = links
			.filter((e) => own.has(e.fromNode))
			.map((e) => ({
				id: e.id,
				from: e.fromNode,
				to: e.toNode,
				...(e.fromSide ? { fromSide: e.fromSide } : {}),
				...(e.toSide ? { toSide: e.toSide } : {}),
				fromEnd: e.fromEnd === "arrow" ? "arrow" : "none",
				toEnd: e.toEnd === "none" ? "none" : "arrow",
				...(typeof e.label === "string" && e.label.trim() ? { label: e.label } : {}),
			}));
		const first = firstNode(chartNodes, chartEdges);
		out.push({ key: `${path}::${first.id}`, path, firstId: first.id, nodes: chartNodes, edges: chartEdges, hash: chartHash(chartNodes, chartEdges) });
	}
	return out.sort((a, b) => {
		const fa = a.nodes.find((n) => n.id === a.firstId)!;
		const fb = b.nodes.find((n) => n.id === b.firstId)!;
		return fa.y - fb.y || fa.x - fb.x;
	});
}

/** The flowcharts to review in one canvas file. */
export function findFlowcharts(path: string, data: CanvasFileData, options: FindOptions): Flowchart[] {
	const nodes = data.nodes ?? [];
	const edges = data.edges ?? [];
	const steps = nodes.filter(isStep);
	const tag = clean(options.tag);
	if (tag && canvasTags(data).includes(tag)) return components(path, steps, edges);
	const name = clean(options.groupName);
	if (!name) return [];
	const groups = nodes.filter((n) => n.type === "group" && typeof n.label === "string" && clean(n.label) === name);
	const seen = new Set<string>();
	const out: Flowchart[] = [];
	for (const g of groups)
		for (const chart of components(path, steps.filter((n) => inside(n, g)), edges))
			if (!seen.has(chart.key)) {
				seen.add(chart.key);
				out.push(chart);
			}
	return out;
}

/** Strips Markdown marks, links and tags from a card's text, for names and grading. */
export function plainCardText(text: string): string {
	return text
		.replace(/^---\n[\s\S]*?\n---\n?/, "")
		.replace(/!?\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
		.replace(/!?\[\[([^\]]+)\]\]/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, "")
		.replace(/(\*\*|__|==|~~|\*|_|`)/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** A card's words as shown in the list: file cards by their name. */
export function cardLabel(node: ChartNode): string {
	if (node.type === "file") return (node.text.split("/").pop() ?? node.text).replace(/\.md$/i, "");
	return plainCardText(node.text);
}

/** The default name of a chart: the first `words` words of its first card. */
export function defaultName(chart: Flowchart, words: number): string {
	const first = chart.nodes.find((n) => n.id === chart.firstId);
	const all = first ? cardLabel(first).split(/\s+/).filter(Boolean) : [];
	const name = all.slice(0, Math.max(1, words)).join(" ");
	return all.length > words ? `${name}…` : name;
}
