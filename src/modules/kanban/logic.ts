/**
 * Kanban sync rules (pure, unit-tested). See docs/KANBAN.md for the conflict rules.
 */
import { center, contains, type Rect } from "../../geometry/grid";

export interface Column {
	id: string;
	box: Rect;
	key: string;
	value: string;
}

/** The innermost bound group containing the card's center. */
export function columnAt(columns: readonly Column[], card: Rect): Column | null {
	const c = center(card);
	let best: Column | null = null;
	for (const col of columns) {
		if (!contains(col.box, c)) continue;
		if (!best || col.box.width * col.box.height < best.box.width * best.box.height) best = col;
	}
	return best;
}

const norm = (v: unknown) => String(v).trim().toLocaleLowerCase();

/** Whether a frontmatter value means `value` (strings, numbers, booleans; lists match any item). */
export function propertyMatches(prop: unknown, value: string): boolean {
	if (prop === null || prop === undefined) return false;
	if (Array.isArray(prop)) return prop.some((p) => propertyMatches(p, value));
	if (typeof prop === "object") return false;
	return norm(prop) === norm(value);
}

/**
 * Where a card should go after its note's property changed: a column with the same key whose
 * value matches, or null when it should stay (already right, or no column matches).
 * `columns` must be in reading order; the first match wins.
 */
export function targetColumn(columns: readonly Column[], current: Column, prop: unknown): Column | null {
	if (propertyMatches(prop, current.value)) return null;
	return columns.find((c) => c.key === current.key && c.id !== current.id && propertyMatches(prop, c.value)) ?? null;
}

/** A frontmatter value for a column ("todo" for "To do"). */
export function slug(label: string): string {
	return label
		.trim()
		.toLocaleLowerCase()
		.replace(/\s+/g, "-")
		.replace(/[^\p{L}\p{N}_-]/gu, "");
}
