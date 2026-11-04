/**
 * Header cards (pure). A card marked as a header (x-opc `header`: 0 = automatic level, 1–6 = a
 * level of its own), or whose text starts with Markdown heading marks (`## …`), leaves the outline
 * in the Markdown note and becomes a real heading that starts its own block; its children go on
 * as the outline below it.
 *
 * - Automatic level: one below the heading it sits under, so headers at the same depth share a
 *   level and deeper ones take the next levels. A level of its own can only go deeper.
 * - A header becomes a heading only under a heading (its map's root or another header card): a
 *   heading under a plain outline line would lose its parent in Markdown. Past H6 it stays in the
 *   outline, as pages do.
 * - Within a heading, the plain lines come first, then the sub-headings (a heading's block ends
 *   where the next heading starts).
 */
import type { CanvasNodeData } from "../../data/json-canvas";
import type { OutlineItem } from "./outline";

/** Heading marks at the start of a card's text. */
const MARKS = /^(#{1,6})[ \t]+(?=\S)/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The heading marks a text starts with (1–6), else 0. */
export function headingMarks(text: string): number {
	return MARKS.exec(text)?.[1]!.length ?? 0;
}

/** The text without the heading marks it starts with. */
export function withoutMarks(text: string): string {
	return text.replace(MARKS, "");
}

/** The level a card's text marks or its x-opc data sets; 0: automatic; undefined: not a header. */
export function headerOf(node: CanvasNodeData): number | undefined {
	const extra = node["x-opc"];
	const own = isPlainObject(extra) && typeof extra.header === "number" ? extra.header : undefined;
	if (own !== undefined) return own;
	if (node.type !== "text" || typeof node.text !== "string") return undefined;
	return headingMarks(node.text) || undefined;
}

/** The heading level a header card takes under a heading of `parentLevel` (null: stays in the outline). */
export function headerLevel(parentLevel: number, own: number): number | null {
	const level = Math.max(parentLevel + 1, own || 0);
	return level <= 6 ? level : null;
}

/** Turns the header cards of an outline into headings (see the rules above). In place. */
export function extractHeaders(items: OutlineItem[]): void {
	const visit = (item: OutlineItem) => {
		const level = item.kind === "node" ? item.heading : undefined;
		for (const child of item.children) {
			if (level !== undefined && child.kind === "node" && child.header !== undefined && child.heading === undefined && !child.page) {
				const to = headerLevel(level, child.header);
				if (to !== null) {
					child.heading = to;
					child.text = withoutMarks(child.text);
				}
			}
			visit(child);
		}
	};
	for (const item of items) {
		// A map's root written as a heading shows no marks of its own either.
		if (item.kind === "node" && item.heading !== undefined && item.header !== undefined) item.text = withoutMarks(item.text);
		visit(item);
	}
}
