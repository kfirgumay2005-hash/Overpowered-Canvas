/** Pure frame-ordering helpers (unit-tested). */

export interface FrameInfo {
	id: string;
	x: number;
	y: number;
	label: string;
}

/** Frames whose tops are within this many units count as one row. */
const ROW_TOLERANCE = 80;

/**
 * Panel order: ids in `stored` first (those that still exist), then the rest in reading order —
 * rows top to bottom, within a row left to right (right to left in RTL).
 */
export function orderFrames(frames: FrameInfo[], stored: readonly string[] | undefined, rtl: boolean): FrameInfo[] {
	const byId = new Map(frames.map((f) => [f.id, f]));
	const out: FrameInfo[] = [];
	const seen = new Set<string>();
	for (const id of stored ?? []) {
		const f = byId.get(id);
		if (f && !seen.has(id)) {
			out.push(f);
			seen.add(id);
		}
	}
	const rest = frames.filter((f) => !seen.has(f.id)).sort((a, b) => a.y - b.y);
	const rows: FrameInfo[][] = [];
	for (const f of rest) {
		const row = rows[rows.length - 1];
		if (row && Math.abs(f.y - row[0]!.y) <= ROW_TOLERANCE) row.push(f);
		else rows.push([f]);
	}
	for (const row of rows) out.push(...row.sort((a, b) => (rtl ? b.x - a.x : a.x - b.x)));
	return out;
}

/** Moves the item at `from` to position `to` (indices in the original list). */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
	const out = list.slice();
	const [item] = out.splice(from, 1);
	if (item === undefined) return out;
	out.splice(to > from ? to - 1 : to, 0, item);
	return out;
}

export function matches(frame: FrameInfo, query: string): boolean {
	const q = query.trim().toLocaleLowerCase();
	return q === "" || frame.label.toLocaleLowerCase().includes(q);
}
