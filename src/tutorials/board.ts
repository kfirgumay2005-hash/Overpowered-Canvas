/**
 * Builders for the demo boards and the reads tutorial checks share. Pure, unit-tested.
 */
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData, EdgeSide } from "../data/json-canvas";
import { SCHEMA_KEY, type OpcEdge, type OpcNode, type ShapeName, type Stroke } from "../data/schema";
import { pack, type InkPoint } from "../geometry/ink";
import { CARRIER_PAD } from "../modules/drawing/carriers";
import { lineNodeData, shapeNodeData } from "../modules/free-lines/model";
import { STICKY_COLORS, STICKY_SIZE, type StickyColor } from "../modules/sticky-notes/logic";

/** A fresh 16-hex-digit id, like the ones Obsidian gives new items. */
export function randomId(): string {
	const bytes = new Uint8Array(8);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type NodeExtra = Partial<CanvasNodeData> & { [SCHEMA_KEY]?: OpcNode };

export function card(id: string, text: string, x: number, y: number, width = 260, height = 100, extra: NodeExtra = {}): CanvasNodeData {
	return { id, type: "text", text, x, y, width, height, ...extra };
}

/** A heading without a card around it (floating text). */
export function title(id: string, text: string, x: number, y: number, width = 700, height = 80, level = 1): CanvasNodeData {
	return card(id, level > 0 ? `${"#".repeat(level)} ${text}` : text, x, y, width, height, { [SCHEMA_KEY]: { kind: "text", autoWidth: true } });
}

export function sticky(id: string, text: string, x: number, y: number, color: StickyColor = "yellow"): CanvasNodeData {
	return card(id, text, x, y, STICKY_SIZE, STICKY_SIZE, { color: STICKY_COLORS[color], [SCHEMA_KEY]: { kind: "sticky" } });
}

export function group(id: string, label: string, x: number, y: number, width: number, height: number, extra: NodeExtra = {}): CanvasNodeData {
	return { id, type: "group", label, x, y, width, height, ...extra };
}

export function shape(id: string, which: ShapeName, x: number, y: number, width: number, height: number, style: { color?: string; fill?: string; text?: string } = {}): CanvasNodeData {
	const node = shapeNodeData(id, which, { x, y, width, height }, style);
	return style.text ? { ...node, text: style.text } : node;
}

export function arrow(id: string, points: { x: number; y: number }[], from?: string, to?: string, color?: string): CanvasNodeData {
	return lineNodeData(id, points, { from, to }, { endArrow: "triangle", strokeWidth: 3, ...(color ? { color } : {}) });
}

export function edge(id: string, from: string, fromSide: EdgeSide, to: string, toSide: EdgeSide, extra: Partial<CanvasEdgeData> & { [SCHEMA_KEY]?: OpcEdge } = {}): CanvasEdgeData {
	return { id, fromNode: from, fromSide, toNode: to, toSide, toEnd: "arrow", ...extra };
}

/** An ink carrier holding one pen stroke through the given points (canvas coordinates). */
export function ink(id: string, points: { x: number; y: number }[], color = "#e03131", size = 6): CanvasNodeData {
	const minX = Math.min(...points.map((p) => p.x)) - CARRIER_PAD;
	const minY = Math.min(...points.map((p) => p.y)) - CARRIER_PAD;
	const maxX = Math.max(...points.map((p) => p.x)) + CARRIER_PAD;
	const maxY = Math.max(...points.map((p) => p.y)) + CARRIER_PAD;
	const x = Math.floor(minX);
	const y = Math.floor(minY);
	const rel: InkPoint[] = points.map((p) => ({ x: p.x - x, y: p.y - y, p: 0.5 }));
	const stroke: Stroke = { id: `${id}-s`, tool: "pen", color, size, ...pack(rel) };
	return card(id, "✏️", x, y, Math.ceil(maxX - x), Math.ceil(maxY - y), { [SCHEMA_KEY]: { kind: "ink", strokes: [stroke] } });
}

/** Points around an ellipse, for hand-drawn looking circles. */
export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, steps = 48): { x: number; y: number }[] {
	const out: { x: number; y: number }[] = [];
	// A little past a full turn and slightly wobbly, like a quick pen circle.
	for (let i = 0; i <= steps + 4; i++) {
		const a = (i / steps) * Math.PI * 2 - Math.PI / 2;
		const wobble = 1 + Math.sin(i * 1.7) * 0.03;
		out.push({ x: Math.round(cx + Math.cos(a) * rx * wobble), y: Math.round(cy + Math.sin(a) * ry * wobble) });
	}
	return out;
}

// ---------- reads shared by checks ----------

export function nodesOf(data: CanvasFileData): CanvasNodeData[] {
	return data.nodes ?? [];
}

export function edgesOf(data: CanvasFileData): CanvasEdgeData[] {
	return data.edges ?? [];
}

export function extraOf(item: CanvasNodeData | CanvasEdgeData | CanvasFileData | undefined): Record<string, unknown> {
	const extra = item?.[SCHEMA_KEY];
	return extra && typeof extra === "object" ? (extra as Record<string, unknown>) : {};
}

export function kindOf(node: CanvasNodeData): string | undefined {
	const kind = extraOf(node).kind;
	return typeof kind === "string" ? kind : undefined;
}

/** How many nodes match, e.g. `count(data, (n) => kindOf(n) === "sticky")`. */
export function count(data: CanvasFileData, test: (node: CanvasNodeData) => boolean = () => true): number {
	return nodesOf(data).filter(test).length;
}

/** Nodes in `now` whose ids are not in `before`. */
export function added(before: CanvasFileData, now: CanvasFileData): CanvasNodeData[] {
	const known = new Set(nodesOf(before).map((n) => n.id));
	return nodesOf(now).filter((n) => !known.has(n.id));
}

export function addedEdges(before: CanvasFileData, now: CanvasFileData): CanvasEdgeData[] {
	const known = new Set(edgesOf(before).map((e) => e.id));
	return edgesOf(now).filter((e) => !known.has(e.id));
}

export function findNode(data: CanvasFileData, id: string): CanvasNodeData | undefined {
	return nodesOf(data).find((n) => n.id === id);
}

export function strokeCount(data: CanvasFileData): number {
	let n = 0;
	for (const node of nodesOf(data)) {
		const strokes = extraOf(node).strokes;
		if (Array.isArray(strokes)) n += strokes.length;
	}
	return n;
}

/**
 * A small PDF (A4 pages drawn with the given content streams of vector operators, no fonts) for
 * practice boards. ASCII only, with a correct cross-reference table.
 */
export function practicePdf(pages: string[]): string {
	const objects: string[] = [];
	const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
	objects.push("<< /Type /Catalog /Pages 2 0 R >>");
	objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
	for (const [i, content] of pages.entries()) {
		objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R >>`);
		objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
	}
	let out = "%PDF-1.4\n";
	const offsets: number[] = [];
	objects.forEach((body, i) => {
		offsets.push(out.length);
		out += `${i + 1} 0 obj\n${body}\nendobj\n`;
	});
	const xref = out.length;
	out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
	out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return out;
}
