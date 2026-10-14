/**
 * Structural types for Obsidian's undocumented Canvas objects.
 *
 * Only the members this plugin actually relies on are listed. Every member here must have
 * an entry in docs/INTERNALS.md (what it does, how it was verified, Obsidian version).
 * Nothing outside src/internals/, src/core/canvas-hooks.ts and the modules' patches.ts files
 * should reach past these types into the raw objects.
 */
import type { App, Debouncer, TFile, View } from "obsidian";
import type { CanvasFileData, CanvasEdgeData, CanvasNodeData, EdgeSide } from "../data/json-canvas";

export interface BBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface Point {
	x: number;
	y: number;
}

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Undo/redo stack. Each entry is a full snapshot produced by `canvas.getData()`. */
export interface CanvasHistoryLike {
	data: CanvasFileData[];
	current: number;
	max: number;
	canUndo(): boolean;
	canRedo(): boolean;
	push(data: CanvasFileData): void;
	replace(data: CanvasFileData): void;
	clear(): void;
}

export interface CanvasNodeLike {
	readonly id: string;
	readonly canvas: CanvasLike;
	readonly app: App;
	x: number;
	y: number;
	width: number;
	height: number;
	color: string;
	zIndex: number;
	/** Every property of the node's JSON that Obsidian itself doesn't model (our "x-opc" lives here). */
	unknownData: Record<string, unknown>;
	nodeEl: HTMLElement;
	/** Created by initialize() on first render. */
	containerEl?: HTMLElement;
	contentEl?: HTMLElement;
	placeholderEl?: HTMLElement;
	labelEl?: HTMLElement | null;
	initialized: boolean;
	isEditing: boolean;
	aspectRatio: number;
	/** Text nodes. */
	text?: string;
	/** File nodes. */
	file?: TFile | null;
	filePath?: string;
	subpath?: string;
	/** Group nodes. */
	label?: string;
	/** Embedded content (markdown embed, image, pdf…), when loaded. */
	child?: unknown;
	readonly isAttached: boolean;
	getData(): CanvasNodeData;
	setData(data: CanvasNodeData): void;
	render(): void;
	getBBox(): BBox;
	moveTo(pos: Point): void;
	resize(size: { width: number; height: number }): void;
	moveAndResize(rect: Rect): void;
	setColor(color: string, render?: boolean): void;
	updateZIndex(): void;
	renderZIndex(): void;
	updateBreakpoint(show: boolean): void;
	startEditing(): void;
	focus(): void;
	blur(): void;
}

export interface CanvasEdgeEndLike {
	node: CanvasNodeLike;
	side: EdgeSide;
	end: "none" | "arrow";
}

export interface CanvasEdgeLineEndLike {
	el: SVGGElement;
	type: "arrow";
}

export interface CanvasEdgeLike {
	readonly id: string;
	readonly canvas: CanvasLike;
	from: CanvasEdgeEndLike;
	to: CanvasEdgeEndLike;
	color: string;
	label: string;
	/** Same role as on nodes. */
	unknownData: Record<string, unknown>;
	lineGroupEl: SVGGElement;
	lineEndGroupEl: SVGGElement;
	initialized: boolean;
	/** Created by initialize(). */
	path?: { interaction: SVGPathElement; display: SVGPathElement };
	fromLineEnd?: CanvasEdgeLineEndLike | null;
	toLineEnd?: CanvasEdgeLineEndLike | null;
	/** Bezier geometry of the last updatePath(); getCenter() reads it. */
	bezier?: { from: Point; to: Point; cp1: Point; cp2: Point; path: string };
	labelElement?: { wrapperEl: HTMLElement; render(): void } | null;
	readonly isAttached: boolean;
	getData(): CanvasEdgeData;
	setData(data: CanvasEdgeData): void;
	render(): void;
	updatePath(): void;
	update(from: CanvasEdgeEndLike, to: CanvasEdgeEndLike): void;
	getBBox(): BBox;
	getCenter(): Point;
	setColor(color: string, render?: boolean): void;
}

export type CanvasItemLike = CanvasNodeLike | CanvasEdgeLike;

/** The floating selection toolbar ("popup menu"). */
export interface CanvasMenuLike {
	readonly canvas: CanvasLike;
	containerEl: HTMLElement;
	menuEl: HTMLElement;
	/** rebuild = true recreates the buttons; false only repositions. */
	render(rebuild: boolean): void;
}

export interface CanvasConfigLike {
	zoomMultiplier: number;
	objectSnapDistance: number;
	minContainerDimension: number;
	defaultTextNodeDimensions: { width: number; height: number };
	defaultFileNodeDimensions: { width: number; height: number };
}

export interface CanvasOptionsLike {
	snapToGrid?: boolean;
	snapToObjects?: boolean;
	zoomBreakpoint?: number;
	[key: string]: unknown;
}

