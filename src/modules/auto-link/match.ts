/**
 * Finding note titles in text and turning them into real links (pure, unit-tested).
 *
 * Titles go into a trie, so a scan costs the length of the text, not the number of titles.
 * Matching ignores case and needs whole words: the characters around a match must not be letters,
 * marks, digits or underscores, except next to scripts written without spaces between words.
 * The longest match wins wherever matches overlap. Nothing inside a protected range is touched:
 * links, code, math, URLs, tags, comments, HTML, and (in notes) front matter and headings.
 */

export interface Title {
	/** The words to find, as written (a file's name or an alias). */
	phrase: string;
	/** What it links to; opaque here (a file path in the plugin). */
	target: string;
}

interface TrieNode {
	next: Map<string, TrieNode>;
	/** Set where a title ends. */
	targets?: string[];
}

export type Trie = TrieNode;

/** One UTF-16 unit, case folded; characters whose lower case changes length stay as they are. */
function fold(ch: string): string {
	const lower = ch.toLowerCase();
	return lower.length === 1 ? lower : ch;
}

export function buildTrie(titles: Title[]): Trie {
	const root: TrieNode = { next: new Map() };
	for (const { phrase, target } of titles) {
		const text = phrase.trim();
		if (!text) continue;
		let node = root;
		for (let i = 0; i < text.length; i++) {
			const ch = fold(text[i]!);
			let child = node.next.get(ch);
			if (!child) node.next.set(ch, (child = { next: new Map() }));
			node = child;
		}
		const targets = (node.targets ??= []);
		if (!targets.includes(target)) targets.push(target);
	}
	return root;
}

const WORD = /[\p{L}\p{M}\p{N}_]/u;
/** Scripts written without spaces between words: a title can start or end anywhere in them. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}]/u;

/** The code point ending just before `i`, or the one starting at `i`. */
function charBefore(text: string, i: number): string {
	if (i <= 0) return "";
	const low = text.charCodeAt(i - 1);
	return i > 1 && low >= 0xdc00 && low <= 0xdfff ? text.slice(i - 2, i) : text.slice(i - 1, i);
}
function charAt(text: string, i: number): string {
	if (i >= text.length) return "";
	return String.fromCodePoint(text.codePointAt(i)!);
}

/** Whether a word can start or end between these two characters. */
function isBoundary(a: string, b: string): boolean {
	if (!a || !b) return true;
	if (!WORD.test(a) || !WORD.test(b)) return true;
	return UNSPACED.test(a) || UNSPACED.test(b);
}

export type Range = [start: number, end: number];

/**
 * No lookbehinds here: iOS before 16.4 can't parse them, and that would stop the whole plugin from
 * loading. What must come before a match is a group named `pre`, left out of the range.
 */
