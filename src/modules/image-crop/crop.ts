/** Pure crop-rectangle math (unit-tested). Rects are normalized: 0–1 of the image size. */
import type { CropRect } from "../../data/schema";

export const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };
const MIN = 0.02;

export function isFull(r: CropRect): boolean {
	return r.x <= 0.0005 && r.y <= 0.0005 && r.w >= 0.9995 && r.h >= 0.9995;
}

export function clampRect(r: CropRect): CropRect {
	const w = Math.min(1, Math.max(MIN, r.w));
	const h = Math.min(1, Math.max(MIN, r.h));
	return { x: Math.min(1 - w, Math.max(0, r.x)), y: Math.min(1 - h, Math.max(0, r.y)), w, h };
}

export function roundRect(r: CropRect): CropRect {
	const q = (v: number) => Math.round(v * 10000) / 10000;
	return { x: q(r.x), y: q(r.y), w: q(r.w), h: q(r.h) };
}

/** Aspect ratio (width / height, in pixels) of the cropped image. */
export function croppedRatio(naturalRatio: number, r: CropRect): number {
	return (naturalRatio * r.w) / r.h;
}

export type Handle = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

/**
 * Applies a drag of `handle` by (dx, dy) — normalized — to `start`. With `ratio` (pixel
 * width / height of the crop, given the image's natural ratio) corners keep that ratio.
 */
export function dragRect(start: CropRect, handle: Handle, dx: number, dy: number, lock?: { ratio: number; natural: number }): CropRect {
	if (handle === "move") return clampRect({ ...start, x: start.x + dx, y: start.y + dy });
	let { x, y, w, h } = start;
	const right = x + w;
	const bottom = y + h;
	if (handle.includes("w")) x = Math.min(right - MIN, Math.max(0, x + dx));
	if (handle.includes("e")) w = Math.min(1 - x, Math.max(MIN, w + dx));
	if (handle.includes("n")) y = Math.min(bottom - MIN, Math.max(0, y + dy));
	if (handle.includes("s")) h = Math.min(1 - y, Math.max(MIN, h + dy));
	if (handle.includes("w")) w = right - x;
	if (handle.includes("n")) h = bottom - y;
	if (lock && handle.length === 2) {
		// Normalized height that gives the locked pixel ratio for this width.
		const wantH = (w * lock.natural) / lock.ratio;
		const newH = Math.min(wantH, handle.includes("n") ? bottom : 1 - y);
		const newW = (newH * lock.ratio) / lock.natural;
		if (handle.includes("w")) x = right - newW;
		if (handle.includes("n")) y = bottom - newH;
		w = newW;
		h = newH;
	}
	return clampRect({ x, y, w, h });
}

/** The largest centered rect with the given pixel ratio. */
export function centeredRect(ratio: number, natural: number): CropRect {
	let w = 1;
	let h = natural / ratio;
	if (h > 1) {
		h = 1;
		w = ratio / natural;
	}
	return clampRect({ x: (1 - w) / 2, y: (1 - h) / 2, w, h });
}
