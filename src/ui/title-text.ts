// A card's text as a one-line title (pure, unit-tested): the Markdown to render, or plain text.

/** The first non-empty line, without what makes it a block (heading, list item, task, quote). */
function firstLine(text: string): string {
	const first = text.split("\n").find((l) => l.trim()) ?? "";
	return first
		.replace(/^\s*(?:>\s*)+/, "")
		.replace(/^\s*#{1,6}\s+/, "")
		.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/, "")
		.trim();
}

/**
 * The Markdown of a card's title: its first line as written (formatting, HTML the plugin writes
 * for highlights and text colors, links, emoji), embeds turned into plain links (a title shows no
 * pictures or embedded notes).
 */
export function titleMarkdown(text: string): string {
	return firstLine(text)
		.replace(/!\[\[/g, "[[")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
}

/** Plain text (a file's or a group's name) as Markdown that shows exactly that text. */
export function escapeMarkdown(text: string): string {
	return text.replace(/[\\`*_~=[\]<>#|$^&%]/g, (c) => `\\${c}`);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** A card's title as plain text: no Markdown marks, no HTML tags, links as their text. */
export function plainTitle(text: string): string {
	return titleMarkdown(text)
		.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
		.replace(/\[\[([^\]]*)\]\]/g, (_, target: string) => target.split("/").pop()!.replace(/#.*$/, ""))
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]*>/g, "")
		.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
			if (code[0] === "#") {
				const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
				return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
			}
			return ENTITIES[code.toLowerCase()] ?? m;
		})
		.replace(/[*_~`=]+/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
}
