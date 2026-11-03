/**
 * Links between a break-point card and its page, as a note writes them (pure, unit-tested).
 *
 * On the board the link is a line of its own at the end of the card's text (pages/logic.ts
 * withLink). In a note that would put a blank line and a lone link under the card's line, which
 * breaks the outline, so the note writes it at the end of the card's first line (a bullet, or the
 * page's heading) and the board's form is restored when the note is read back.
 */
import type { PageRef } from "./structure";

/** One link to a card of a canvas: `[[path#id]]` or `[[path#id|label]]`. */
const CARD_LINK = /\[\[[^\]|#\n]*#\^?([^\]|\n]+)(?:\|[^\]\n]*)?\]\]/g;
/** Card links (and spaces) that end a line. */
const TRAILING_LINKS = /(?:\s*\[\[[^\]\n]*\]\])+\s*$/;

/** The cards page links point at: every page's break-point card and root. */
export function pageLinkTargets(pages: PageRef[]): Set<string> {
	return new Set(pages.flatMap((p) => [p.anchor, p.root]));
}

/** The links of `line` when it holds page links and nothing else; else null. */
function onlyPageLinks(line: string, targets: ReadonlySet<string>): string[] | null {
	const links = [...line.matchAll(CARD_LINK)];
	if (!links.length || line.replace(CARD_LINK, "").trim() !== "") return null;
	return links.every((m) => targets.has(m[1]!)) ? links.map((m) => m[0]) : null;
}

/**
 * A card's text as a note writes it: page links standing on their own lines at the end go to the
 * end of the first line. A card that is nothing but its link keeps it.
 */
export function inlinePageLinks(text: string, targets: ReadonlySet<string>): string {
	if (!targets.size) return text;
	const lines = text.split("\n");
	const links: string[] = [];
	let end = lines.length;
	while (end > 0) {
		const line = lines[end - 1]!;
		if (line.trim() === "") {
			end--;
			continue;
		}
		const found = onlyPageLinks(line, targets);
		if (!found) break;
		links.unshift(...found);
		end--;
	}
	while (end > 0 && lines[end - 1]!.trim() === "") end--;
	if (!links.length || end === 0) return text;
	const body = lines.slice(0, end);
	body[0] = `${body[0]!.trimEnd()} ${links.join(" ")}`;
	return body.join("\n");
}

/**
 * A card's text from a note, in the board's form: page links at the end of its first line go back
 * to a line of their own at the end of the text (as pages/logic.ts withLink writes them).
 */
export function outlinePageLinks(text: string, targets: ReadonlySet<string>): string {
	if (!targets.size) return text;
	const lines = text.split("\n");
	const first = lines[0]!;
	const tail = TRAILING_LINKS.exec(first);
	if (!tail || tail.index === 0) return text;
	const links = onlyPageLinks(tail[0], targets);
	if (!links) return text;
	lines[0] = first.slice(0, tail.index).trimEnd();
	const body = lines.join("\n").replace(/\s+$/, "");
	return `${body}\n\n${links.join(" ")}`;
}

/** A page heading's title, without the links back to the card it comes from. */
export function withoutTrailingLinks(title: string): string {
	return title.replace(TRAILING_LINKS, "").trim() || title.trim();
}
