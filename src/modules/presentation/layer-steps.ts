/**
 * Presentation by layers, pure part (unit-tested): which layers each step shows. A step reveals
 * layers; "accumulate" keeps what earlier steps showed, "replace" hides it. Base layers are shown
 * all the time. Visibility at a step is folded from the first step, so going back is exact.
 */
import type { LayerCamera, LayerInfo, LayerReveal, LayerSequence } from "../../data/schema";

export const DEFAULT_REVEAL: LayerReveal = "accumulate";
export const DEFAULT_CAMERA: LayerCamera = "canvas";

/** A step ready to play: the layers it reveals and how. */
export interface RevealStep {
	layers: readonly string[];
	reveal: LayerReveal;
	camera: LayerCamera;
}

/** The sequence as it will play on these layers. */
export interface ResolvedSequence {
	steps: RevealStep[];
	/** Shown throughout. */
	base: string[];
	/** True when no step list is stored: every layer, bottom to top. */
	implicit: boolean;
	reveal: LayerReveal;
	camera: LayerCamera;
}

/**
 * Steps of layers that still exist, each layer once; base layers are never steps. Without stored
 * steps, every layer shown now that is not a base layer, bottom to top.
 */
export function resolveSequence(seq: Readonly<LayerSequence> | undefined, layers: readonly LayerInfo[]): ResolvedSequence {
	const ids = new Set(layers.map((l) => l.id));
	const reveal = seq?.reveal ?? DEFAULT_REVEAL;
	const camera = seq?.camera ?? DEFAULT_CAMERA;
	const base = [...new Set((seq?.base ?? []).filter((id) => ids.has(id)))];
	const isBase = new Set(base);
	const stored = seq?.steps ?? [];
	const seen = new Set<string>();
	const steps: RevealStep[] = [];
	for (const s of stored) {
		if (!ids.has(s.layer) || isBase.has(s.layer) || seen.has(s.layer)) continue;
		seen.add(s.layer);
		steps.push({ layers: [s.layer], reveal: s.reveal ?? reveal, camera: s.camera ?? camera });
	}
	const implicit = !seq?.steps;
	// Not the layers hidden now: those are notes the presenter keeps out of sight.
	if (implicit) for (const l of layers) if (!isBase.has(l.id) && !l.hidden) steps.push({ layers: [l.id], reveal, camera });
	return { steps, base, implicit, reveal, camera };
}

/** Layers the steps up to and including `index` leave shown (base layers not included). */
export function shownAt(steps: readonly Pick<RevealStep, "layers" | "reveal">[], index: number): Set<string> {
	let shown = new Set<string>();
	for (let i = 0; i <= Math.min(index, steps.length - 1); i++) {
		const step = steps[i]!;
		if (step.reveal === "replace") shown = new Set(step.layers);
		else for (const id of step.layers) shown.add(id);
	}
	return shown;
}

/**
 * Which layers to hide while presenting (layer id → hidden). Managed layers are shown only when a
 * step showed them or they are base layers; other layers keep the visibility they have.
 */
export function presentedVisibility(
	layers: readonly Pick<LayerInfo, "id" | "hidden">[],
	managed: ReadonlySet<string>,
	shown: ReadonlySet<string>,
	base: ReadonlySet<string>,
): Map<string, boolean> {
	const out = new Map<string, boolean>();
	for (const l of layers) out.set(l.id, base.has(l.id) ? false : managed.has(l.id) ? !shown.has(l.id) : !!l.hidden);
	return out;
}

/**
 * Slides and frames that reveal layers: the steps along the path presented so far (stops without
 * layers to reveal are no steps), and every layer any stop reveals (those start hidden).
 */
export function slideSteps(path: readonly string[], revealOf: (id: string) => readonly string[] | undefined, reveal: LayerReveal): RevealStep[] {
	const steps: RevealStep[] = [];
	for (const id of path) {
		const layers = revealOf(id);
		if (layers && layers.length > 0) steps.push({ layers, reveal, camera: "keep" });
	}
	return steps;
}

/** Moves the item at `from` to index `to` (both in the list as it is). */
export function moveStep<T>(list: readonly T[], from: number, to: number): T[] {
	const out = [...list];
	if (from < 0 || from >= out.length) return out;
	const [item] = out.splice(from, 1);
	out.splice(Math.max(0, Math.min(out.length, to)), 0, item!);
	return out;
}
