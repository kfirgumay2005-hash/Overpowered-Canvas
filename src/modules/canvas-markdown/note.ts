/**
 * Whole canvas ⇄ Markdown note (pure). The note is the readable outline (see outline.ts); the
 * canvas data holds everything visual, keyed by card aliases: positions, sizes, colors, styles,
 * edges outside the outline, drawings, map layouts and the canvas root data.
 *
 * The data lives either in a hidden `%% ## canvas-data %%` section at the end of the note (the
 * outline then carries hidden ids), or in a separate file (a clean note; the data keeps the
 * outline as written so lines can be matched back to cards, see match.ts).
 */
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData } from "../../data/json-canvas";
import { MAP_LAYOUTS, type MapLayout } from "../../data/schema";
import { parseOutline, stripFrontmatter, writeOutline, type OutlineItem } from "./outline";
import { buildStructure } from "./structure";

export const DATA_VERSION = 1;
export const DATA_HEADING = "## canvas-data";

export type { MapLayout };

export function isMapLayout(v: unknown): v is MapLayout {
	return typeof v === "string" && (MAP_LAYOUTS as readonly string[]).includes(v);
}

export interface NoteData {
	version: number;
	/** Vault path of the canvas this note mirrors. */
	canvas?: string;
	/** Canvas root properties other than nodes and edges (e.g. "x-opc"). */
	root?: Record<string, unknown>;
	/** Map root alias → layout ("free" = positions as saved). */
	maps?: Record<string, { layout: MapLayout | "free" }>;
	/** Alias → node data without its text or label (cards and groups). */
	nodes?: Record<string, CanvasNodeData>;
	/** Child alias → the edge linking it to its outline parent. */
	edges?: Record<string, CanvasEdgeData>;
	crossEdges?: CanvasEdgeData[];
	drawings?: CanvasNodeData[];
	/** Node ids in drawing order (the canvas file's order). */
	order?: string[];
	/** Separate data file only: the note it belongs to. */
	note?: string;
	/** Separate data file only: the outline last written to the note, with ids. */
	outline?: OutlineItem[];
}

