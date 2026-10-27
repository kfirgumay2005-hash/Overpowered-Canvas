/**
 * From words picked on a rendered card back to its Markdown (pure, unit-tested): which source
 * characters a stretch of rendered text came from, and how to highlight or unhighlight them.
 */

/** How far ahead (characters) a rendered character is looked for in the source. */
const LOOKAHEAD = 48;
/** Inline markup that may sit right around a highlighted stretch. */
const MARKUP = new Set(["*", "_", "~", "=", "`"]);
/** A highlight in Markdown: `==text==` or `<mark …>text</mark>`. */
const HIGHLIGHTS = /==([^=\n]+)==|<mark\b[^>]*>([\s\S]*?)<\/mark>/g;
/** List markers, quote markers and heading signs at the start of a source line. */
const LINE_PREFIX = /^(\s*(?:[-*+]\s+(?:\[.\]\s+)?|\d+[.)]\s+|>\s?|#{1,6}\s+))*/;

/**
 * For each rendered character, the index of the source character it shows (or -1 for text
 * the renderer added, such as a callout's title). Greedy, in order.
 */
export function align(rendered: string, source: string): number[] {
	const map: number[] = [];
	let j = 0;
	for (const ch of rendered) {
		const limit = Math.min(source.length, j + LOOKAHEAD);
		let k = j;
		while (k < limit && !same(source[k]!, ch)) k++;
		if (k < limit) {
			map.push(k);
			j = k + 1;
		} else map.push(-1);
	}
	return map;
}

function same(a: string, b: string): boolean {
	return a === b || (/\s/.test(a) && /\s/.test(b));
}

/** Widens [start, end) of `text` to whole words. */
export function toWords(text: string, start: number, end: number): [number, number] {
	if (start > end) [start, end] = [end, start];
	const word = /[\p{L}\p{N}_'’-]/u;
	while (start > 0 && word.test(text[start - 1]!) && word.test(text[start] ?? " ")) start--;
	while (end < text.length && word.test(text[end]!) && end > 0 && word.test(text[end - 1]!)) end++;
	// Leading and trailing spaces are not part of the highlight.
	while (start < end && /\s/.test(text[start]!)) start++;
	while (end > start && /\s/.test(text[end - 1]!)) end--;
	return [start, end];
}

/** The source range [start, end) shown by rendered characters [from, to), or null. */
export function sourceRange(map: number[], from: number, to: number): [number, number] | null {
	let s = -1;
	for (let i = from; i < to && s < 0; i++) s = map[i]!;
	let e = -1;
	for (let i = to - 1; i >= from && e < 0; i--) e = map[i]!;
	if (s < 0 || e < 0 || e < s) return null;
	return [s, e + 1];
}

export interface HighlightStyle {
	/** A CSS color; empty for the theme's own highlight (`==text==`). */
	color: string;
}

/**
 * Highlights source [start, end): markup touching the stretch is taken in so the result nests
 * properly, and a stretch over several lines is highlighted line by line (list markers stay out).
 */
export function highlight(source: string, start: number, end: number, style: HighlightStyle): string {
	while (start > 0 && MARKUP.has(source[start - 1]!) && source[start - 1] !== "=") start--;
	while (end < source.length && MARKUP.has(source[end]!) && source[end] !== "=") end++;
	const open = style.color ? `<mark style="background: ${style.color};">` : "==";
	const close = style.color ? "</mark>" : "==";
	const lines = source.slice(start, end).split("\n");
	const wrapped = lines.map((line, i) => {
		const prefix = i === 0 ? "" : (LINE_PREFIX.exec(line)?.[0] ?? "");
		const body = line.slice(prefix.length);
		const lead = body.length - body.trimStart().length;
		const core = body.trim();
		if (!core) return line;
		return prefix + body.slice(0, lead) + open + core + close + body.slice(lead + core.length);
	});
	return source.slice(0, start) + wrapped.join("\n") + source.slice(end);
}

/** Removes every highlight (`==…==` or `<mark>…</mark>`) that overlaps source [start, end). */
export function unhighlight(source: string, start: number, end: number): string {
	const spans: { from: number; to: number; inner: string }[] = [];
	for (const m of source.matchAll(HIGHLIGHTS)) {
		const from = m.index;
		const to = from + m[0].length;
		if (from < end && to > start) spans.push({ from, to, inner: m[1] ?? m[2] ?? "" });
	}
	let out = source;
	for (const s of spans.reverse()) out = out.slice(0, s.from) + s.inner + out.slice(s.to);
	return out;
}

/**
 * Highlights source [start, end) in `style`; highlights it overlaps are taken in and recolored,
 * so marking part of a highlight again changes its color instead of nesting a second one.
 */
export function rehighlight(source: string, start: number, end: number, style: HighlightStyle): string {
	let from = start;
	let to = end;
	for (const m of source.matchAll(HIGHLIGHTS)) {
		const a = m.index;
		const b = a + m[0].length;
		if (a < end && b > start) {
			from = Math.min(from, a);
			to = Math.max(to, b);
		}
	}
	if (from === start && to === end) return highlight(source, start, end, style);
	const inner = unhighlight(source.slice(from, to), 0, to - from);
	return highlight(source.slice(0, from) + inner + source.slice(to), from, from + inner.length, style);
}
