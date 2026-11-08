/** Emoji picker: data parsing, search, skin tones, recent list and where an emoji goes in a text. Pure (unit-tested). */

export interface Emoji {
	/** The emoji itself, without a skin tone. */
	char: string;
	/** emojibase group: 0 smileys, 1 people, 3 animals, 4 food, 5 travel, 6 activities, 7 objects, 8 symbols, 9 flags. */
	group: number;
	/** The five skin tones (light → dark), or null when it has none. */
	tones: string[] | null;
	/** English name and keywords, lower case. */
	label: string;
	words: string;
	/** Name and keywords in the UI language (when it isn't English). */
	label2: string;
	words2: string;
}

/** The categories (tabs), in the order shown; each is an emojibase group. */
export const CATEGORIES = [
	{ id: "smileys", group: 0, icon: "smile" },
	{ id: "people", group: 1, icon: "hand" },
	{ id: "animals", group: 3, icon: "paw-print" },
	{ id: "food", group: 4, icon: "apple" },
	{ id: "activities", group: 6, icon: "trophy" },
	{ id: "travel", group: 5, icon: "plane" },
	{ id: "objects", group: 7, icon: "lightbulb" },
	{ id: "symbols", group: 8, icon: "heart" },
	{ id: "flags", group: 9, icon: "flag" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];

/** Skin tones: 0 is the default (yellow), 1–5 light → dark. */
export const TONES = [0, 1, 2, 3, 4, 5] as const;
export type Tone = (typeof TONES)[number];

export function parseEmoji(core: string, en: string): Emoji[] {
	const names = en.split("\n");
	return core
		.split("\n")
		.filter(Boolean)
		.map((line, i) => {
			const [char = "", group = "0", tones = ""] = line.split("\t");
			const [label = "", words = ""] = (names[i] ?? "").split("\t");
			const list = tones ? tones.split(",") : [];
			return { char, group: Number(group), tones: list.length === 5 ? list : null, label: label.toLowerCase(), words: words.toLowerCase(), label2: "", words2: "" };
		});
}

/** Adds names in the UI language (same line order as the English names). */
export function addNames(list: Emoji[], text: string): void {
	const lines = text.split("\n");
	list.forEach((e, i) => {
		const [label = "", words = ""] = (lines[i] ?? "").split("\t");
		e.label2 = label.toLocaleLowerCase();
		e.words2 = words.toLocaleLowerCase();
	});
}

/** The emoji in a skin tone (the plain one when it has no tones). */
export function withTone(e: Emoji, tone: Tone): string {
	return tone > 0 && e.tones ? e.tones[tone - 1]! : e.char;
}

/**
 * Emoji matching every word of the query (in its name or keywords, English or the UI language),
 * best first: a name that starts with the query, then a word of the name, then a keyword, then
 * anywhere. Typing an emoji finds it too.
 */
export function searchEmoji(list: readonly Emoji[], query: string, limit = 400): Emoji[] {
	const q = query.trim().toLocaleLowerCase();
	if (!q) return [];
	const words = q.split(/\s+/).filter(Boolean);
	const scored: { e: Emoji; score: number; i: number }[] = [];
	list.forEach((e, i) => {
		if (e.char === q || e.tones?.includes(q)) {
			scored.push({ e, score: 1000, i });
			return;
		}
		let score = 0;
		for (const w of words) {
			const s = Math.max(scoreIn(e.label, e.words, w), scoreIn(e.label2, e.words2, w));
			if (s === 0) return;
			score += s;
		}
		scored.push({ e, score, i });
	});
	return scored
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.slice(0, limit)
		.map((s) => s.e);
}

function scoreIn(label: string, words: string, w: string): number {
	if (!label && !words) return 0;
	if (label === w) return 60;
	if (label.startsWith(w)) return 40;
	if (label.split(/[\s:,-]+/).some((part) => part.startsWith(w))) return 30;
	if (words.split(" ").some((k) => k === w)) return 25;
	if (words.split(" ").some((k) => k.startsWith(w))) return 15;
	if (label.includes(w) || words.includes(w)) return 5;
	return 0;
}

/** The recent list with `emoji` in front (no duplicates, at most `max`). */
export function pushRecent(recent: readonly string[], emoji: string, max = 36): string[] {
	return [emoji, ...recent.filter((r) => r !== emoji)].slice(0, max);
}

/**
 * A selected card that isn't being edited gets the emoji at the end of its text: the words already
 * there stay as they are, and it lands where typing would go on. A space separates it from a word.
 */
export function appendEmoji(text: string, emoji: string): string {
	if (!text) return emoji;
	return /\s$/.test(text) ? text + emoji : `${text} ${emoji}`;
}

/** Offset in `text` of a line / column position (an editor cursor). */
export function offsetOf(text: string, pos: { line: number; ch: number }): number {
	const lines = text.split("\n");
	let offset = 0;
	for (let i = 0; i < Math.min(pos.line, lines.length - 1); i++) offset += lines[i]!.length + 1;
	return Math.min(text.length, offset + Math.max(0, Math.min(pos.ch, lines[Math.min(pos.line, lines.length - 1)]?.length ?? 0)));
}