const RANGE_RULES: RegExp[] = [
	/\$\$[\s\S]*?\$\$/g, // math blocks
	/(?<pre>^|[^\\$])\$(?=\S)[^$\n]*?[^\s$]\$(?!\d)/gm, // inline math
	/(?<pre>^|[^`])(?<ticks>`+)(?!`)[^\n]*?[^`]\k<ticks>(?!`)/gm, // inline code
	/%%[\s\S]*?%%/g, // comments
	/<!--[\s\S]*?-->/g,
	/<[a-zA-Z/!][^>\n]*>/g, // HTML tags
	/!?\[\[[^\]\n]*\]\]/g, // links and embeds
	/!?\[[^\]\n]*\]\([^)\n]*\)/g, // Markdown links and images
	/!?\[[^\]\n]*\]\[[^\]\n]*\]/g, // reference links
	/^[ \t]*\[[^\]\n]+\]:.*$/gm, // reference definitions
	/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>)\]]+/gi, // URLs
	/\bwww\.[^\s<>)\]]+/gi,
	/\b[\w.+-]+@[\w-]+\.[\w.-]+/g, // e-mail addresses
	/(?<pre>^|[^\p{L}\p{N}_])#[\p{L}\p{N}_/-]+/gmu, // tags
	/[ \t]\^[A-Za-z0-9-]+[ \t]*$/gm, // block ids
];

const FENCE = /^[ \t>]*(`{3,}|~{3,})/;
const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
const HEADING_LINE = /^ {0,3}#{1,6}[ \t].*$/gm;

function fencedRanges(text: string): Range[] {
	const out: Range[] = [];
	let open: { start: number; fence: string } | null = null;
	let at = 0;
	for (const line of text.split("\n")) {
		const f = FENCE.exec(line);
		if (open) {
			if (f && f[1]![0] === open.fence[0] && f[1]!.length >= open.fence.length && line.replace(/^[ \t>]*/, "").trimEnd() === f[1]) {
				out.push([open.start, at + line.length]);
				open = null;
			}
		} else if (f) open = { start: at, fence: f[1]! };
		at += line.length + 1;
	}
	if (open) out.push([open.start, text.length]);
	return out;
}

/** Where nothing may be linked, sorted and merged. `note`: the text is a whole Markdown note. */
export function protectedRanges(text: string, opts: { note: boolean }): Range[] {
	const ranges: Range[] = fencedRanges(text);
	for (const rule of RANGE_RULES) for (const m of text.matchAll(rule)) ranges.push([m.index + (m.groups?.pre?.length ?? 0), m.index + m[0].length]);
	if (opts.note) {
		const front = FRONTMATTER.exec(text);
		if (front) ranges.push([0, front[0].length]);
		// Linking in a heading would change its text, and with it links to that heading.
		for (const m of text.matchAll(HEADING_LINE)) ranges.push([m.index, m.index + m[0].length]);
	}
	ranges.sort((a, b) => a[0] - b[0]);
	const merged: Range[] = [];
	for (const r of ranges) {
		const last = merged[merged.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
		else merged.push([r[0], r[1]]);
	}
	return merged;
}

export interface Found {
	start: number;
	end: number;
	/** The text as written. */
	text: string;
	targets: string[];
}

/** Every title in `text`: no overlaps, longest first where they compete, in text order. */
export function findTitles(text: string, trie: Trie, guarded: Range[]): Found[] {
	const all: Found[] = [];
	let guard = 0;
	for (let i = 0; i < text.length; i++) {
		while (guard < guarded.length && guarded[guard]![1] <= i) guard++;
		const range = guarded[guard];
		if (range && range[0] <= i) {
			i = range[1] - 1;
			continue;
		}
		let node = trie.next.get(fold(text[i]!));
		if (!node) continue;
		if (!isBoundary(charBefore(text, i), charAt(text, i))) continue;
		let best: Found | null = null;
		for (let j = i; node; ) {
			const end: number = j + 1;
			if (range === undefined || end <= range[0]) {
				if (node.targets && isBoundary(charBefore(text, end), charAt(text, end))) best = { start: i, end, text: text.slice(i, end), targets: node.targets };
			} else break;
			j = end;
			node = j < text.length ? node.next.get(fold(text[j]!)) : undefined;
		}
		if (best) all.push(best);
	}
	all.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
	const taken: Found[] = [];
	for (const f of all) if (!taken.some((t) => f.start < t.end && t.start < f.end)) taken.push(f);
	return taken.sort((a, b) => a.start - b.start);
}

const TABLE_DELIMITER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

/** Ranges of the lines of Markdown tables, where a link's `|` must be escaped. */
export function tableRanges(text: string): Range[] {
	const lines = text.split("\n");
	const starts: number[] = [];
	let at = 0;
	for (const line of lines) {
		starts.push(at);
		at += line.length + 1;
	}
	const out: Range[] = [];
	lines.forEach((line, i) => {
		if (!line.includes("|") || !line.includes("-") || !TABLE_DELIMITER.test(line) || i === 0 || !lines[i - 1]!.includes("|")) return;
		let last = i;
		while (last + 1 < lines.length && lines[last + 1]!.includes("|")) last++;
		out.push([starts[i - 1]!, starts[last]! + lines[last]!.length]);
	});
	return out;
}

export interface LinkPlan {
	/** Which file a phrase links to here; null leaves it unlinked (it is this very file). */
	pick(found: Found): string | null;
	/** The link for `original`, pointing at `target`. */
	render(target: string, original: string, inTable: boolean): string;
	/** Only the first mention of each target. */
	firstOnly: boolean;
	/** Targets this text links to already: with `firstOnly`, they are not linked again. */
	linked: ReadonlySet<string>;
	note: boolean;
}

export interface Created {
	/** The link written. */
	link: string;
	/** What it replaced. */
	text: string;
	target: string;
}

export interface Linked {
	text: string;
	created: Created[];
}

/** `text` with real links where titles are mentioned. */
export function linkText(text: string, trie: Trie, plan: LinkPlan): Linked {
	const found = findTitles(text, trie, protectedRanges(text, { note: plan.note }));
	const tables = found.length ? tableRanges(text) : [];
	const seen = new Set(plan.firstOnly ? plan.linked : []);
	const created: Created[] = [];
	let out = "";
	let at = 0;
	for (const f of found) {
		const target = plan.pick(f);
		if (target === null || seen.has(target)) continue;
		if (plan.firstOnly) seen.add(target);
		const link = plan.render(target, f.text, tables.some((t) => f.start >= t[0] && f.end <= t[1]));
		out += text.slice(at, f.start) + link;
		at = f.end;
		created.push({ link, text: f.text, target });
	}
	return { text: created.length ? out + text.slice(at) : text, created };
}

/** The link paths this text links to (not embeds), without headings, blocks or display text. */
export function linkPaths(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/!?\[\[([^\]|#^\n]*)[^\]\n]*\]\]/g)) if (!m[0].startsWith("!") && m[1]!.trim()) out.push(m[1]!.trim());
	return out;
}

/** `text` with the links in `created` back as the words they replaced (one replacement each). */
export function unlinkText(text: string, created: Pick<Created, "link" | "text">[]): { text: string; undone: number } {
	let out = text;
	let undone = 0;
	for (const c of created) {
		const i = out.indexOf(c.link);
		if (i < 0) continue;
		out = out.slice(0, i) + c.text + out.slice(i + c.link.length);
		undone++;
	}
	return { text: out, undone };
}
