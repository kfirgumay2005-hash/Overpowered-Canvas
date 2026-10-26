/**
 * Gives the lines of a clean note (no hidden ids) the ids of the cards they stand for, by
 * comparing the outline with the one last written to the note (kept with the canvas data).
 *
 * 1. Siblings are aligned by text (longest common subsequence), so unchanged lines keep their
 *    card even when lines were added, removed or reordered around them.
 * 2. Between two aligned lines, the remaining old and new lines are paired as edits: one for
 *    one, else by how similar their text is.
 * 3. A line that moved elsewhere in the outline is found by its text.
 *
 * Lines that already carry an id (a note written with ids) keep it. Pure; no Obsidian imports.
 */
import { normalizeText, type OutlineItem } from "./outline";

/** Below this similarity, an old and a new line in the same gap are a deletion and an addition. */
const SIMILAR = 0.45;

function key(item: OutlineItem): string {
	return normalizeText(item.text).toLowerCase();
}

/** Groups and the free-cards list are headings; a bullet can't be one. */
function compatible(next: OutlineItem, old: OutlineItem): boolean {
	return old.kind === "node" || next.heading !== undefined;
}

function bigrams(s: string): Map<string, number> {
	const out = new Map<string, number>();
	const chars = [...s.replace(/\s+/g, " ")];
	for (let i = 0; i < chars.length - 1; i++) {
		const g = chars[i]! + chars[i + 1]!;
		out.set(g, (out.get(g) ?? 0) + 1);
	}
	return out;
}

/** Dice coefficient of character pairs (0…1). */
export function similarity(a: string, b: string): number {
	if (a === b) return 1;
	const x = bigrams(a);
	const y = bigrams(b);
	let total = 0;
	let shared = 0;
	for (const n of x.values()) total += n;
	for (const n of y.values()) total += n;
	for (const [g, n] of x) shared += Math.min(n, y.get(g) ?? 0);
	return total ? (2 * shared) / total : 0;
}

/** Index pairs of the longest common subsequence of equal keys. */
function lcs(next: OutlineItem[], old: OutlineItem[]): [number, number][] {
	const a = next.map(key);
	const b = old.map(key);
	const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
	for (let i = a.length - 1; i >= 0; i--)
		for (let j = b.length - 1; j >= 0; j--)
			dp[i]![j] = a[i] === b[j] && compatible(next[i]!, old[j]!) ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
	const pairs: [number, number][] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] === b[j] && compatible(next[i]!, old[j]!)) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++;
		else j++;
	}
	return pairs;
}

/** Assigns `item.id` (and the group / free-cards kind) to lines of `items` found in `previous`. */
export function matchOutline(items: OutlineItem[], previous: OutlineItem[]): void {
	const byId = new Map<string, OutlineItem>();
	const index = (list: OutlineItem[]) => {
		for (const item of list) {
			if (item.kind === "free") byId.set("\u0000free", item);
			else if (item.id) byId.set(item.id, item);
			index(item.children);
		}
	};
	index(previous);

	const used = new Set<OutlineItem>();
	const done = new Set<OutlineItem>();
	const pair = (next: OutlineItem, old: OutlineItem) => {
		used.add(old);
		done.add(next);
		if (old.kind === "free") next.kind = "free";
		else {
			next.id = old.id;
			if (old.kind === "group") next.kind = "group";
		}
	};

	// Lines that already carry an id.
	const marked = (list: OutlineItem[]) => {
		for (const item of list) {
			const old = item.kind === "free" ? byId.get("\u0000free") : item.id ? byId.get(item.id) : undefined;
			if (old) used.add(old);
			if (item.kind === "free" || item.id) done.add(item);
			marked(item.children);
		}
	};
	marked(items);

	const matchLists = (nextAll: OutlineItem[], oldAll: OutlineItem[]) => {
		const next = nextAll.filter((i) => !done.has(i));
		const old = oldAll.filter((i) => !used.has(i));
		const anchors = lcs(next, old);
		for (const [i, j] of anchors) pair(next[i]!, old[j]!);
		// Gaps between anchors (and before the first / after the last).
		let pi = 0;
		let pj = 0;
		for (const [ai, aj] of [...anchors, [next.length, old.length] as [number, number]]) {
			const gn = next.slice(pi, ai);
			const go = old.slice(pj, aj).filter((o) => !used.has(o));
			if (gn.length === 1 && go.length === 1 && compatible(gn[0]!, go[0]!)) pair(gn[0]!, go[0]!);
			else if (gn.length && go.length) {
				const scored: { n: OutlineItem; o: OutlineItem; s: number }[] = [];
				for (const n of gn) for (const o of go) if (compatible(n, o)) scored.push({ n, o, s: similarity(key(n), key(o)) });
				scored.sort((x, y) => y.s - x.s);
				for (const { n, o, s } of scored) if (s >= SIMILAR && !done.has(n) && !used.has(o)) pair(n, o);
			}
			pi = ai + 1;
			pj = aj + 1;
		}
		for (const n of nextAll) {
			const o = n.kind === "free" ? byId.get("\u0000free") : n.id ? byId.get(n.id) : undefined;
			matchLists(n.children, o?.children ?? []);
		}
	};
	matchLists(items, previous);

	// Moved lines: unmatched lines whose text is an unused old line's text.
	const loose: OutlineItem[] = [];
	const collect = (list: OutlineItem[]) => {
		for (const item of list) {
			if (!done.has(item)) loose.push(item);
			collect(item.children);
		}
	};
	collect(items);
	if (!loose.length) return;
	const unused = new Map<string, OutlineItem[]>();
	const gather = (list: OutlineItem[]) => {
		for (const item of list) {
			if (!used.has(item)) (unused.get(key(item)) ?? unused.set(key(item), []).get(key(item))!).push(item);
			gather(item.children);
		}
	};
	gather(previous);
	for (const n of loose) {
		if (done.has(n)) continue;
		const candidates = (unused.get(key(n)) ?? []).filter((o) => !used.has(o) && compatible(n, o));
		const o = candidates[0];
		if (!o) continue;
		pair(n, o);
		matchLists(n.children, o.children);
	}
}
