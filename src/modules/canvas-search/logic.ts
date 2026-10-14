// Pure search helpers for in-canvas search (unit-tested).

export interface Searchable {
	id: string;
	kind: "node" | "edge";
	/** Text to search: card text, file name (+ note content), group label, url, edge label. */
	text: string;
	/** Reading order for results: top-to-bottom, then by direction. */
	x: number;
	y: number;
}

/** Lower-case, Unicode-normalized, combining marks removed (accents, Hebrew niqqud). */
export function normalize(s: string): string {
	return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Every whitespace-separated term must occur. Results in reading order (RTL-aware). */
export function search(items: Searchable[], query: string, rtl = false): Searchable[] {
	const terms = normalize(query).split(/\s+/).filter(Boolean);
	if (terms.length === 0) return [];
	const hits = items.filter((item) => {
		const text = normalize(item.text);
		return terms.every((t) => text.includes(t));
	});
	// Group by rows of ~40px so cards on the same line read in the right direction.
	return hits.sort((a, b) => Math.round(a.y / 40) - Math.round(b.y / 40) || (rtl ? b.x - a.x : a.x - b.x));
}
