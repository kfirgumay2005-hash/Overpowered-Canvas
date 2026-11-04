/**
 * Header cards (pure). A card marked as a header (x-opc `header`: 0 = automatic level, 1–6 = a
 * level of its own), or whose text starts with Markdown heading marks (`## …`), leaves the outline
 * in the Markdown note and becomes a real heading that starts its own block; its children go on
 * as the outline below it. Both kinds go through the same code (headerOf → extractHeaders).
 *
 * - Automatic level: one below the nearest heading above it (its map's root or a header card),
 *   at any depth: a header under plain lines of an H2 is an H3. A level of its own can only go
 *   deeper. Past H6 it stays in the outline, as pages do.
 * - Within a heading, the plain lines come first, then the sub-headings in outline order (a
 *   heading's block ends where the next heading starts). A header lifted out from under a plain
 *   line goes back under that line when the note is applied to the canvas (see apply.ts).
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

/** A card that becomes a heading under a heading of `level` (null: it stays in the outline). */
function liftLevel(item: OutlineItem, level: number): number | null {
	if (item.kind !== "node" || item.header === undefined || item.heading !== undefined || item.page) return null;
	return headerLevel(level, item.header);
}

/**
 * Turns the header cards of an outline into headings (see the rules above). In place. Only a
 * card's heading (a map's root, a page's root, a header) takes header cards under it; groups and
 * the free-cards list pass through.
 */
export function extractHeaders(items: OutlineItem[]): void {
	/** A heading: its outline keeps the plain lines, the headers found in it become its sub-headings. */
	const heading = (item: OutlineItem) => {
		const level = item.heading!;
		const plain: OutlineItem[] = [];
		const subs: OutlineItem[] = [];
		/** Plain lines at any depth: the headers among their children are lifted out (outline order). */
		const scan = (list: OutlineItem[], keep: OutlineItem[]) => {
			for (const child of list) {
				const to = liftLevel(child, level);
				if (to !== null) {
					child.heading = to;
					child.text = withoutMarks(child.text);
					subs.push(child);
					heading(child);
				} else if (child.heading !== undefined) {
					subs.push(child);
					visit(child);
				} else {
					keep.push(child);
					const kept: OutlineItem[] = [];
					scan(child.children, kept);
					child.children = kept;
				}
			}
		};
		scan(item.children, plain);
		item.children = [...plain, ...subs];
	};
	const visit = (item: OutlineItem) => {
		if (item.kind === "node" && item.heading !== undefined) heading(item);
		else for (const child of item.children) visit(child);
	};
	for (const item of items) {
		// A map's root written as a heading shows no marks of its own either.
		if (item.kind === "node" && item.heading !== undefined && item.header !== undefined) item.text = withoutMarks(item.text);
		visit(item);
	}
}
