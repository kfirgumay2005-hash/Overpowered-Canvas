import type { CanvasLike } from "../internals/types";
import type { CanvasTracker } from "./canvas-tracker";

/**
 * Re-measures the rect behind every screen → canvas conversion when the pane has moved. The core
 * measures it on resize only, so a move that is not a resize leaves it stale: a toolbar appearing
 * above the pane, or a phone's open file drawer, which pushes the main area aside with a transform
 * (a canvas opened from the drawer keeps the pushed position until the next resize).
 */
export function syncCanvasRect(canvas: CanvasLike): void {
	const real = canvas.wrapperEl.getBoundingClientRect();
	const known = canvas.canvasRect;
	if (Math.abs(real.top - known.top) > 1 || Math.abs(real.left - known.left) > 1 || Math.abs(real.height - known.height) > 1 || Math.abs(real.width - known.width) > 1) canvas.onResize?.();
}

/** Keeps every open canvas measured correctly: each press starts from the true position. */
export function trackCanvasRects(tracker: CanvasTracker): () => void {
	return tracker.subscribe((canvas) => {
		const sync = () => syncCanvasRect(canvas);
		canvas.wrapperEl.addEventListener("pointerdown", sync, true);
		return () => canvas.wrapperEl.removeEventListener("pointerdown", sync, true);
	});
}
