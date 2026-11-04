/**
 * A note with pages (pure, unit-tested): a canvas with pages exported as a note keeps each page as
 * a section of its own, starting with the page's root as a heading (see structure.ts pageSections).
 * Here the note's current text is read back into those sections, so the note can show one page at
 * a time. Lines are found again by id (a note with hidden ids) or by matching the outline last
 * written (a clean note), so edits, added lines and moved lines keep their page.
 */
import { matchOutline } from "./match";
import type { NoteData } from "./note";
import { DATA_HEADING, readOptions } from "./note";
import { parseOutline, stripFrontmatter, type OutlineItem } from "./outline";
import { withoutTrailingLinks } from "./page-links";
import { pageOfNode, pageOrder, pagesOfRoot, type PageRef } from "./structure";

export interface PageSection {
	/** "" for the main page. */
	page: string;
	/** First line of the section (0-based, in the whole note). */
	from: number;
	/** Line after the section's last line. */
	to: number;
	/** The page root's heading as written. */
	title: string;
	/** Cards (lines) in the section. */
	count: number;
}

export interface PagedNote {
	pages: PageRef[];
	/** Main page first, then the pages in reading order (only pages found in the text). */
	sections: PageSection[];
	/** Canvas card id → line where it is written. */
	lines: Map<string, number>;
	/** Canvas card id → its page ("" = main). */
	pageOfCard: Map<string, string>;
}

function lineCount(text: string): number {
	return text.split("\n").length;
}

/** Where each page's section of a note with pages starts and ends; null for other notes. */
export function readPagedNote(md: string, data: NoteData | null): PagedNote | null {
	if (!data?.paged) return null;
	const pages = pagesOfRoot(data.root);
	if (pages.length === 0) return null;
	const text = md.replace(/\r\n?/g, "\n");
	const { frontmatter, body } = stripFrontmatter(text);
	const offset = frontmatter ? lineCount(frontmatter) - 1 : 0;
	const total = lineCount(text);
	// The hidden data section (a note keeping its data inside) is on no page.
	const dataLine = text.split("\n").findIndex((l, i, all) => l.trim() === DATA_HEADING && all[i - 1]?.trim() === "%%");
	const end = dataLine > 0 ? dataLine - 1 : total;

	const items = parseOutline(body, { lines: true, ...readOptions(data) });
	if (data.outline && !hasIds(items)) matchOutline(items, data.outline);
	const idOf = new Map(Object.entries(data.nodes ?? {}).map(([alias, n]) => [alias, n.id]));
	const pageOfCard = new Map(Object.values(data.nodes ?? {}).map((n) => [n.id, pageOfNode(n)]));
	const lines = new Map<string, number>();
	const counted: { line: number }[] = [];
	const visit = (list: OutlineItem[]) => {
		for (const item of list) {
			if (item.line !== undefined) {
				counted.push({ line: item.line + offset });
				const id = item.id ? idOf.get(item.id) : undefined;
				if (id && !lines.has(id)) lines.set(id, item.line + offset);
			}
			visit(item.children);
		}
	};
	visit(items);

	const titles = new Map<number, string>();
	const collectTitles = (list: OutlineItem[]) => {
		for (const item of list) {
			if (item.line !== undefined) titles.set(item.line + offset, withoutTrailingLinks(item.text.split("\n")[0]!.replace(/^#+\s*/, "")));
			collectTitles(item.children);
		}
	};
	collectTitles(items);

	const starts = pages
		.map((p) => ({ page: p.id, line: lines.get(p.root) }))
		.filter((s): s is { page: string; line: number } => s.line !== undefined && s.line < end)
		.sort((a, b) => a.line - b.line);
	const order = pageOrder(pages);
	const sections: PageSection[] = [];
	const bounds = [{ page: "", line: 0 }, ...starts];
	bounds.forEach((b, i) => {
		const to = i + 1 < bounds.length ? bounds[i + 1]!.line : end;
		if (i > 0 && to <= b.line) return;
		sections.push({ page: b.page, from: b.line, to, title: b.page ? (titles.get(b.line) ?? "") : "", count: counted.filter((c) => c.line >= b.line && c.line < to).length });
	});
	sections.sort((a, b) => order.indexOf(a.page) - order.indexOf(b.page));
	return { pages, sections, lines, pageOfCard };
}

function hasIds(items: OutlineItem[]): boolean {
	return items.some((i) => i.id !== undefined || hasIds(i.children));
}

/** The section holding `line` (the main page's when none does). */
export function sectionAt(note: PagedNote, line: number): PageSection {
	return note.sections.find((s) => line >= s.from && line < s.to) ?? note.sections[0]!;
}
