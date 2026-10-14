/**
 * JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/) as Obsidian reads and writes it.
 * Index signatures keep room for properties we don't model; they must never be dropped.
 */

export type EdgeSide = "top" | "right" | "bottom" | "left";
export type EdgeEnd = "none" | "arrow";
export type CanvasNodeType = "text" | "file" | "link" | "group";

/** A preset "1"–"6" or a hex color like "#ff0000". */
export type CanvasColor = string;

export interface CanvasNodeData {
	id: string;
	type: CanvasNodeType | (string & {});
	x: number;
	y: number;
	width: number;
	height: number;
	color?: CanvasColor;
	text?: string;
	file?: string;
	subpath?: string;
	url?: string;
	label?: string;
	background?: string;
	backgroundStyle?: "cover" | "ratio" | "repeat";
	[key: string]: unknown;
}

export interface CanvasEdgeData {
	id: string;
	fromNode: string;
	fromSide?: EdgeSide;
	fromEnd?: EdgeEnd;
	toNode: string;
	toSide?: EdgeSide;
	toEnd?: EdgeEnd;
	color?: CanvasColor;
	label?: string;
	[key: string]: unknown;
}

export interface CanvasFileData {
	nodes?: CanvasNodeData[];
	edges?: CanvasEdgeData[];
	[key: string]: unknown;
}

/** Node types vanilla Obsidian can load. Anything else is silently dropped on its next save. */
export const STANDARD_NODE_TYPES: ReadonlySet<string> = new Set<CanvasNodeType>(["text", "file", "link", "group"]);
