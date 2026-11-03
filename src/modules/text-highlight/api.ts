/**
 * What other modules may ask the text highlighter (set while it is enabled, else null): marking
 * words on cards shown somewhere other than the board (the column view), with the same tool, bar
 * and colors.
 */
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";

/** Highlight the words (a background), or color their text. */
export type MarkMode = "highlight" | "color";

/** A card under the pen: its board card and the element its rendered text is in. */
export interface MarkTarget {
	node: CanvasNodeLike;
	root: HTMLElement;
	/** Makes the text hit-testable for the gesture; returns what undoes it. */
	open?(): () => void;
}

/** Where cards are shown for marking: the board, or another view of the same cards. */
export interface MarkSurface {
	/** The overlay, the previews and the bar go in here. */
	host: HTMLElement;
	/** The card at a screen point (the tool's overlay is out of the way while this runs). */
	cardAt(x: number, y: number): MarkTarget | null;
}

export interface MarksApi {
	/** Turns the tool on for this canvas, on `surface`; `onEnd` runs when it ends. */
	start(canvas: CanvasLike, mode: MarkMode, surface: MarkSurface, onEnd?: () => void): void;
	stop(canvas: CanvasLike): void;
	/** The tool on for this canvas, if any. */
	active(canvas: CanvasLike): MarkMode | null;
}

export const marksHost: { api: MarksApi | null } = { api: null };
