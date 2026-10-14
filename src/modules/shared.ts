/** Small helpers shared by feature modules. */
import { Notice } from "obsidian";
import { isEdge, isNode } from "../core/canvas-ui";
import type { ModuleContext } from "../core/module";
import { ReadOnlyExtraDataError } from "../data/access";
import { InvalidExtraDataError } from "../data/validate";
import type { CanvasEdgeLike, CanvasItemLike, CanvasLike, CanvasNodeLike } from "../internals/types";

export type NodeType = "text" | "file" | "link" | "group";

/** The JSON Canvas type of a live node, without serializing it. */
export function nodeType(node: CanvasNodeLike): NodeType {
	if (node.nodeEl.hasClass("canvas-node-group")) return "group";
	if ("url" in node) return "link";
	if ("filePath" in node) return "file";
	return "text";
}

export function selectedNodes(canvas: CanvasLike): CanvasNodeLike[] {
	return [...canvas.selection].filter(isNode);
}

export function selectedEdges(canvas: CanvasLike): CanvasEdgeLike[] {
	return [...canvas.selection].filter(isEdge);
}

export function onlyNodes(selection: CanvasItemLike[]): CanvasNodeLike[] | null {
	return selection.length > 0 && selection.every(isNode) ? (selection as CanvasNodeLike[]) : null;
}

export function onlyEdges(selection: CanvasItemLike[]): CanvasEdgeLike[] | null {
	return selection.length > 0 && selection.every(isEdge) ? (selection as CanvasEdgeLike[]) : null;
}

/** The value shared by all items, or undefined when they differ. */
export function common<T, V>(items: T[], get: (item: T) => V): V | undefined {
	if (items.length === 0) return undefined;
	const first = get(items[0]!);
	return items.every((i) => get(i) === first) ? first : undefined;
}

/**
 * Runs a mutation as one undo step and reports failures instead of throwing into UI handlers.
 * Returns false when the mutation failed (and was rolled back).
 */
export function mutate(ctx: ModuleContext<object>, canvas: CanvasLike, fn: () => void): boolean {
	if (canvas.readonly) return false;
	try {
		ctx.history.transaction(canvas, fn);
		return true;
	} catch (error) {
		if (!(error instanceof ReadOnlyExtraDataError)) {
			console.error(`[overpowered-canvas] ${ctx.moduleId}: change failed and was undone`, error);
			if (error instanceof InvalidExtraDataError) new Notice(`Overpowered Canvas: ${error.message}`);
		}
		return false;
	}
}

/** Text direction that applies to a canvas (its wrapper inherits Obsidian's UI direction). */
export function canvasDirection(canvas: CanvasLike): "ltr" | "rtl" {
	return getComputedStyle(canvas.wrapperEl).direction === "rtl" ? "rtl" : "ltr";
}

export function randomId(length = 16): string {
	const bytes = new Uint8Array(length / 2);
	crypto.getRandomValues(bytes);
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Pointer capture that tolerates pointers the browser no longer tracks (synthetic or ended). */
export function capturePointer(el: Element, pointerId: number): void {
	try {
		el.setPointerCapture(pointerId);
	} catch {
		// The gesture still works without capture while the pointer stays over the element.
	}
}
