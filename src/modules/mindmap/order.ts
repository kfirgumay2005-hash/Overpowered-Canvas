/**
 * The stored order of siblings (pure). A map remembers, per parent card, the order of its
 * children as an outline would list them (root x-opc `childOrder`). Positions on the board are a
 * poor record of that order: a dropped card can land between two others, a tall card's center
 * can pass its neighbour's, cards left of a parent read in another direction. So every action
 * that sets a card's place among its siblings (a drop as child or sibling, Tab / Enter, a move
 * by hand, a note's outline) writes it here, and every layout and outline reads it back.
 *
 * Children a stored list doesn't name (added some other way: an arrow drawn by hand, a paste)
 * keep their place on the board relative to the ones it does name.
 */

/** Parent id → its children's ids, in order. */
export type ChildOrder = Readonly<Record<string, readonly string[]>>;

/**
 * `byBoard` (the children in the order the board shows them) rearranged to follow `stored`.
 * A child missing from `stored` goes right after the nearest child before it on the board that
 * is already placed (first when there is none).
 */
export function followStored<T extends { id: string }>(byBoard: readonly T[], stored: readonly string[] | undefined): T[] {
	if (!stored?.length || byBoard.length < 2) return [...byBoard];
	const byId = new Map(byBoard.map((n) => [n.id, n]));
	const out: T[] = [];
	const placed = new Set<string>();
	for (const id of stored) {
		const n = byId.get(id);
		if (!n || placed.has(id)) continue;
		out.push(n);
		placed.add(id);
	}
	byBoard.forEach((n, i) => {
		if (placed.has(n.id)) return;
		let at = 0;
		for (let j = i - 1; j >= 0; j--) {
			const k = out.indexOf(byBoard[j]!);
			if (k >= 0) {
				at = k + 1;
				break;
			}
		}
		out.splice(at, 0, n);
		placed.add(n.id);
	});
	return out;
}

/**
 * The order after `child` takes its place under `parent`: right after `after`, first when
 * `after` is null, last when it is undefined (or not a sibling). `current` is the parent's
 * children in their present order (with or without `child`). The child leaves every other list.
 */
export function placeChild(order: ChildOrder | undefined, parent: string, child: string, current: readonly string[], after?: string | null): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const [p, list] of Object.entries(order ?? {})) {
		if (p === parent) continue;
		const kept = list.filter((id) => id !== child);
		if (kept.length) out[p] = kept;
	}
	const list = current.filter((id) => id !== child);
	const at = after === null ? 0 : after !== undefined && list.includes(after) ? list.indexOf(after) + 1 : list.length;
	list.splice(at, 0, child);
	out[parent] = list;
	return out;
}

/**
 * Where a card moved by hand now sits among its siblings: right after the sibling before it on
 * the board. `ordered` is the parent's children in stored order, `byBoard` as the board shows
 * them now. Returns the sibling to place it after (null: first).
 */
export function boardPredecessor(ordered: readonly string[], byBoard: readonly string[], child: string): string | null {
	const at = byBoard.indexOf(child);
	for (let i = at - 1; i >= 0; i--) if (ordered.includes(byBoard[i]!)) return byBoard[i]!;
	return null;
}

/** Only parents and children that still exist, no empty lists. */
export function pruneOrder(order: ChildOrder | undefined, exists: (id: string) => boolean): Record<string, string[]> | undefined {
	const out: Record<string, string[]> = {};
	for (const [p, list] of Object.entries(order ?? {})) {
		if (!exists(p)) continue;
		const kept = [...new Set(list)].filter(exists);
		if (kept.length) out[p] = kept;
	}
	return Object.keys(out).length ? out : undefined;
}
