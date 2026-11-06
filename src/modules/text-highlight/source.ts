/**
 * From words picked on a rendered card back to its Markdown (pure, unit-tested): which source
 * characters a stretch of rendered text came from, and how to highlight them or color their
 * text (and take that off again).
 */

/** How far ahead (characters) a rendered character is looked for in the source. */
const LOOKAHEAD = 48;
/** Inline markup that may sit right around a highlighted stretch. */
const MARKUP = new Set(["*", "_", "~", "=", "`"]);
/** A highlight in Markdown: `==text==` (a single "=" may be inside) or `<mark …>text</mark>`. */
const HIGHLIGHTS = /==((?:[^=\n]|=(?!=))+)==|<mark\b[^>]*>([\s\S]*?)<\/mark>/g;
/** Text in a color of its own, as the text color tool writes it: `<span style="color: …;">text</span>`. */
const COLORED = /<span style="color: ?[^";<>]+;?">([\s\S]*?)<\/span>/g;
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

/** The text with every text color taken off: coloring must change nothing else. */
export function withoutColors(source: string): string {
	return uncolor(source, 0, source.length);
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

/**
 * What a gesture marks, in rendered characters [from, to): a tap (`tap`) marks the whole word
 * under it; a swipe marks exactly the characters from the one it started on to the one it ended
 * on (either way round), without spaces at its ends.
 */
export function pickedRange(text: string, a: number, b: number, tap: boolean): [number, number] {
	if (tap) return toWords(text, a, Math.min(text.length, a + 1));
	let start = Math.min(a, b);
	let end = Math.min(text.length, Math.max(a, b) + 1);
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
	const open = style.color ? `<mark style="background: ${style.color};">` : "==";
	const close = style.color ? "</mark>" : "==";
	return wrap(source, start, end, open, close);
}

/**
 * Puts `open` … `close` around source [start, end), line by line (list markers stay out).
 * `takeMarkup`: inline markup right around the stretch goes inside (a highlight around **bold**);
 * otherwise the tags go inside the markup (a color inside **bold**, so the theme's color for bold
 * text does not win over it).
 */
function wrap(source: string, start: number, end: number, open: string, close: string, takeMarkup = true): string {
	if (takeMarkup) {
		while (start > 0 && MARKUP.has(source[start - 1]!) && source[start - 1] !== "=") start--;
		while (end < source.length && MARKUP.has(source[end]!) && source[end] !== "=") end++;
	}
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

/** Marks the start and the end of the stretch worked on while the text around it changes (private use characters, never in a card). */
const FROM = "";
const TO = "";
/** HTML tags and `==` in the source: a mark never runs across one (it is split there instead). */
const TOKENS = /<\/?[a-zA-Z][^>\n]*>|==/g;

/** An element of `pattern` (a highlight or a text color): its whole extent and that of its text. */
interface Element {
	from: number;
	to: number;
	innerStart: number;
	innerEnd: number;
}

function elementsOf(source: string, pattern: RegExp): Element[] {
	const out: Element[] = [];
	for (const m of source.matchAll(pattern)) {
		const inner = m[1] ?? m[2] ?? "";
		const close = m[0].startsWith("==") ? 2 : m[0].length - m[0].lastIndexOf("<");
		const to = m.index + m[0].length;
		out.push({ from: m.index, to, innerStart: to - close - inner.length, innerEnd: to - close });
	}
	return out;
}

/**
 * Takes the marks of `pattern` off exactly the stretch between the FROM and TO markers of `text`:
 * a mark reaching past the stretch keeps its parts outside it (split in two or three), a mark
 * inside it goes. Marks of other kinds are not touched.
 */
function cutOut(text: string, pattern: RegExp): string {
	for (;;) {
		const s = text.indexOf(FROM);
		const e = text.indexOf(TO) + 1;
		const el = elementsOf(text, pattern).find((m) => m.from < e && m.to > s);
		if (!el) return text;
		const open = text.slice(el.from, el.innerStart);
		const close = text.slice(el.innerEnd, el.to);
		const a = Math.min(el.innerEnd, Math.max(el.innerStart, s));
		const b = Math.max(a, Math.min(el.innerEnd, e));
		// The part of a mark left outside the stretch, with its spaces outside it (`== c==` is no highlight).
		const keep = (part: string) => {
			const core = part.trim();
			if (!core) return part;
			const lead = part.length - part.trimStart().length;
			return part.slice(0, lead) + open + core + close + part.slice(lead + core.length);
		};
		text = text.slice(0, el.from) + keep(text.slice(el.innerStart, a)) + text.slice(a, b) + keep(text.slice(b, el.innerEnd)) + text.slice(el.to);
	}
}

/**
 * Puts `open` … `close` around the stretch between the markers, split wherever a tag or `==` lies
 * inside it, so every piece nests properly in the marks around it (a highlight inside a colored
 * word, a color inside a highlight).
 */
function markStretch(text: string, open: string, close: string, takeMarkup: boolean): string {
	const s = text.indexOf(FROM) + 1;
	const e = text.indexOf(TO);
	const cuts = [s];
	for (const m of text.slice(s, e).matchAll(TOKENS)) cuts.push(s + m.index, s + m.index + m[0].length);
	cuts.push(e);
	// Right to left, so the places still ahead stay where they are.
	for (let i = cuts.length - 2; i >= 0; i -= 2) {
		const a = cuts[i]!;
		const b = cuts[i + 1]!;
		if (text.slice(a, b).trim()) text = wrap(text, a, b, open, close, takeMarkup);
	}
	return text;
}

/** Runs `edit` on source [start, end) marked out by the FROM/TO markers, then takes the markers away. */
function onStretch(source: string, start: number, end: number, edit: (text: string) => string): string {
	const text = source.slice(0, start) + FROM + source.slice(start, end) + TO + source.slice(end);
	return edit(text).split(FROM).join("").split(TO).join("");
}

/** Takes highlights (`==…==` or `<mark>…</mark>`) off exactly source [start, end): parts of them outside it stay. */
export function unhighlight(source: string, start: number, end: number): string {
	return onStretch(source, start, end, (t) => cutOut(t, HIGHLIGHTS));
}

/** Takes text colors off exactly source [start, end): parts of them outside it stay. */
export function uncolor(source: string, start: number, end: number): string {
	return onStretch(source, start, end, (t) => cutOut(t, COLORED));
}

/**
 * Highlights exactly source [start, end) in `style`: a highlight there is replaced (its parts
 * outside the stretch keep their color), and the letters of a colored word keep their color.
 */
export function rehighlight(source: string, start: number, end: number, style: HighlightStyle): string {
	const open = style.color ? `<mark style="background: ${style.color};">` : "==";
	const close = style.color ? "</mark>" : "==";
	return onStretch(source, start, end, (t) => {
		const marked = markStretch(cutOut(t, HIGHLIGHTS), open, close, true);
		// Neutral next to neutral (`==ab====cd==`) reads as no highlight at all: one highlight again.
		return style.color ? marked : marked.split(`==${FROM}==`).join(FROM).split(`==${TO}==`).join(TO);
	});
}

/**
 * Colors exactly the letters of source [start, end) (`<span style="color: …;">`): a color there
 * is replaced (its parts outside the stretch keep it), and highlights stay as they are.
 */
export function recolor(source: string, start: number, end: number, color: string): string {
	return onStretch(source, start, end, (t) => markStretch(cutOut(t, COLORED), `<span style="color: ${color};">`, "</span>", false));
}
