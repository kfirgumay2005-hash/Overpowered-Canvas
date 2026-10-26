/**
 * The Markdown block around a line (pure): a bullet with everything nested under it, a heading
 * with its section, or a paragraph. Used to drag or send a block from a note to a canvas.
 */

const LIST = /^([ \t]*)([-+*]|\d{1,9}[.)])(?:[ \t]+(?:\[.\][ \t]+)?|$)/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/;
const FENCE = /^[ \t]*(`{3,}|~{3,})/;

export interface Block {
	/** First and last line (inclusive). */
	from: number;
	to: number;
	/** The card text: dedented; a lone bullet loses its marker. */
	text: string;
}

function columns(ws: string): number {
	let col = 0;
	for (const ch of ws) col = ch === "\t" ? col + 4 - (col % 4) : col + 1;
	return col;
}

function indentOf(line: string): number {
	return columns(/^[ \t]*/.exec(line)![0]);
}

/** Removes up to `cols` columns of leading whitespace. */
function dedent(line: string, cols: number): string {
	let col = 0;
	let i = 0;
	while (i < line.length && col < cols && (line[i] === " " || line[i] === "\t")) {
		col = line[i] === "\t" ? col + 4 - (col % 4) : col + 1;
		i++;
	}
	return line.slice(i);
}

/** Lines inside fenced code (so a `#` or `-` there is not structure). */
function fenced(lines: string[]): boolean[] {
	const out: boolean[] = [];
	let open: string | null = null;
	for (const line of lines) {
		const f = FENCE.exec(line);
		if (open) {
			out.push(true);
			if (f && f[1]![0] === open[0] && f[1]!.length >= open.length && line.trim() === f[1]) open = null;
		} else if (f) {
			out.push(true);
			open = f[1]!;
		} else out.push(false);
	}
	return out;
}

/** Front matter lines at the top (never a block). */
function frontmatterEnd(lines: string[]): number {
	if (lines[0]?.trim() !== "---") return -1;
	for (let i = 1; i < lines.length; i++) if (lines[i]!.trim() === "---") return i;
	return -1;
}

export function blockAt(lines: string[], line: number): Block | null {
	if (line < 0 || line >= lines.length) return null;
	if (line <= frontmatterEnd(lines)) return null;
	const code = fenced(lines);
	const blank = (i: number) => lines[i]!.trim() === "";

	// A line of a bullet's text (indented, or right below it) belongs to that bullet.
	let start = line;
	const isList = (i: number) => !code[i] && LIST.test(lines[i]!);
	const isHeading = (i: number) => !code[i] && HEADING.test(lines[i]!);
	const ind = indentOf(lines[line]!);
	if (!isList(line) && !isHeading(line) && !blank(line) && !(code[line] && ind === 0)) {
		for (let i = line - 1; i >= 0; i--) {
			if (blank(i)) {
				if (ind === 0) break;
				continue;
			}
			if (isHeading(i)) break;
			if (isList(i)) {
				if (columns(LIST.exec(lines[i]!)![1]!) < ind || ind === 0) start = i;
				break;
			}
			if (indentOf(lines[i]!) < ind) break;
		}
	}
	if (blank(start)) return null;

	const list = isList(start) ? LIST.exec(lines[start]!) : null;
	if (list) {
		const base = columns(list[1]!);
		let end = start;
		// Code fenced inside the bullet may sit at any indent; a fence at its level ends it.
		let inner = false;
		for (let i = start + 1; i < lines.length; i++) {
			if (blank(i) && !code[i]) continue;
			if (!code[i]) inner = false;
			else if (!code[i - 1]) inner = indentOf(lines[i]!) > base;
			if (indentOf(lines[i]!) <= base && !inner) break;
			end = i;
		}
		const raw = lines.slice(start, end + 1).map((l) => dedent(l, base));
		const children = raw.slice(1).some((l) => LIST.test(l));
		// A lone bullet becomes plain text (its continuation lines lose the bullet's indent too).
		const text = !children ? stripMarker(raw) : raw.join("\n");
		return { from: start, to: end, text: text.replace(/\s+$/, "") };
	}

	const heading = isHeading(start) ? HEADING.exec(lines[start]!) : null;
	if (heading) {
		const level = heading[1]!.length;
		let end = start;
		for (let i = start + 1; i < lines.length; i++) {
			const h = !code[i] ? HEADING.exec(lines[i]!) : null;
			if (h && h[1]!.length <= level) break;
			if (!blank(i)) end = i;
		}
		return { from: start, to: end, text: lines.slice(start, end + 1).join("\n").trim() };
	}

	// Paragraph (or fenced code): up to the blank lines around it.
	let from = start;
	let to = start;
	const part = (i: number) => (!blank(i) || code[i]) && !isList(i) && !isHeading(i);
	while (from > 0 && from - 1 > frontmatterEnd(lines) && part(from - 1)) from--;
	while (to < lines.length - 1 && part(to + 1)) to++;
	return { from, to, text: lines.slice(from, to + 1).join("\n").trim() };
}

function stripMarker(raw: string[]): string {
	const m = LIST.exec(raw[0]!)!;
	const width = columns(m[0]);
	return [raw[0]!.slice(m[0].length), ...raw.slice(1).map((l) => dedent(l, width))].join("\n");
}