export interface ExportOptions {
	canvasPath: string;
	rtl: boolean;
	freeLabel: string;
	indent: string;
	/** Front matter to keep at the top (verbatim, including the --- lines). */
	frontmatter?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Root x-opc map layouts (canvas id → layout). */
export function rootMapLayouts(root: Record<string, unknown> | undefined): Record<string, MapLayout> {
	const extra = root?.["x-opc"];
	const raw = isPlainObject(extra) ? extra.mapLayouts : undefined;
	const out: Record<string, MapLayout> = {};
	if (isPlainObject(raw)) for (const [k, v] of Object.entries(raw)) if (isMapLayout(v)) out[k] = v;
	return out;
}

/** One entry per line keeps large boards diffable and readable. */
export function formatData(data: NoteData): string {
	const lines = ["{"];
	const entries = Object.entries(data).filter(([, v]) => v !== undefined);
	entries.forEach(([key, value], i) => {
		const comma = i < entries.length - 1 ? "," : "";
		if (isPlainObject(value) && Object.keys(value).length > 0 && key !== "root") {
			lines.push(`\t${JSON.stringify(key)}: {`);
			const inner = Object.entries(value);
			inner.forEach(([k, v], j) => lines.push(`\t\t${JSON.stringify(k)}: ${JSON.stringify(v)}${j < inner.length - 1 ? "," : ""}`));
			lines.push(`\t}${comma}`);
		} else if (Array.isArray(value) && value.length > 0 && key !== "order") {
			lines.push(`\t${JSON.stringify(key)}: [`);
			value.forEach((v, j) => lines.push(`\t\t${JSON.stringify(v)}${j < value.length - 1 ? "," : ""}`));
			lines.push(`\t]${comma}`);
		} else lines.push(`\t${JSON.stringify(key)}: ${JSON.stringify(value)}${comma}`);
	});
	lines.push("}");
	return lines.join("\n");
}

export function dataBlock(data: NoteData): string {
	return `%%\n${DATA_HEADING}\n\`\`\`json\n${formatData(data)}\n\`\`\`\n%%\n`;
}

/** Canvas → outline items (with ids) and the data block. */
function build(canvas: CanvasFileData, opts: ExportOptions): { items: OutlineItem[]; data: NoteData } {
	const s = buildStructure(canvas, { rtl: opts.rtl, freeLabel: opts.freeLabel });
	const byId = new Map((canvas.nodes ?? []).map((n) => [n.id, n]));
	const edgeById = new Map((canvas.edges ?? []).map((e) => [e.id, e]));

	const nodes: Record<string, CanvasNodeData> = {};
	for (const [id, a] of s.alias) {
		const { text: _text, label: _label, ...rest } = byId.get(id)!;
		nodes[a] = rest;
	}
	const edges: Record<string, CanvasEdgeData> = {};
	for (const [child, edgeId] of s.treeEdges) edges[s.alias.get(child)!] = edgeById.get(edgeId)!;
	const layouts = rootMapLayouts(canvas);
	const maps: Record<string, { layout: MapLayout | "free" }> = {};
	for (const r of s.roots) maps[s.alias.get(r)!] = { layout: layouts[r] ?? "free" };
	const { nodes: _n, edges: _e, ...root } = canvas;

	const data: NoteData = {
		version: DATA_VERSION,
		canvas: opts.canvasPath,
		root,
		maps,
		nodes,
		edges,
		crossEdges: s.crossEdges.map((id) => edgeById.get(id)!),
		drawings: s.drawings.map((id) => byId.get(id)!),
		order: (canvas.nodes ?? []).map((n) => n.id),
	};
	return { items: s.items, data };
}

function frontmatterOf(opts: ExportOptions): string {
	return opts.frontmatter ? (opts.frontmatter.endsWith("\n") ? opts.frontmatter : `${opts.frontmatter}\n`) : "";
}

/** Canvas → note text with hidden ids and the data section. */
export function exportNote(canvas: CanvasFileData, opts: ExportOptions): string {
	const { items, data } = build(canvas, opts);
	const outline = items.length ? writeOutline(items, { indent: opts.indent, ids: true }) : "";
	return `${frontmatterOf(opts)}${outline}${outline ? "\n" : ""}${dataBlock(data)}`;
}

/** Canvas → a clean note (outline only) and the data for its separate file. */
export function exportClean(canvas: CanvasFileData, opts: ExportOptions & { notePath: string }): { md: string; data: NoteData } {
	const { items, data } = build(canvas, opts);
	const outline = items.length ? writeOutline(items, { indent: opts.indent, ids: false, clean: true }) : "";
	return { md: `${frontmatterOf(opts)}${outline}`, data: { ...data, note: opts.notePath, outline: items } };
}

export interface SplitNote {
	frontmatter: string;
	items: OutlineItem[];
	data: NoteData | null;
	/** A data section exists but its JSON could not be read. */
	dataError: boolean;
}

const BLOCK = /(?:^|\n)%%[ \t]*\n## canvas-data[ \t]*\n```json[ \t]*\n([\s\S]*?)\n```[ \t]*\n%%[ \t]*(?=\n|$)/g;

/** Note text → outline items and the data block (if any). */
export function splitNote(md: string): SplitNote {
	const text = md.replace(/\r\n?/g, "\n");
	const { frontmatter, body } = stripFrontmatter(text);
	const matches = [...body.matchAll(BLOCK)];
	const last = matches[matches.length - 1];
	let data: NoteData | null = null;
	let dataError = false;
	let outline = body;
	if (last) {
		outline = body.slice(0, last.index) + body.slice(last.index + last[0].length);
		try {
			const parsed: unknown = JSON.parse(last[1]!);
			data = readData(parsed);
			if (!data) dataError = true;
		} catch {
			dataError = true;
		}
	} else if (/^## canvas-data[ \t]*$/m.test(body)) {
		// The heading is there but the block around it was damaged: drop it from the outline.
		dataError = true;
		outline = body.replace(/^%%[ \t]*\n## canvas-data[\s\S]*$/m, "");
	}
	return { frontmatter, items: parseOutline(outline), data, dataError };
}

/** Validates the shape of a data block, dropping entries that can't be used. */
export function readData(raw: unknown): NoteData | null {
	if (!isPlainObject(raw) || typeof raw.version !== "number") return null;
	const nodeLike = (v: unknown): v is CanvasNodeData =>
		isPlainObject(v) && typeof v.id === "string" && typeof v.type === "string" && [v.x, v.y, v.width, v.height].every((n) => typeof n === "number" && Number.isFinite(n));
	const edgeLike = (v: unknown): v is CanvasEdgeData => isPlainObject(v) && typeof v.id === "string" && typeof v.fromNode === "string" && typeof v.toNode === "string";
	const out: NoteData = { version: raw.version };
	if (typeof raw.canvas === "string") out.canvas = raw.canvas;
	if (isPlainObject(raw.root)) out.root = raw.root;
	if (isPlainObject(raw.maps)) {
		out.maps = {};
		for (const [k, v] of Object.entries(raw.maps)) if (isPlainObject(v) && (v.layout === "free" || isMapLayout(v.layout))) out.maps[k] = { layout: v.layout };
	}
	if (isPlainObject(raw.nodes)) {
		out.nodes = {};
		for (const [k, v] of Object.entries(raw.nodes)) {
			const withId = isPlainObject(v) && typeof v.id !== "string" ? { ...v, id: k } : v;
			if (nodeLike(withId)) out.nodes[k] = withId;
		}
	}
	if (isPlainObject(raw.edges)) {
		out.edges = {};
		for (const [k, v] of Object.entries(raw.edges)) if (edgeLike(v)) out.edges[k] = v;
	}
	if (Array.isArray(raw.crossEdges)) out.crossEdges = raw.crossEdges.filter(edgeLike);
	if (Array.isArray(raw.drawings)) out.drawings = raw.drawings.filter(nodeLike);
	if (Array.isArray(raw.order)) out.order = raw.order.filter((v): v is string => typeof v === "string");
	if (typeof raw.note === "string") out.note = raw.note;
	if (Array.isArray(raw.outline)) out.outline = readOutline(raw.outline);
	return out;
}

function readOutline(raw: unknown[]): OutlineItem[] {
	const out: OutlineItem[] = [];
	for (const v of raw) {
		if (!isPlainObject(v) || typeof v.text !== "string") continue;
		const kind = v.kind === "group" || v.kind === "free" ? v.kind : "node";
		out.push({
			kind,
			text: v.text,
			...(typeof v.id === "string" ? { id: v.id } : {}),
			...(typeof v.heading === "number" ? { heading: v.heading } : {}),
			children: Array.isArray(v.children) ? readOutline(v.children) : [],
		});
	}
	return out;
}

/** The canvas path a note says it mirrors, if it has a readable data block. */
export function linkedCanvas(md: string): string | null {
	const { data } = splitNote(md);
	return data?.canvas ?? null;
}
