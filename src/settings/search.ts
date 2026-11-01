/** Lower case, accents removed: the form both the query and the searched text are compared in. */
export function normalize(text: string): string {
	return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The words of a search box; a row must contain all of them. */
export function queryWords(query: string): string[] {
	return normalize(query).split(/\s+/).filter(Boolean);
}

/** Whether every word appears in one of the (normalized) texts. No words match everything. */
export function matches(words: readonly string[], ...texts: readonly string[]): boolean {
	return words.every((w) => texts.some((text) => text.includes(w)));
}
