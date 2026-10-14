/** Finding free grid slots inside a group (pure, unit-tested). */

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const GROUP_PAD = 30;
export const GRID_GAP = 20;

function overlaps(a: Rect, b: Rect): boolean {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The first free slot for a `width`×`height` card in reading order (rows top to bottom,
 * mirrored for RTL), avoiding `occupied`. When the group is full the slot lies below it, and
 * `grow` is how much taller the group must become.
 */
export function freeSlot(group: Rect, occupied: readonly Rect[], width: number, height: number, rtl = false): { x: number; y: number; grow: number } {
	const inner = Math.max(width, group.width - 2 * GROUP_PAD);
	const cols = Math.max(1, Math.floor((inner + GRID_GAP) / (width + GRID_GAP)));
	for (let row = 0; row < 1000; row++) {
		for (let col = 0; col < cols; col++) {
			const offset = col * (width + GRID_GAP);
			const x = rtl ? group.x + group.width - GROUP_PAD - width - offset : group.x + GROUP_PAD + offset;
			const y = group.y + GROUP_PAD + row * (height + GRID_GAP);
			const slot = { x, y, width, height };
			if (!occupied.some((o) => overlaps(o, slot))) return { x, y, grow: Math.max(0, y + height + GROUP_PAD - (group.y + group.height)) };
		}
	}
	return { x: group.x + GROUP_PAD, y: group.y + group.height, grow: height + GROUP_PAD };
}

export function center(r: Rect): { x: number; y: number } {
	return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function contains(outer: Rect, p: { x: number; y: number }): boolean {
	return p.x >= outer.x && p.x <= outer.x + outer.width && p.y >= outer.y && p.y <= outer.y + outer.height;
}
