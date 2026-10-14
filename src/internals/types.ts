/**
 * Structural types for Obsidian's undocumented Canvas objects.
 *
 * Only the members this plugin actually relies on are listed. Every member here must have
 * an entry in docs/INTERNALS.md (what it does, how it was verified, Obsidian version).
 * Nothing outside src/internals/ and the modules' patches.ts files should reach past
 * these types into the raw objects.
 */
import type { App, Debouncer, TFile, View } from "obsidian";
import type { CanvasFileData, CanvasEdgeData, CanvasNodeData, EdgeSide } from "../data/json-canvas";

export interface BBox {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
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
	x: number;
	y: number;
	width: number;
	height: number;
	color: string;
	/** Every property of the node's JSON that Obsidian itself doesn't model (our "x-opc" lives here). */
	unknownData: Record<string, unknown>;
	nodeEl: HTMLElement;
	getData(): CanvasNodeData;
	setData(data: CanvasNodeData): void;
	render(): void;
	getBBox(): BBox;
}

export interface CanvasEdgeEndLike {
	node: CanvasNodeLike;
	side: EdgeSide;
	end: "none" | "arrow";
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
	getData(): CanvasEdgeData;
	setData(data: CanvasEdgeData): void;
	render(): void;
	getBBox(): BBox;
}

export type CanvasItemLike = CanvasNodeLike | CanvasEdgeLike;

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
	wrapperEl: HTMLElement;
	canvasEl: HTMLElement;
	cardMenuEl: HTMLElement;

	getData(): CanvasFileData;
	setData(data: CanvasFileData): void;
	importData(data: CanvasFileData, clear?: boolean): void;
	requestSave(pushHistory?: boolean): void;
	pushHistory(data: CanvasFileData): void;
	undo(): void;
	redo(): void;
	applyHistory(data: CanvasFileData): void;
	markDirty(item: CanvasItemLike): void;
	markMoved(item: CanvasItemLike): void;
	requestFrame(): void;
	setViewport(x: number, y: number, zoom: number): void;
	getViewportBBox(): BBox;
	zoomToFit(): void;
	zoomToSelection(): void;
}

export interface CanvasViewLike extends View {
	canvas: CanvasLike;
	file: TFile | null;
	requestSave(): void;
	getViewData(): string;
	setViewData(data: string, clear: boolean): void;
}