export interface EdgeIndexLike {
	add(node: CanvasNodeLike, edge: CanvasEdgeLike): void;
	delete(node: CanvasNodeLike, edge: CanvasEdgeLike): void;
	getArray(node: CanvasNodeLike): CanvasEdgeLike[];
}

export interface CanvasLike {
	readonly app: App;
	readonly view: CanvasViewLike;
	nodes: Map<string, CanvasNodeLike>;
	edges: Map<string, CanvasEdgeLike>;
	selection: Set<CanvasItemLike>;
	/** Last full file data. Root-level unknown keys survive because getData() spreads this object. */
	data: CanvasFileData;
	history: CanvasHistoryLike;
	/** Debounced (250 ms) pushHistory. */
	requestPushHistory: Debouncer<[CanvasFileData], void>;
	readonly: boolean;
	x: number;
	y: number;
	/** log2 of the scale: scale = 2 ** zoom. */
	zoom: number;
	scale: number;
	tx: number;
	ty: number;
	tZoom: number;
	zIndexCounter: number;
	isDragging: boolean;
	config: CanvasConfigLike;
	readonly options: CanvasOptionsLike;
	readonly zoomBreakpoint: number;
	readonly gridSpacing: number;
	canvasRect: { width: number; height: number; cx: number; cy: number; left: number; top: number };
	wrapperEl: HTMLElement;
	canvasEl: HTMLElement;
	cardMenuEl: HTMLElement;
	canvasControlsEl: HTMLElement;
	edgeContainerEl: SVGSVGElement;
	edgeEndContainerEl: SVGSVGElement;
	menu: CanvasMenuLike;
	/** Multimaps node → edges starting / ending there (used by getEdgesForNode). */
	edgeFrom: EdgeIndexLike;
	edgeTo: EdgeIndexLike;

	getData(): CanvasFileData;
	setData(data: CanvasFileData): void;
	importData(data: CanvasFileData, clear?: boolean): Set<CanvasNodeLike> | undefined;
	getSelectionData(selection?: Set<CanvasItemLike>): { nodes: CanvasNodeData[]; edges: CanvasEdgeData[]; center: Point };
	requestSave(pushHistory?: boolean): void;
	pushHistory(data: CanvasFileData): void;
	overrideHistory(): void;
	undo(): void;
	redo(): void;
	applyHistory(data: CanvasFileData): void;
	markDirty(item: CanvasItemLike): void;
	markMoved(item: CanvasItemLike): void;
	markViewportChanged(): void;
	requestFrame(): void;
	setViewport(x: number, y: number, zoom: number): void;
	panTo(x: number, y: number): void;
	panBy(dx: number, dy: number): void;
	zoomBy(delta: number, center?: Point): void;
	getViewportBBox(): BBox;
	zoomToFit(): void;
	zoomToSelection(): void;
	zoomToBbox(bbox: BBox): void;
	panIntoView(bbox: BBox): void;
	posFromEvt(evt: MouseEvent): Point;
	posFromClient(pos: Point): Point;
	domFromPos(pos: Point): Point;
	posCenter(): Point;
	getIntersectingNodes(bbox: BBox): CanvasNodeLike[];
	getContainingNodes(bbox: BBox): CanvasNodeLike[];
	getEdgesForNode(node: CanvasNodeLike): CanvasEdgeLike[];
	addNode(node: CanvasNodeLike): void;
	removeNode(node: CanvasNodeLike): void;
	addEdge(edge: CanvasEdgeLike): void;
	removeEdge(edge: CanvasEdgeLike): void;
	select(item: CanvasItemLike): void;
	deselect(item: CanvasItemLike): void;
	selectOnly(item: CanvasItemLike): void;
	selectAll(items?: Set<CanvasItemLike>): void;
	deselectAll(): void;
	deleteSelection(): void;
	updateSelection(fn: () => void): void;
	createTextNode(opts: { pos: Point; size?: { width: number; height: number }; position?: "center" | "left" | "right" | "top" | "bottom"; text?: string; save?: boolean; focus?: boolean }): CanvasNodeLike;
	createFileNode(opts: { pos: Point; size?: { width: number; height: number }; position?: string; file: TFile; subpath?: string; save?: boolean; focus?: boolean }): CanvasNodeLike;
	createGroupNode(opts: { pos: Point; size?: { width: number; height: number }; position?: string; label?: string; save?: boolean; focus?: boolean }): CanvasNodeLike;
	dragTempNode(evt: PointerEvent, size: { width: number; height: number }, onDrop: (pos: Point) => void): void;
	setReadonly(readonly: boolean): void;
	getZIndex(): number;
	rerenderViewport(): void;
}

export interface CanvasViewLike extends View {
	canvas: CanvasLike;
	file: TFile | null;
	requestSave(): void;
	save(clear?: boolean): Promise<void>;
	getViewData(): string;
	setViewData(data: string, clear: boolean): void;
}
