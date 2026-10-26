import type { TFile, Workspace } from "obsidian";
import type { CanvasFileData } from "../data/json-canvas";
import type { CanvasEdgeLike, CanvasItemLike, CanvasLike, CanvasNodeLike } from "../internals/types";

export const EVENT_PREFIX = "overpowered-canvas:";

export type InteractionType = "click" | "dblclick" | "contextmenu";

/**
 * Public events, triggered on app.workspace as "overpowered-canvas:<name>".
 * Other plugins listen with app.workspace.on("overpowered-canvas:<name>", ...).
 * The payload tuples are part of the public API — see docs/EVENTS.md.
 */
export interface PublicEventMap {
	// Plugin
	"module-enabled": [moduleId: string];
	"module-disabled": [moduleId: string];

	// Canvas lifecycle and data (events-api module)
	"node-created": [canvas: CanvasLike, node: CanvasNodeLike];
	"node-removed": [canvas: CanvasLike, node: CanvasNodeLike];
	"node-moved": [canvas: CanvasLike, node: CanvasNodeLike];
	"node-changed": [canvas: CanvasLike, node: CanvasNodeLike];
	"edge-created": [canvas: CanvasLike, edge: CanvasEdgeLike];
	"edge-removed": [canvas: CanvasLike, edge: CanvasEdgeLike];
	"edge-changed": [canvas: CanvasLike, edge: CanvasEdgeLike];
	"node-interaction": [canvas: CanvasLike, node: CanvasNodeLike, type: InteractionType, evt: MouseEvent];
	"edge-interaction": [canvas: CanvasLike, edge: CanvasEdgeLike, type: InteractionType, evt: MouseEvent];
	"selection-changed": [canvas: CanvasLike, selection: CanvasItemLike[]];
	undo: [canvas: CanvasLike];
	redo: [canvas: CanvasLike];
	"readonly-changed": [canvas: CanvasLike, readonly: boolean];
	"data-requested": [canvas: CanvasLike, data: CanvasFileData];
	"data-loaded": [canvas: CanvasLike, data: CanvasFileData];
	"before-save": [canvas: CanvasLike];
	"after-save": [canvas: CanvasLike];

	// Features
	"focus-mode-changed": [canvas: CanvasLike, enabled: boolean];
	"group-collapsed": [group: CanvasNodeLike];
	"group-expanded": [group: CanvasNodeLike];
	"presentation-started": [canvas: CanvasLike, slide: CanvasNodeLike];
	"presentation-slide-changed": [canvas: CanvasLike, slide: CanvasNodeLike, index: number];
	"presentation-ended": [canvas: CanvasLike];
	"selection-encapsulated": [canvas: CanvasLike, file: TFile];
	"portal-opened": [canvas: CanvasLike, portal: CanvasNodeLike];
	"portal-closed": [canvas: CanvasLike, portal: CanvasNodeLike];
	"pdf-inserted": [canvas: CanvasLike, file: TFile, pages: number];
	"style-attribute-changed": [canvas: CanvasLike, item: CanvasItemLike, key: string, value: string | null];
	"layout-applied": [canvas: CanvasLike, nodes: CanvasNodeLike[], algorithm: string];
	"branch-collapsed": [node: CanvasNodeLike];
	"branch-expanded": [node: CanvasNodeLike];
	"stroke-added": [canvas: CanvasLike, carrier: CanvasNodeLike, strokeId: string];
	"strokes-erased": [canvas: CanvasLike, count: number];
	"drawing-mode-changed": [canvas: CanvasLike, tool: string | null];
	"shape-created": [canvas: CanvasLike, node: CanvasNodeLike];
	"sticky-created": [canvas: CanvasLike, node: CanvasNodeLike];
	"item-lock-changed": [canvas: CanvasLike, item: CanvasItemLike, locked: boolean];
	"minimap-toggled": [canvas: CanvasLike, visible: boolean];
	"frame-focused": [canvas: CanvasLike, frame: CanvasNodeLike];
	"board-template-applied": [canvas: CanvasLike, templateName: string];
	"kanban-moved": [canvas: CanvasLike, node: CanvasNodeLike, file: TFile, value: string];
	"query-group-refreshed": [canvas: CanvasLike, group: CanvasNodeLike, added: number, removed: number];
	"outline-copied": [canvas: CanvasLike, cards: number];
	"outline-inserted": [canvas: CanvasLike, nodes: CanvasNodeLike[]];
	"note-exported": [canvasFile: TFile, note: TFile];
	"canvas-updated-from-note": [canvasFile: TFile, note: TFile, added: number, removed: number, updated: number];
}

export type PublicEventName = keyof PublicEventMap;

export class PublicEvents {
	constructor(private readonly workspace: Workspace) {}

	emit<K extends PublicEventName>(name: K, ...args: PublicEventMap[K]): void {
		try {
			this.workspace.trigger(`${EVENT_PREFIX}${name}`, ...args);
		} catch (error) {
			// A listener in another plugin must never break us.
			console.error(`[overpowered-canvas] listener of ${name} threw`, error);
		}
	}
}
