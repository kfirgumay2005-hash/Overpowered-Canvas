/**
 * Paragraph indents for prose. The indent is made of EM SPACE characters (U+2003), not tabs or
 * ASCII spaces: Markdown strips leading spaces/tabs from paragraphs and turns four of them into a
 * code block, while an em space is ordinary text. It is never collapsed by HTML, so it is exactly
 * 1em wide in Live Preview, Source mode, Reading mode, exports and other apps. See
 * docs/decisions.md.
 */
export const INDENT_CHAR = " ";

export const MIN_WIDTH = 1;
export const MAX_WIDTH = 8;

export function indentText(width: number): string {
	return INDENT_CHAR.repeat(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width) || MIN_WIDTH)));
}

/** Class on editor lines that start with a paragraph indent (see styles.css). */
export const FLAT_CLASS = "opc-indent-line";

/** The line starts with a paragraph indent (em space), not with ordinary indentation. */
export const startsWithIndent = (text: string): boolean => text.startsWith(INDENT_CHAR);

/** Read-only access to the document, by 0-based line number. */
export interface Lines {
	count: number;
	line(n: number): string;
}

const QUOTE = /^(?:[ \t]{0,3}>[ \t]?)+/;
const LIST = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;
const MATH = /^[ \t]*\$\$/;

/**
 * Where Tab keeps its usual meaning: frontmatter, code and math blocks, lists (Tab / Shift+Tab
 * still indent and outdent items), tables and indented lines (list continuations, indented code).
 * Everywhere else Tab writes a paragraph indent at the cursor.
 */
export function tabKeepsDefault(doc: Lines, lineNo: number): boolean {
	if (inFrontmatter(doc, lineNo) || inBlock(doc, lineNo)) return true;
	const text = doc.line(lineNo);
	const body = text.replace(QUOTE, "");
	if (/^[ \t]/.test(body) && body.trim() !== "") return true;
	if (LIST.test(body)) return true;
	if (/^\s*\|/.test(body)) return true;
	return false;
}

function inFrontmatter(doc: Lines, lineNo: number): boolean {
	if (doc.count === 0 || doc.line(0) !== "---") return false;
	if (lineNo === 0) return true;
	for (let i = 1; i < doc.count; i++) {
		if (/^(?:---|\.\.\.)\s*$/.test(doc.line(i))) return lineNo <= i;
	}
	return false;
}

/** Inside a fenced code block or a $$ math block (the fence lines count as inside). */
function inBlock(doc: Lines, lineNo: number): boolean {
	let fence: string | null = null;
	let math = false;
	for (let i = 0; i <= lineNo && i < doc.count; i++) {
		const text = doc.line(i).replace(QUOTE, "");
		if (i === lineNo) return fence !== null || math || FENCE.test(text) || MATH.test(text);
		if (fence !== null) {
			const m = FENCE.exec(text);
			if (m && m[1]![0] === fence[0] && m[1]!.length >= fence.length && text.trim() === m[1]) fence = null;
			continue;
		}
		if (math) {
			if (/\$\$\s*$/.test(text)) math = false;
			continue;
		}
		const m = FENCE.exec(text);
		if (m) fence = m[1]!;
		else if (MATH.test(text) && !/^\s*\$\$.*\$\$\s*$/.test(text)) math = true;
	}
	return false;
}

/**
 * The editor (unlike Reading mode) counts every Unicode space as indentation, so four em spaces
 * at the start of a line after a blank line would show as indented code while editing. A WORD
 * JOINER (U+2060: invisible, zero width, not whitespace) after every third leading em space
 * keeps that run under four, so all modes look the same.
 */
export const BREAK_CHAR = "⁠";
const RUN = 3;

/** A line after an edit, and where its cursor goes. */
export interface LineEdit {
	text: string;
	cursor: number;
}

const isRunChar = (ch: string | undefined) => ch === INDENT_CHAR || ch === BREAK_CHAR;

/** Rebuilds the leading indent (after any quote markers) with a break after every third em space. */
export function fixLeadingRun(text: string, cursor: number): LineEdit {
	const start = text.length - text.replace(QUOTE, "").length;
	let end = start;
	while (isRunChar(text[end])) end++;
	const run = text.slice(start, end);
	const ems = run.split("").filter((c) => c === INDENT_CHAR).length;
	let rebuilt = "";
	for (let i = 1; i <= ems; i++) rebuilt += INDENT_CHAR + (i % RUN === 0 && i < ems ? BREAK_CHAR : "");
	if (rebuilt === run) return { text, cursor };
	const out = text.slice(0, start) + rebuilt + text.slice(end);
	if (cursor <= start) return { text: out, cursor };
	if (cursor >= end) return { text: out, cursor: cursor + rebuilt.length - run.length };
	// Inside the run: keep the cursor after the same number of em spaces.
	const before = text.slice(start, cursor).split("").filter((c) => c === INDENT_CHAR).length;
	let pos = start;
	for (let seen = 0; pos < start + rebuilt.length && seen < before; pos++) if (rebuilt[pos - start] === INDENT_CHAR) seen++;
	if (rebuilt[pos - start] === BREAK_CHAR) pos++;
	return { text: out, cursor: pos };
}

/** Tab: the indent replaces the selected text [from, to) of the line. */
export function applyIndent(text: string, from: number, to: number, width: number): LineEdit {
	const indent = indentText(width);
	return fixLeadingRun(text.slice(0, from) + indent + text.slice(to), from + indent.length);
}

/**
 * Shift+Tab: removes one indent (up to `width` em spaces) right before the cursor, or else at the
 * start of the line. Null when there is none.
 */
export function applyOutdent(text: string, cursor: number, width: number): LineEdit | null {
	const max = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width) || MIN_WIDTH));
	const cut = (from: number, dir: 1 | -1): LineEdit | null => {
		// Walk over em spaces (and the breaks between them) from `from` in direction `dir`.
		let removed = 0;
		let i = from;
		const chars = text.split("");
		const keep = chars.map(() => true);
		while (removed < max) {
			const at = dir < 0 ? i - 1 : i;
			if (at < 0 || at >= chars.length || !isRunChar(chars[at])) break;
			if (chars[at] === INDENT_CHAR) removed++;
			keep[at] = false;
			i += dir;
		}
		if (removed === 0) return null;
		const lo = Math.min(from, i);
		const out = chars.filter((_, k) => keep[k]).join("");
		const hi = Math.max(from, i);
		return fixLeadingRun(out, cursor <= lo ? cursor : cursor >= hi ? cursor - (hi - lo) : lo);
	};
	const back = cut(cursor, -1);
	if (back) return back;
	const start = text.length - text.replace(QUOTE, "").length;
	return cut(start, 1);
}

/** The cursor is inside inline math ($…$) or inline code (`…`) on its line: Tab is left alone there. */
export function inInlineMath(lineText: string, cursorCh: number): boolean {
	let dollars = 0;
	let ticks = 0;
	for (let i = 0; i < cursorCh && i < lineText.length; i++) {
		const ch = lineText[i];
		if (ch === "\\") {
			i++;
			continue;
		}
		if (ch === "`") ticks++;
		else if (ch === "$" && ticks % 2 === 0) dollars++;
	}
	return dollars % 2 === 1 || ticks % 2 === 1;
}
