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

export const NODE_KINDS = ["sticky", "shape", "line", "ink", "text", "guide"] as const;
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

export const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
export type VerticalAlign = (typeof VERTICAL_ALIGNS)[number];
/** Smallest and largest text size of a card, in pixels. */
export const CARD_FONT_MIN = 6;
export const CARD_FONT_MAX = 200;

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

/** How a mind map is arranged (auto layout); "right"/"left" are logical (mirrored in RTL). */
export const MAP_LAYOUTS = ["right", "left", "down", "up", "balanced", "radial", "condensed", "layered-right", "layered-left", "layered-down", "layered-up", "grid"] as const;
export type MapLayout = (typeof MAP_LAYOUTS)[number];

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

/** An infinite line (kind "guide"): horizontal lines run along x, vertical ones along y. */
export interface GuideData {
	/** The nearest of horizontal / vertical; the whole direction when `angle` is absent. */
	axis: "h" | "v";
	/** Degrees clockwise from horizontal, in [0, 180). Absent: 0 for "h", 90 for "v". */
	angle?: number;
	/** Line thickness in canvas pixels. */
	width: number;
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
	/** Drawn without pressure sensitivity: the same width all along. */
	uniform?: boolean;
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
	/** Layers, bottom to top. Absent: one implicit layer holding everything. */
	layers?: LayerInfo[];
	/** The layer new items go to; absent or unknown: the bottom layer. */
	activeLayer?: string;
	/** Root card id → the auto layout last applied to its map (Markdown round trip re-applies it). */
	mapLayouts?: Record<string, MapLayout>;
	/** Pages: parts of the board shown one at a time (nodes carry `page`). */
	pages?: PageInfo[];
	/** Parent card id → its children's ids in outline order (sibling order kept by every layout). */
	childOrder?: Record<string, string[]>;
	/**
	 * Table of contents, free arrangement: parent card id (or "page:<page id>", "page:" for the
	 * main page's top level) → how its children's cells are arranged and grouped.
	 */
	tocLayouts?: Record<string, TocArrangement>;
	/** Table of contents: the layout is locked (cells and groups can't be moved; reading, tools and navigating still work). */
	tocLocked?: boolean;
	/** Drawing embeds: SVG file path (in the vault) → the drawings it shows; written again when they change. */
	inkEmbeds?: Record<string, string[]>;
	/** Page format: the board shows sheets of this paper size (absent: the infinite canvas). */
	paper?: PaperSpec;
}

export const PAPER_FORMAT_IDS = ["A3", "A4", "A5", "Letter", "Legal", "custom"] as const;
export type PaperFormatId = (typeof PAPER_FORMAT_IDS)[number];

/** A page format and where its sheets are. */
export interface PaperSpec {
	format: PaperFormatId;
	landscape?: boolean;
	/** Custom size in millimetres. */
	width?: number;
	height?: number;
	/** Each page of the canvas ("" = the main page) → its stack of sheets: top-left and sheets added by hand. */
	stacks?: Record<string, { x: number; y: number; count?: number }>;
}

/**
 * A cell (the card id), or cells side by side ("row") or one under another ("col"). A split with
 * `group` is a sub-group: its cells inside an outline of their own, inside the block's group.
 */
export type TocTree = string | TocSplit;

export interface TocSplit {
	dir: "row" | "col";
	items: TocTree[];
	group?: TocSubGroup;
}

export const TOC_LINES = ["solid", "dashed", "dotted"] as const;
export type TocLine = (typeof TOC_LINES)[number];

/** How a group's or sub-group's outline looks; absent fields use the settings' defaults. */
export interface TocGroupStyle {
	/** A canvas color "1"–"6", a theme's extra color "7"–"32", or "#rrggbb". */
	color?: string;
	/** Outline thickness in px. */
	width?: number;
	line?: TocLine;
	/** Corner radius in px. */
	radius?: number;
}

/** A sub-group's id and outline. */
export interface TocSubGroup extends TocGroupStyle {
	id: string;
}

/** A cell of the table of contents' grid: one card, or a cell group (with its outline; groups only). */
export interface TocBlock extends TocGroupStyle {
	id: string;
	tree: TocTree;
}

/** The rows of the table of contents' grid, each a list of cells and cell groups. */
export interface TocArrangement {
	rows: TocBlock[][];
}

/** A page made from a branch: `anchor` stays in the parent page and leads to `root`. */
export interface PageInfo {
	id: string;
	/** The card left in the parent page (the break point). */
	anchor: string;
	/** The page's root card (a copy of the anchor that holds the branch). */
	root: string;
	/** The page the anchor is on; absent: the main page. */
	parent?: string;
}

export interface LayerInfo {
	id: string;
	name: string;
	hidden?: boolean;
	locked?: boolean;
}

/** Fonts a card's text can take besides the canvas's own. */
export const CARD_FONTS = ["hand"] as const;
export type CardFont = (typeof CARD_FONTS)[number];

export interface OpcNode {
	kind?: NodeKind;
	shape?: ShapeName;
	border?: BorderStyle;
	align?: TextAlign;
	/** Vertical text position; without it text sits at the top (stickies: middle). */
	valign?: VerticalAlign;
	/** Text size of the card in pixels; without it the canvas's own size. */
	fontSize?: number;
	/** The card's text in a handwriting style ("hand"); without it the canvas's own font. */
	font?: CardFont;
	/** A header card: a heading in the Markdown note. 0 = automatic level, 1–6 = its own level, -1 = never (wins over the automatic header rules). */
	header?: number;
	dir?: Direction;
	/** Grow and shrink in height to fit the text. */
	autoResize?: boolean;
	/** Grow and shrink in width to fit the longest line (lines don't wrap). */
	autoWidth?: boolean;
	/** Width fits the text up to a maximum (then lines wrap); height follows. */
	autoFit?: boolean;
	/** Ink carriers: the card the strokes were drawn on; the ink moves, copies and deletes with it. */
	anchor?: string;
	/** A card made to hold a drawing ("Embed into a new card"): the ink stuck to it stretches when it is resized. */
	drawingCard?: boolean;
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
	guide?: GuideData;
	/** Id of the layer the item is on; absent or unknown: the bottom layer. */
	layer?: string;
	/** The page this item is on; absent: the main page. */
	page?: string;
	/** A presentation slide (a group made with "Add slide"). */
	slide?: boolean;
	/** Smart group id: cards with the same id are selected and moved as one (no frame). */
	smartGroup?: string;
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
	/** `route` was set by auto layout because no side gave a clear path; a later layout may undo it. */
	bent?: boolean;
}

/** Values equal to these are not stored, which keeps files small. */
export const NODE_DEFAULTS: Readonly<Partial<OpcNode>> = {
	border: "solid",
	align: "start",
	autoResize: false,
	autoWidth: false,
	autoFit: false,
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
