/**
 * What other modules may ask the drawing module (set while it is enabled, else null): drawing on
 * cards shown somewhere other than the board (the column view), into the same ink.
 */
import type { CanvasLike } from "../../internals/types";
import type { ViewState } from "../../ui/palm-guard";

export interface InkPoint2 {
	x: number;
	y: number;
}

/** Where the pen draws: the board itself, or another view showing its cards at board scale. */
export interface InkSurface {
	/** The overlay and the toolbar go in here. */
	host: HTMLElement;
	/**
	 * The board point under a screen point, or null where nothing can be drawn. `press` is true
	 * at the start of a gesture: the surface may pick there what the gesture belongs to (a card).
	 */
	toCanvas(x: number, y: number, press: boolean): InkPoint2 | null;
	/** Screen pixels per board unit, where the gesture is. */
	scale(): number;
	/** Shows the live preview layer (board coordinates) where the pointer at (x, y) is. */
	placePreview(svg: SVGSVGElement, layer: SVGGElement, x: number, y: number): void;
	/** Moves the view by a screen distance (the drag button). */
	pan(dx: number, dy: number): void;
	/** The view's position and zoom, so a palm's pan can be undone when the pen lands. */
	view?: ViewState;
	/** Pens, eraser and lasso only: lines, arrows and recognized shapes would not show there. */
	inkOnly?: boolean;
	/**
	 * Resolves once this surface shows ink committed now (the board does within a frame or two;
	 * another view may redraw later). Until then the stroke's live preview stays on screen, so a
	 * stroke never blinks out between the pen lifting and the stroke being drawn for good.
	 */
	settled?(): Promise<void>;
}

export interface InkApi {
	/** Turns drawing on for this canvas, on `surface`; `onEnd` runs when it ends. */
	start(canvas: CanvasLike, surface: InkSurface, onEnd?: () => void): void;
	stop(canvas: CanvasLike): void;
	active(canvas: CanvasLike): boolean;
}

export const inkHost: { api: InkApi | null } = { api: null };
