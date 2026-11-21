/**
 * What other modules may ask the Layers module (set while it is enabled, else null). Presentations
 * show and hide layers through `present`, which never touches the saved visibility.
 */
import type { LayerInfo } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";

export interface LayersApi {
	/** The canvas' layers, bottom to top, as saved (one implicit layer when it has none). */
	layers(canvas: CanvasLike): readonly LayerInfo[];
	/** The id of the layer a card is on. */
	layerOf(node: CanvasNodeLike): string;
	/**
	 * Shows and hides layers for a while, without saving or an undo step: layer id → hidden (layers
	 * left out keep their saved visibility). Layers that appear or disappear fade over `fadeMs`
	 * (0: at once). Null puts the saved visibility back.
	 */
	present(canvas: CanvasLike, hidden: ReadonlyMap<string, boolean> | null, fadeMs: number): void;
	/** True while `present` overrides the visibility of this canvas. */
	presenting(canvas: CanvasLike): boolean;
}

export const layersHost: { api: LayersApi | null } = { api: null };
