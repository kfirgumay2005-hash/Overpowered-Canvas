/** Canvas-side helpers for free lines. */
import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { nodeType } from "../shared";
import type { P } from "./model";

/** The topmost card under `p` that a line end can attach to (not groups, ink, lines or `except`). */
export function attachTarget(ctx: ModuleContext<object>, canvas: CanvasLike, p: P, except?: CanvasNodeLike): CanvasNodeLike | null {
	return (
		canvas
			.getIntersectingNodes({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y })
			.filter((n) => n !== except && nodeType(n) !== "group" && !["line", "ink"].includes(ctx.data.node(n).get().kind ?? ""))
			.sort((x, y) => y.zIndex - x.zIndex)[0] ?? null
	);
}
