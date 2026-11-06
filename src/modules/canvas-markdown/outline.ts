/**
 * Markdown outline ⇄ item tree (pure, unit-tested; no Obsidian imports so it runs on mobile and
 * in tests). See docs/canvas-markdown-summary.md for the format.
 *
 * - Headings (`#`…`######`) and bullets (`-`, `+`, `*`, `1.`, `1)`) are items; a heading's
 *   bullets (and deeper headings) are its children, bullets nest by indentation.
 * - A trailing hidden comment carries a stable id: `%%n:<id>%%` (card), `%%g:<id>%%` (group),
 *   `%%free%%` (the heading that lists unconnected cards).
 * - Multi-line card text: continuation lines are indented to the bullet's text column; blank
 *   lines inside the text stay blank. A continuation line that would read as a bullet or a
 *   heading is escaped with a leading backslash; fenced code is written untouched.
 */

export type ItemKind = "node" | "group" | "free";

export interface OutlineItem {
	kind: ItemKind;
	text: string;
	/** Stable id from the trailing comment (alias of the canvas id). */
	id?: string;
	/** Heading level when written as a heading. */
	heading?: number;
	/** The root of a page (exports only; not read back from the text). */
	page?: boolean;
	/** A header card (exports only): 0 = automatic level, 1–6 = its own. See headers.ts. */
	header?: number;
	/** Line of the item's first line in the parsed text (0-based), when asked for. */
	line?: number;
	children: OutlineItem[];
}

export interface WriteOptions {
	/** One indentation level for nested bullets: "\t", "    " or "  ". */
	indent: string;
	/** Write the hidden `%%n:id%%` comments. */
	ids: boolean;
	/** Write no hidden comment at all, not even the free-cards mark. */
	clean?: boolean;
	/**
	 * The first level under each heading as plain lines, not bullets, packed: everything between
	 * one heading and the next is one block with no blank line (blank lines only come before
	 * headings). Each first-level item is one line (its further lines on it, joined by `<br>`),
	 * its children as bullets right below it. A heading's own further lines go on its line too.
	 * Read back with `parseOutline(md, { plain: true, tight: true, packed: true })`. In Markdown a
	 * plain line right after a bullet continues that bullet's paragraph, so reading view shows
	 * packed notes through `packedSections` (see packed-view.ts).
	 */
	plain?: boolean;
}

export interface ParseOptions {
	/** Record each item's line. */
	lines?: boolean;
	/** The note was written with `plain` (see WriteOptions): a plain line is a first-level item and the bullets below it are its children. */
	plain?: boolean;
	/**
	 * With `plain`: written by this version (a line right below a heading is the heading's first
	 * plain line, a heading's further lines are on its line after `<br>`). Without it, a plain
	 * note from before: lines right below a heading continue its text.
	 */
	tight?: boolean;
	/**
	 * With `plain` and `tight`: written packed (see WriteOptions.plain): every line at the start of
	 * the line that is no bullet or heading is a first-level item of its own.
	 */
	packed?: boolean;
}

