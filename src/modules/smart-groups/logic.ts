/** Pure parts of smart groups: which items a selection change should add or drop, and copies. */

/** What happened to the selection, as far as groups care. */
export interface SelectionChange<T> {
	before: ReadonlySet<T>;
	after: ReadonlySet<T>;
	/** Smart group id of an item (absent: not in a group). */
	groupOf: (item: T) => string | undefined;
	/** The group the user has entered (its cards are picked one by one), if any. */
	entered: string | null;
	/**
	 * The change was a shift/ctrl click that took an item out of the selection: the rest of
	 * that item's group leaves too. Other shrinking changes (a selection box getting smaller
	 * while it is dragged) never drop cards on their own, so the box can't flicker.
	 */
	toggledOff: boolean;
}

export interface SelectionFix {
	/** Groups whose visible members should all be selected. */
	add: Set<string>;
	/** Groups whose members should all leave the selection. */
	remove: Set<string>;
}

export function fixSelection<T>(change: SelectionChange<T>): SelectionFix {
	const { before, after, groupOf, entered } = change;
	const add = new Set<string>();
	const remove = new Set<string>();
	if (change.toggledOff)
		for (const item of before) {
			if (after.has(item)) continue;
			const g = groupOf(item);
			if (g && g !== entered) remove.add(g);
		}
	// Every group with a selected card is selected whole (a plain click on one card of a selected
	// group keeps the group, as in Miro).
	for (const item of after) {
		const g = groupOf(item);
		if (g && g !== entered && !remove.has(g)) add.add(g);
	}
	return { add, remove };
}

/** True when the entered group should be left: something outside it is selected, or nothing is. */
export function leavesGroup<T>(selection: ReadonlySet<T>, groupOf: (item: T) => string | undefined, entered: string): boolean {
	if (selection.size === 0) return true;
	for (const item of selection) if (groupOf(item) !== entered) return true;
	return false;
}

interface ClonedNode {
	[key: string]: unknown;
}

/**
 * Copies (paste, duplicate, Ctrl/Alt+drag, templates) form their own groups: every group id in
 * `nodes` is replaced by a fresh one, and a group with a single copied card is dropped. Returns
 * new node objects; the input is not changed.
 */
export function regroupCopies<N extends ClonedNode>(nodes: readonly N[], key: string, newId: () => string): N[] {
	const groupOf = (n: N) => {
		const extra = n[key] as { smartGroup?: unknown } | undefined;
		return typeof extra?.smartGroup === "string" && extra.smartGroup ? extra.smartGroup : undefined;
	};
	const counts = new Map<string, number>();
	for (const n of nodes) {
		const g = groupOf(n);
		if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
	}
	if (counts.size === 0) return [...nodes];
	const fresh = new Map<string, string>();
	return nodes.map((n) => {
		const g = groupOf(n);
		if (!g) return n;
		const extra = { ...(n[key] as Record<string, unknown>) };
		if ((counts.get(g) ?? 0) < 2) delete extra.smartGroup;
		else {
			if (!fresh.has(g)) fresh.set(g, newId());
			extra.smartGroup = fresh.get(g);
		}
		const copy: N = { ...n };
		if (Object.keys(extra).length) (copy as ClonedNode)[key] = extra;
		else delete (copy as ClonedNode)[key];
		return copy;
	});
}
