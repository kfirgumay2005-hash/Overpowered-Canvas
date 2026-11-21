/**
 * What other modules may ask the Presentation module about presenting by layers (set while it is
 * enabled, else null): the Layers panel shows and edits the sequence, the Frames presentation
 * reveals the layers its frames carry.
 */
import type { CanvasLike } from "../../internals/types";

/** Reveals layers as a presentation along slides or frames reaches the cards that carry them. */
export interface SlideRevealer {
	/** The stops presented so far, the current one last. */
	show(path: readonly string[]): void;
	/** Puts the saved layer visibility back. */
	end(): void;
}

export interface LayerPresentationApi {
	/** Starts presenting the canvas layer by layer. */
	start(canvas: CanvasLike): void;
	/** Opens the sequence editor. */
	edit(canvas: CanvasLike): void;
	/** The step number (1 = first) a layer is revealed at, or 0 when it is no step. */
	stepOf(canvas: CanvasLike, layerId: string): number;
	isBase(canvas: CanvasLike, layerId: string): boolean;
	/** Adds the layer as the last step, or takes it out of the steps. */
	toggleStep(canvas: CanvasLike, layerId: string): void;
	/** Makes the layer a base layer (shown throughout), or not. */
	toggleBase(canvas: CanvasLike, layerId: string): void;
	/** True while this canvas is presented (any kind of presentation of this module). */
	presenting(canvas: CanvasLike): boolean;
	/** For a presentation of these stops (card ids); null when none of them reveals layers. */
	revealer(canvas: CanvasLike, stops: readonly string[]): SlideRevealer | null;
}

export const layerPresentationHost: { api: LayerPresentationApi | null } = { api: null };
