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

/** HTML tags, link targets, aliased link targets and comments: Markdown the card doesn't show. */
const HIDDEN = [/<\/?[a-zA-Z][^>\n]*>/g, /\]\([^)\n]*\)/g, /\[\[[^\]|\n]*\|/g, /%%[\s\S]*?%%/g];

/** The source characters that can show on the card, with the source index of each. */
export function visible(source: string): { text: string; index: number[] } {
	const hidden = new Uint8Array(source.length);
	for (const re of HIDDEN) for (const m of source.matchAll(re)) hidden.fill(1, m.index, m.index + m[0].length);
	let text = "";
	const index: number[] = [];
	for (let i = 0; i < source.length; i++)
		if (!hidden[i]) {
			text += source[i];
			index.push(i);
		}
	return { text, index };
}

const isSpace = (c: string) => /\s/.test(c);
const isWordChar = (c: string) => /[\p{L}\p{N}\p{M}]/u.test(c);

/**
 * For each rendered character, the index of the source character it shows (or -1 for text
 * the renderer added, such as a callout's title). Greedy, in order, over the visible source; a
 * space only matches a space before the next letter, so an extra rendered space never skips a word.
 */
export function align(rendered: string, source: string): number[] {
	const { text, index } = visible(source);
	const map: number[] = [];
	let j = 0;
	for (const ch of rendered) {
		const limit = Math.min(text.length, j + LOOKAHEAD);
		let k = j;
		if (isSpace(ch)) while (k < limit && !isSpace(text[k]!) && !isWordChar(text[k]!)) k++;
		else while (k < limit && text[k] !== ch) k++;
		if (k < limit && (isSpace(ch) ? isSpace(text[k]!) : true)) {
			map.push(index[k]!);
			j = k + 1;
		} else map.push(-1);
	}
	return map;
}

/**
 * The source range of rendered characters [from, to). When the picked words appear verbatim in
 * the visible source, the matching occurrence wins (the same one counting from the top, else the
 * one nearest the aligned guess); otherwise the alignment decides.
 */
export function locate(rendered: string, source: string, from: number, to: number): [number, number] | null {
	const guess = sourceRange(align(rendered, source), from, to);
	const words = rendered.slice(from, to);
	if (!words) return null;
	const { text, index } = visible(source);
	const hits: [number, number][] = [];
	for (let i = text.indexOf(words); i >= 0; i = text.indexOf(words, i + 1)) {
		const a = index[i]!;
		const b = index[i + words.length - 1]!;
		if (b - a === words.length - 1) hits.push([a, b + 1]);
	}
	if (!hits.length) return guess;
	let nth = 0;
	let total = 0;
	for (let i = rendered.indexOf(words); i >= 0; i = rendered.indexOf(words, i + 1)) {
		if (i < from) nth++;
		total++;
	}
	if (total === hits.length) return hits[nth] ?? guess;
	if (!guess) return hits.length === 1 ? hits[0]! : null;
	return hits.reduce((best, h) => (Math.abs(h[0] - guess[0]) < Math.abs(best[0] - guess[0]) ? h : best));
}

/** The text with every highlight taken off: highlighting must change nothing else. */
export function withoutHighlights(source: string): string {
	return unhighlight(source, 0, source.length);
}

/** Widens [start, end) of `text` to whole words. */
export function toWords(text: string, start: number, end: number): [number, number] {
	if (start > end) [start, end] = [end, start];
	const word = /[\p{L}\p{N}\p{M}_'’׳״-]/u;
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
