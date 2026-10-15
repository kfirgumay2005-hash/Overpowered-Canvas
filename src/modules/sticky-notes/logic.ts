/** Pure helpers for sticky notes (unit-tested). */

/** Pastel sticky colors, stored as the standard JSON Canvas hex color. */
export const STICKY_COLORS = {
	yellow: "#fde68a",
	orange: "#fed7aa",
	pink: "#fbcfe8",
	purple: "#ddd6fe",
	blue: "#bfdbfe",
	green: "#bbf7d0",
} as const;
export type StickyColor = keyof typeof STICKY_COLORS;

export const STICKY_SIZE = 200;
export const RECENT_MAX = 10;

/** Puts `color` first in the recent list, without duplicates, keeping at most RECENT_MAX. */
export function pushRecent(recent: readonly string[], color: string): string[] {
	const c = color.toLowerCase();
	return [c, ...recent.filter((r) => r.toLowerCase() !== c)].slice(0, RECENT_MAX);
}
export const STICKY_GAP = 24;

/** Font size bucket: shorter text in a bigger note gets bigger type. */
export function fontBucket(text: string, width: number, height: number): "xl" | "l" | "m" | "s" | "xs" {
	const chars = text.replace(/\s+/g, " ").trim().length;
	if (chars === 0) return "l";
	// Roughly the font size (px) that would fill the note.
	const fit = Math.sqrt((width * height) / chars) * 0.62;
	if (fit >= 34) return "xl";
	if (fit >= 24) return "l";
	if (fit >= 17) return "m";
	if (fit >= 13) return "s";
	return "xs";
}

export type Dir = "right" | "left" | "down" | "up";

/** Where the next sticky goes, beside `from` in `dir`, skipping over occupied spots. */
export function nextStickyPos(
	from: { x: number; y: number; width: number; height: number },
	dir: Dir,
	occupied: (box: { x: number; y: number; width: number; height: number }) => boolean,
): { x: number; y: number } {
	const dx = dir === "right" ? from.width + STICKY_GAP : dir === "left" ? -(from.width + STICKY_GAP) : 0;
	const dy = dir === "down" ? from.height + STICKY_GAP : dir === "up" ? -(from.height + STICKY_GAP) : 0;
	let x = from.x + dx;
	let y = from.y + dy;
	for (let i = 0; i < 50 && occupied({ x, y, width: from.width, height: from.height }); i++) {
		x += dx;
		y += dy;
	}
	return { x, y };
}
