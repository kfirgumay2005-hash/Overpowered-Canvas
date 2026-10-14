/**
 * The "x-opc" extra-data schema, stored on nodes, edges and the canvas root.
 * See docs/SCHEMA.md for the rationale. Bump SCHEMA_VERSION and add a migration in
 * migrations/ whenever a stored shape changes incompatibly.
 */
import type { EdgeSide } from "./json-canvas";

export const SCHEMA_KEY = "x-opc";
export const SCHEMA_VERSION = 1;

export const DIRECTIONS = ["ltr", "rtl", "auto"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const NODE_KINDS = ["sticky", "shape", "line", "ink"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const FLOWCHART_SHAPES = [
	"terminal",
	"process",
	"decision",
	"input-output",
	"on-page-reference",
	"predefined-process",
	"document",
	"database",
	"pill",
] as const;
export type FlowchartShape = (typeof FLOWCHART_SHAPES)[number];

/** Standalone shapes (section D #2). Lines and arrows are kind "line", not shapes. */
export const STANDALONE_SHAPES = [
	"rectangle",
	"rounded-rectangle",
	"ellipse",
	"diamond",
	"triangle",
	"parallelogram",
	"trapezoid",
	"pentagon",
	"hexagon",
	"octagon",
	"star",
	"cross",
	"heart",
	"cylinder",
	"cloud",
	"speech-bubble",
	"callout",
	"block-arrow-left",
	"block-arrow-right",
	"block-arrow-up",
	"block-arrow-down",
	"block-arrow-double",
] as const;
export type StandaloneShape = (typeof STANDALONE_SHAPES)[number];
export type ShapeName = FlowchartShape | StandaloneShape;
export const SHAPES: readonly ShapeName[] = [...FLOWCHART_SHAPES, ...STANDALONE_SHAPES];

export const BORDER_STYLES = ["solid", "dotted", "dashed", "none"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

/** Logical alignment: "start" is left in LTR and right in RTL. */
export const TEXT_ALIGNS = ["start", "center", "end"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const ARROW_STYLES = [
	"triangle",
	"triangle-outline",
	"halved-triangle",
	"thin-triangle",
	"diamond",
	"diamond-outline",
	"circle",
	"circle-outline",
	"blunted",
	"none",
] as const;
export type ArrowStyle = (typeof ARROW_STYLES)[number];

export const EDGE_PATH_STYLES = ["solid", "dotted", "short-dashed", "long-dashed"] as const;
export type EdgePathStyle = (typeof EDGE_PATH_STYLES)[number];

export const EDGE_ROUTES = ["bezier", "straight", "orthogonal", "astar"] as const;
export type EdgeRoute = (typeof EDGE_ROUTES)[number];

export const EDGE_SIDES = ["top", "right", "bottom", "left"] as const satisfies readonly EdgeSide[];

export const STROKE_TOOLS = ["pen", "pencil", "marker", "highlighter"] as const;
export type StrokeTool = (typeof STROKE_TOOLS)[number];

export type Point = [x: number, y: number];

/** Where an end of a free line attaches. Without `side` the end floats to the nearest side. */
export interface Attach {
	node: string;
	side?: EdgeSide;
}

export interface LineData {
	/** Polyline points relative to the node's x/y. At least two. */
	points: Point[];
	from?: Attach;
	to?: Attach;
	startArrow?: ArrowStyle;
	endArrow?: ArrowStyle;
}

export interface StickyData {
	author?: string;
	/** Unix ms. */
	created?: number;
	footer?: boolean;
}

/** Normalized (0–1) crop rectangle of an image node. Non-destructive. */
export interface CropRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface KanbanBinding {
	key: string;
	value: string;
}

/** Filter of a query group (Phase 7). Every present criterion must match. */
export interface QuerySpec {
	tags?: string[];
	folder?: string;
	properties?: { key: string; value?: string }[];
	linksTo?: string[];
	auto?: boolean;
}

export interface Stroke {
	id: string;
	tool: StrokeTool;
	color: string;
	size: number;
	opacity?: number;
	smoothing?: number;
	locked?: boolean;
	/** Flat [x, y, pressure, x, y, pressure, …] relative to the carrier node, rounded. */
	pts: number[];
	/** Optional flat [tiltX, tiltY, …], one pair per point. */
	tilt?: number[];
}

export interface OpcRoot {
	v: number;
	frontmatter?: Record<string, unknown>;
	dir?: Direction;
	presentation?: { start?: string; last?: string };
	frameOrder?: string[];
}

export interface OpcNode {
	kind?: NodeKind;
	shape?: ShapeName;
	border?: BorderStyle;
	align?: TextAlign;
	dir?: Direction;
	autoResize?: boolean;
	locked?: boolean;
	breakpoint?: number;
	collapsed?: boolean;
	styles?: Record<string, string>;
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	opacity?: number;
	rotation?: number;
	line?: LineData;
	sticky?: StickyData;
	crop?: CropRect;
	pdf?: { pinned: boolean };
	portal?: { open: boolean };
	kanban?: KanbanBinding;
	query?: QuerySpec;
	queryOwner?: string;
	strokes?: Stroke[];
}

export interface OpcEdge {
	path?: EdgePathStyle;
	arrows?: { from?: ArrowStyle; to?: ArrowStyle };
	route?: EdgeRoute;
	/** Absolute canvas coordinates. When present they override `route`. */
	waypoints?: Point[];
	/** Label position along the path, 0–1. */
	labelT?: number;
	floating?: { from?: boolean; to?: boolean };
	/** Presentation order among a node's outgoing edges. */
	order?: number;
	portalTarget?: { end: "from" | "to"; nodeId: string };
	styles?: Record<string, string>;
	/** Created by the auto-edges module from a frontmatter property; removed with the property. */
	auto?: boolean;
}

/** Values equal to these are not stored, which keeps files small. */
export const NODE_DEFAULTS: Readonly<Partial<OpcNode>> = {
	border: "solid",
	align: "start",
	autoResize: false,
	locked: false,
	collapsed: false,
	opacity: 1,
	rotation: 0,
};

export const EDGE_DEFAULTS: Readonly<Partial<OpcEdge>> = {
	path: "solid",
	route: "bezier",
	auto: false,
};

export const ROOT_DEFAULTS: Readonly<Partial<OpcRoot>> = {};
