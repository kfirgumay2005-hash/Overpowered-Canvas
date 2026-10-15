/** Pure grid math (unit-tested). */

/** The core's dot spacing at normal zoom, in canvas units. */
export const DOT_SPACING = 20;
/** Lines closer than this on screen are thinned out (every 2nd, 4th… line). */
export const MIN_CELL_PX = 8;

/**
 * Screen geometry of the grid pattern: the cell size in screen pixels and the offset of the
 * first line, so that lines sit on multiples of `every` dots in canvas coordinates.
 * (x, y) is the canvas point at the view center, scale the view scale, (width, height) the view size.
 */
export function gridPattern(every: number, view: { x: number; y: number; scale: number; width: number; height: number }): { cell: number; x: number; y: number } {
	let cellUnits = Math.max(1, every) * DOT_SPACING;
	while (cellUnits * view.scale < MIN_CELL_PX) cellUnits *= 2;
	const cell = cellUnits * view.scale;
	const mod = (n: number) => ((n % cellUnits) + cellUnits) % cellUnits;
	return { cell, x: view.width / 2 - mod(view.x) * view.scale, y: view.height / 2 - mod(view.y) * view.scale };
}
