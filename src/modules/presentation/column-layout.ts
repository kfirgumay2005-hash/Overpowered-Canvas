// Geometry of the column view (pure, unit-tested).

/** Zoom and pan of the column view: screen = (x, y) + zoom × layout point. */
export interface View {
	zoom: number;
	x: number;
	y: number;
}

/**
 * Left edge of each column: the next column starts after the card it continues from (its width
 * is `reach`), so with cards of different sizes the children still sit right beside their parent.
 */
export function columnPositions(reaches: number[], gap: number): number[] {
	const out: number[] = [];
	let x = 0;
	for (const reach of reaches) {
		out.push(x);
		x += reach + gap;
	}
	return out;
}

/** The view at `zoom` with the middle of the layout in the middle of the screen. */
export function keepZoom(zoom: number, size: { width: number; height: number }): View {
	return { zoom, x: (size.width / 2) * (1 - zoom), y: (size.height / 2) * (1 - zoom) };
}

/** The view zoomed to `zoom`, keeping what is under the screen point `at` where it is. */
export function zoomAround(view: View, zoom: number, at: { x: number; y: number }): View {
	const lx = (at.x - view.x) / view.zoom;
	const ly = (at.y - view.y) / view.zoom;
	return { zoom, x: at.x - zoom * lx, y: at.y - zoom * ly };
}
