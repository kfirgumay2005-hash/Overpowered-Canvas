import type { App } from "obsidian";
import type { CanvasLike, CanvasViewLike } from "./types";

/** Members the core relies on. If any is missing, Obsidian changed and we must not touch the view. */
const REQUIRED_CANVAS_MEMBERS: readonly [keyof CanvasLike, "function" | "object" | "number" | "boolean"][] = [
	["nodes", "object"],
	["edges", "object"],
	["selection", "object"],
	["data", "object"],
	["history", "object"],
	["requestPushHistory", "function"],
	["wrapperEl", "object"],
	["getData", "function"],
	["setData", "function"],
	["importData", "function"],
	["requestSave", "function"],
	["pushHistory", "function"],
	["applyHistory", "function"],
	["undo", "function"],
	["redo", "function"],
	["markDirty", "function"],
	["requestFrame", "function"],
	["setViewport", "function"],
	["zoom", "number"],
	["readonly", "boolean"],
];

/** Lists the expected Canvas members that are missing or have an unexpected type. Empty = compatible. */
export function findCanvasShapeProblems(canvas: unknown): string[] {
	if (!canvas || typeof canvas !== "object") return ["canvas is not an object"];
	const record = canvas as Record<string, unknown>;
	const problems: string[] = [];
	for (const [name, type] of REQUIRED_CANVAS_MEMBERS) {
		const actual = typeof record[name];
		if (actual !== type) problems.push(`${name}: expected ${type}, got ${actual}`);
	}
	if (!(record.nodes instanceof Map)) problems.push("nodes: expected Map");
	if (!(record.edges instanceof Map)) problems.push("edges: expected Map");
	return problems;
}

/** True for a fully loaded canvas view (deferred/placeholder views are skipped). */
export function isCanvasView(view: unknown): view is CanvasViewLike {
	if (!view || typeof view !== "object") return false;
	const v = view as { getViewType?: () => string; canvas?: unknown };
	return typeof v.getViewType === "function" && v.getViewType() === "canvas" && !!v.canvas && typeof v.canvas === "object";
}

export function getActiveCanvas(app: App): CanvasLike | null {
	const view = app.workspace.getMostRecentLeaf()?.view;
	return isCanvasView(view) ? view.canvas : null;
}