const BULLET = /^([ \t]*)([-+*]|\d{1,9}[.)])(?:[ \t](.*))?$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const MARKER = /[ \t]*%%(?:(n|g):([A-Za-z0-9_-]+)|(free))%%[ \t]*/g;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
/** A blank line inside the text of a plain line or a heading, in plain mode (a real one would end it). */
const BREAK = "<br>";
/** Text that would be read as structure at the start of a continuation line. */
const NEEDS_ESCAPE = /^[ \t]*(?:[-+*](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|#{1,6}(?:[ \t]|$)|\\|`{3,}|~{3,})/;

/** Visual width of leading whitespace (tab = 4 columns). */
function columns(ws: string): number {
	let col = 0;
	for (const ch of ws) col = ch === "\t" ? col + 4 - (col % 4) : col + 1;
	return col;
}

function leading(line: string): string {
	return /^[ \t]*/.exec(line)![0];
}

/** Removes up to `cols` columns of leading whitespace. */
function stripColumns(line: string, cols: number): string {
	let col = 0;
	let i = 0;
	while (i < line.length && col < cols) {
		const ch = line[i];
		if (ch === " ") col++;
		else if (ch === "\t") col += 4 - (col % 4);
		else break;
		i++;
	}
	return line.slice(i);
}

/** The open fence after `line`, given the one open before it. */
function fenceStep(line: string, open: string | null): string | null {
	const f = FENCE.exec(line);
	if (!f) return open;
	if (!open) return f[1]!;
	return f[1]![0] === open[0] && f[1]!.length >= open.length && line.trim() === f[1] ? null : open;
}

function escapeLine(line: string): string {
	return NEEDS_ESCAPE.test(line) ? `\\${line}` : line;
}

function unescapeLine(line: string): string {
	return line.startsWith("\\") && NEEDS_ESCAPE.test(line.slice(1)) ? line.slice(1) : line;
}

/** Splits a first line into text and its trailing id comment. */
/**
 * Splits a first line into text and its id comment. The comment is written at the end, but
 * text typed after it (easy to do while it is shown in the editor) still belongs to the line.
 */
function splitMarker(raw: string): { text: string; kind?: ItemKind; id?: string } {
	const m = [...raw.matchAll(MARKER)].pop();
	if (!m) return { text: raw };
	const before = raw.slice(0, m.index);
	const after = raw.slice(m.index + m[0].length);
	const text = after ? `${before}${before ? " " : ""}${after}` : before;
	if (m[3]) return { text, kind: "free" };
	return { text, kind: m[1] === "g" ? "group" : "node", id: m[2] };
}

/** A heading's text with its further lines on the same line, after `<br>` (plain notes). */
function joinLines(text: string): string {
	return text.split("\n").join(BREAK);
}

function joinedLines(line: string): string {
	return line.split(BREAK).join("\n");
}

/** Removes a leading YAML front matter block. */
export function stripFrontmatter(md: string): { frontmatter: string; body: string } {
	const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(md);
	return m ? { frontmatter: m[0], body: md.slice(m[0].length) } : { frontmatter: "", body: md };
}

interface Open {
	item: OutlineItem;
	/** Columns of the bullet marker (-1 for headings and paragraphs). */
	indent: number;
	/** Column where the text starts; continuation lines strip this much. */
	content: number;
	lines: string[];
	blank: number;
	fence: string | null;
	type: "bullet" | "heading" | "paragraph";
}

/**
 * Parses an outline into items. Plain paragraphs become items too: lines right after a card
 * heading continue its text; elsewhere each paragraph is an item of the enclosing heading. With
 * `plain`, only lines right after the heading continue it (no blank line between), and bullets
 * below a paragraph are its children.
 */
export function parseOutline(md: string, opts: ParseOptions = {}): OutlineItem[] {
	const top: OutlineItem[] = [];
	const headings: { level: number; item: OutlineItem }[] = [];
	let list: { indent: number; item: OutlineItem }[] = [];
	let open: Open | null = null;
	/** Plain mode: the paragraph the next top bullets hang from. */
	let para: OutlineItem | null = null;

	const scope = (): OutlineItem | null => headings[headings.length - 1]?.item ?? null;
	const add = (parent: OutlineItem | null, item: OutlineItem) => (parent ? parent.children : top).push(item);
	const close = () => {
		if (open) open.item.text = open.lines.join("\n");
		open = null;
	};

	const at = (item: OutlineItem, index: number) => {
		if (opts.lines) item.line = index;
		return item;
	};
	const rows = md.replace(/\r\n?/g, "\n").split("\n");
	for (let index = 0; index < rows.length; index++) {
		const line = rows[index]!;
		const blank = line.trim() === "";

		// Inside fenced code of a card: everything is text until the closing fence (or, in a
		// bullet, until a line less indented than its text, as in markdown).
		if (open?.fence) {
			const o: Open = open;
			if (o.type === "bullet" && !blank && columns(leading(line)) < o.content) o.fence = null;
			else {
				const inner = stripColumns(line, o.content);
				o.lines.push(...Array<string>(o.blank).fill(""), inner);
				o.blank = 0;
				o.fence = fenceStep(inner, o.fence);
				continue;
			}
		}

		if (blank) {
			if (open) open.blank++;
			continue;
		}

		const h = HEADING.exec(line);
		if (h) {
			close();
			const level = h[1]!.length;
			const { text, kind, id } = splitMarker(h[2] ?? "");
			const own = opts.plain && opts.tight ? joinedLines(text.trim()) : text.trim();
			const item = at({ kind: kind ?? "node", text: own, heading: level, children: [], ...(id ? { id } : {}) }, index);
			while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
			add(scope(), item);
			headings.push({ level, item });
			list = [];
			para = null;
			open = { item, indent: -1, content: 0, lines: [item.text], blank: 0, fence: fenceStep(item.text, null), type: "heading" };
			continue;
		}

		const b = BULLET.exec(line);
		if (b) {
			close();
			const indent = columns(b[1]!);
			// Groups and the free-cards list are headings only; a marker of theirs on a bullet is ignored.
			const { text, kind, id } = splitMarker(b[3] ?? "");
			const item = at({ kind: "node", text, children: [], ...(id && kind === "node" ? { id } : {}) }, index);
			while (list.length && list[list.length - 1]!.indent >= indent) list.pop();
			add(list[list.length - 1]?.item ?? para ?? scope(), item);
			list.push({ indent, item });
			const markerWidth = b[2]!.length + 1;
			open = { item, indent, content: indent + markerWidth, lines: [text], blank: 0, fence: fenceStep(text, null), type: "bullet" };
			continue;
		}

		// Plain text line.
		const o = open;
		const col = columns(leading(line));
		// Packed: a line at the start of the line is a first-level item of its own, never the
		// lazy continuation of the bullet or plain line above it.
		const packed = !!(opts.plain && opts.packed);
		const continues =
			o !== null &&
			((o.type === "heading" && o.item.kind === "node" && (!opts.plain || (!opts.tight && o.blank === 0))) ||
				(o.type === "bullet" && (col >= o.content || (o.blank === 0 && !(packed && col === 0)))) ||
				(o.type === "paragraph" && o.blank === 0 && !packed));
		if (o && continues) {
			const stripped = o.type === "bullet" ? stripColumns(line, o.content) : line;
			const text =
				opts.plain && o.type !== "bullet" && line.trim() === BREAK ? "" : o.type === "paragraph" ? (opts.plain ? unescapeLine(line.trim()) : line.trim()) : unescapeLine(stripped);
			o.lines.push(...Array<string>(o.blank).fill(""), text);
			o.blank = 0;
			// An escaped fence line is text, not a fence.
			if (o.type !== "paragraph" && text === stripped) o.fence = fenceStep(stripped, null);
			continue;
		}

		// A new paragraph: an item of the enclosing heading (or top level).
		close();
		list = [];
		// Plain mode: the line is a first-level item as written (with its id, escapes undone).
		const first = opts.plain ? splitMarker(unescapeLine(line.trim())) : { text: line.trim() };
		if (opts.plain && opts.packed) first.text = joinedLines(first.text);
		const item = at({ kind: "node", text: first.text, children: [], ...(first.id && first.kind === "node" ? { id: first.id } : {}) }, index);
		add(scope(), item);
		if (opts.plain) para = item;
		open = { item, indent: -1, content: 0, lines: [first.text], blank: 0, fence: null, type: "paragraph" };
	}
	close();
	return top;
}

/** Writes items as an outline. Items with `heading` are headings, the rest bullets. */
export function writeOutline(items: OutlineItem[], opts: WriteOptions): string {
	const out: string[] = [];
	const marker = (item: OutlineItem) => {
		if (opts.clean) return "";
		if (item.kind === "free") return " %%free%%";
		if (!opts.ids || !item.id) return "";
		return ` %%${item.kind === "group" ? "g" : "n"}:${item.id}%%`;
	};

	/**
	 * Lines after the first. Code fences are written as they are when every fence in the text
	 * closes; otherwise fence lines are escaped too, so an open fence can't swallow the outline.
	 */
	const continuation = (first: string, rest: string[], prefix: string) => {
		const balanced = [first, ...rest].reduce<string | null>((open, l) => fenceStep(l, open), null) === null;
		let fence = balanced ? fenceStep(first, null) : null;
		for (const line of rest) {
			if (line.trim() === "") {
				out.push("");
				continue;
			}
			if (fence || (balanced && FENCE.test(line))) {
				out.push(prefix + line);
				fence = fenceStep(line, fence);
				continue;
			}
			out.push(prefix + escapeLine(line));
		}
	};

	const bullet = (item: OutlineItem, depth: number) => {
		const indent = opts.indent.repeat(depth);
		const [first = "", ...rest] = item.text.split("\n");
		out.push(`${indent}- ${first}${marker(item)}`);
		continuation(first, rest, `${indent}  `);
		for (const child of item.children) bullet(child, depth + 1);
	};

	/** A first-level item as one plain line, packed under the line above (see WriteOptions.plain). */
	const plainLine = (item: OutlineItem) => {
		out.push(`${escapeLine(joinLines(item.text))}${marker(item)}`);
		for (const child of item.children) bullet(child, 0);
	};
	const firstLevel = (item: OutlineItem) => (opts.plain && item.kind === "node" ? plainLine(item) : bullet(item, 0));

	const heading = (item: OutlineItem) => {
		if (out.length > 0) out.push("");
		const level = Math.min(6, Math.max(1, item.heading ?? 1));
		if (opts.plain) {
			// The heading is the title of its block: all of it on its line, its content right below.
			out.push(`${"#".repeat(level)} ${joinLines(item.text)}${marker(item)}`.trimEnd());
		} else {
			const [first = "", ...rest] = item.text.split("\n");
			out.push(`${"#".repeat(level)} ${first}${marker(item)}`.trimEnd());
			// Heading text: continuation lines follow without indentation.
			continuation(first.trim(), rest, "");
		}
		const bullets = item.children.filter((c) => c.heading === undefined);
		const headings = item.children.filter((c) => c.heading !== undefined);
		for (const child of bullets) firstLevel(child);
		for (const child of headings) heading(child);
	};

	const bullets = items.filter((c) => c.heading === undefined);
	for (const item of bullets) firstLevel(item);
	for (const item of items) if (item.heading !== undefined) heading(item);
	return out.join("\n") + "\n";
}

/** Text compared the way the outline can carry it: no trailing spaces, no outer blank lines. */
export function normalizeText(text: string): string {
	return text
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((l) => l.trimEnd())
		.join("\n")
		.replace(/^\n+|\n+$/g, "")
		.replace(/^[ \t]+/, "");
}

/** Counts items (all kinds) in a tree. */
export function countItems(items: OutlineItem[], kind?: ItemKind): number {
	let n = 0;
	for (const item of items) n += (kind === undefined || item.kind === kind ? 1 : 0) + countItems(item.children, kind);
	return n;
}

/**
 * Whether pasted text is an outline worth turning into a map: at least `minLinks` parent/child
 * links between cards (plain prose is a single paragraph and is left to the normal paste).
 */
export function isOutline(text: string, minLinks: number): boolean {
	if (!text.trim()) return false;
	const items = parseOutline(stripFrontmatter(text.replace(/\r\n?/g, "\n")).body);
	let links = 0;
	const walk = (list: OutlineItem[], parent: boolean) => {
		for (const item of list) {
			if (parent && item.kind === "node") links++;
			walk(item.children, item.kind === "node");
		}
	};
	walk(items, false);
	return links >= minLinks;
}
