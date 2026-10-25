// Pure layer arithmetic (unit-tested). Layers are stored bottom to top.
import type { LayerInfo } from "../../data/schema";

/** Id of the implicit bottom layer of a canvas that never had layers. */
export const BASE_LAYER = "base";
export const MAX_LAYERS = 100;

/** Stacking bands. Cards: one band per layer, upwards from 0 (CSS z-index is a 32-bit int). */
const CARD_BAND = 2 ** 24;
/** Groups stay below edges and cards (negative), one smaller band per layer. */
const GROUP_BAND = 2 ** 20;
const GROUP_BASE = -(2 ** 27);

/** The canvas' layers; a canvas without any has one implicit layer. */
export function layersOf(stored: readonly LayerInfo[] | undefined, baseName: string): LayerInfo[] {
	return stored && stored.length > 0 ? stored.map((l) => ({ ...l })) : [{ id: BASE_LAYER, name: baseName }];
}

/** Index of a layer, bottom = 0. Unknown or absent ids belong to the bottom layer. */
export function layerIndex(layers: readonly LayerInfo[], id: string | undefined): number {
	if (!id) return 0;
	const i = layers.findIndex((l) => l.id === id);
	return i < 0 ? 0 : i;
}

/** The layer an item is on (unknown ids → bottom layer). */
export function layerOf(layers: readonly LayerInfo[], id: string | undefined): LayerInfo {
	return layers[layerIndex(layers, id)]!;
}

/**
 * CSS z-index of a card on layer `index`. `local` is the core's own value (its stacking order,
 * or the raised value of a single selected card), kept inside the layer's band.
 */
export function cardZ(index: number, local: number): number {
	const half = CARD_BAND / 2 - 1;
	return index * CARD_BAND + Math.max(-half, Math.min(half, Math.round(local)));
}

/**
 * CSS z-index of a group on layer `index`. Within a layer, bigger groups lie under smaller ones
 * (as in the core, which uses -area); the logarithm keeps that order inside the band.
 */
export function groupZ(index: number, area: number): number {
	const local = Math.min(GROUP_BAND - 2, Math.round(Math.log2(1 + Math.max(0, area)) * 4096));
	return GROUP_BASE + (index + 1) * GROUP_BAND - 1 - local;
}

/** "Layer 2", "Layer 3"…: the first number not used by a name made from `template`. */
export function nextLayerName(layers: readonly LayerInfo[], template: (n: number) => string): string {
	const names = new Set(layers.map((l) => l.name));
	let n = layers.length + 1;
	while (names.has(template(n))) n++;
	return template(n);
}

/** Moves the layer at `from` so it ends up at index `to` (both bottom = 0). */
export function moveLayer(layers: readonly LayerInfo[], from: number, to: number): LayerInfo[] {
	const out = [...layers];
	if (from < 0 || from >= out.length) return out;
	const [moved] = out.splice(from, 1);
	out.splice(Math.max(0, Math.min(out.length, to)), 0, moved!);
	return out;
}

/** The layer next to `id` in direction `delta` (+1 = up), or null at the top / bottom. */
export function neighborLayer(layers: readonly LayerInfo[], id: string | undefined, delta: 1 | -1): LayerInfo | null {
	return layers[layerIndex(layers, id) + delta] ?? null;
}

/**
 * Where the items of a deleted layer go: the layer below it, or the one above when it was the
 * bottom layer. Null when it is the only layer (which can't be deleted).
 */
export function heirOf(layers: readonly LayerInfo[], id: string): LayerInfo | null {
	const i = layerIndex(layers, id);
	if (layers.length < 2) return null;
	return layers[i > 0 ? i - 1 : 1]!;
}

