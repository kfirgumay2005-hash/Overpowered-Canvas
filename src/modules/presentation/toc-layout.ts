// The table of contents' free arrangement (pure, unit-tested).
//
// A parent's children are shown as cells in rows. Each row holds blocks; a block is one cell, or
// a cell group: cells placed beside or below each other, as a tree of rows and columns (a cell
// dropped to the right of another makes a row of the two, one dropped below makes a column), so
// cells of different sizes stay tidy (three small cells beside or below one large cell). Inside a
// group, cells can form sub-groups (a split with `group`), with outlines of their own, nested at
// any depth.

import type { TocArrangement, TocBlock, TocSplit, TocSubGroup, TocTree } from "../../data/schema";

export type { TocArrangement, TocBlock, TocSplit, TocSubGroup, TocTree };

export type Side = "left" | "right" | "top" | "bottom";

/** Where a dragged cell or group lands. */
export type TocDrop =
	/** Beside or below a cell: joins (or makes) that cell's group. */
	| { kind: "cell"; card: string; side: Side }
	/** On the middle of a cell of the same group: the two make a sub-group in that group. */
	| { kind: "sub"; card: string; side: Side }
	/** A cell of the grid of its own: in row `row` before block `index`, or a new row there. */
	| { kind: "slot"; row: number; index: number; newRow: boolean };

/** What is dragged: one cell, a sub-group, or a whole block (a group). */
export type TocMoving = { kind: "card"; card: string } | { kind: "sub"; sub: string } | { kind: "block"; block: string };

/** Colors given to new groups in turn (canvas colors). */
export const GROUP_COLORS = ["5", "4", "1", "6", "3", "2"];

export function cardsOf(tree: TocTree): string[] {
	return typeof tree === "string" ? [tree] : tree.items.flatMap(cardsOf);
}

export function isGroup(block: TocBlock): boolean {
	return typeof block.tree !== "string";
}

/** The sub-groups in a tree, outermost first. */
export function subGroupsOf(tree: TocTree): TocSplit[] {
	if (typeof tree === "string") return [];
	const own = tree.group ? [tree] : [];
	return [...own, ...tree.items.flatMap(subGroupsOf)];
}

/** The sub-group `id`, and the block it is in. */
export function findSub(arr: TocArrangement, id: string): { block: TocBlock; split: TocSplit } | null {
	for (const block of arr.rows.flat()) {
		const split = subGroupsOf(block.tree).find((s) => s.group!.id === id);
		if (split) return { block, split };
	}
	return null;
}

/** The ids of the groups around card `id`, outermost first (the block's, then sub-groups'). */
export function groupsAround(arr: TocArrangement, id: string): string[] {
	for (const block of arr.rows.flat()) {
		if (!cardsOf(block.tree).includes(id)) continue;
		const out = isGroup(block) ? [block.id] : [];
		const walk = (tree: TocTree): boolean => {
			if (typeof tree === "string") return tree === id;
			for (const item of tree.items) {
				if (!walk(item)) continue;
				if (tree.group) out.splice(isGroup(block) ? 1 : 0, 0, tree.group.id);
				return true;
			}
			return false;
		};
		walk(block.tree);
		return out;
	}
	return [];
}

/** The cards in rows of `perRow`, each its own block: the simple grid. */
export function simpleArrangement(children: readonly string[], perRow: number): TocArrangement {
	const n = Math.max(1, Math.round(perRow));
	const rows: TocBlock[][] = [];
	children.forEach((id, i) => {
		if (i % n === 0) rows.push([]);
		rows[rows.length - 1]!.push({ id: `b-${id}`, tree: id });
	});
	return { rows };
}

/**
 * Keeps only `keep` cards, each once; containers with one item become that item (a sub-group of
 * one cell is no group), a row inside a row (or a column inside a column) is merged into it,
 * unless it is a sub-group (its outline stays).
 */
function prune(tree: TocTree, keep: ReadonlySet<string>, seen: Set<string>): TocTree | null {
	if (typeof tree === "string") {
		if (!keep.has(tree) || seen.has(tree)) return null;
		seen.add(tree);
		return tree;
	}
	const items: TocTree[] = [];
	for (const item of tree.items) {
		const kept = prune(item, keep, seen);
		if (kept === null) continue;
		if (typeof kept !== "string" && kept.dir === tree.dir && !kept.group) items.push(...kept.items);
		else items.push(kept);
	}
	if (items.length === 0) return null;
	if (items.length === 1) return items[0]!;
	return tree.group ? { dir: tree.dir, items, group: { ...tree.group } } : { dir: tree.dir, items };
}

/**
 * The stored arrangement fitted to the parent's children now: cards that left are dropped, new
 * ones are added after the last cell (filling the last row up to `perRow`, then new rows), in
 * their sibling order. Nothing stored: the simple grid.
 */
export function normalize(stored: TocArrangement | undefined, children: readonly string[], perRow: number): TocArrangement {
	if (!stored) return simpleArrangement(children, perRow);
	const keep = new Set(children);
	const seen = new Set<string>();
	const ids = new Set<string>();
	const unique = (id: string) => {
		while (ids.has(id)) id = `${id}+`;
		ids.add(id);
		return id;
	};
	const rows: TocBlock[][] = [];
	for (const row of stored.rows) {
		const out: TocBlock[] = [];
		for (const block of row) {
			let tree = prune(block.tree, keep, seen);
			if (tree === null) continue;
			// A sub-group holding the whole group is the group itself: one outline, not two.
			if (typeof tree !== "string" && tree.group) tree = { dir: tree.dir, items: tree.items };
			out.push({ id: unique(block.id), tree, ...(block.color && typeof tree !== "string" ? { color: block.color } : {}) });
		}
		if (out.length) rows.push(out);
	}
	// Sub-group ids are unique too (a copy pasted twice, an edit by hand).
	const reid = (tree: TocTree): TocTree => (typeof tree === "string" ? tree : { dir: tree.dir, items: tree.items.map(reid), ...(tree.group ? { group: { ...tree.group, id: unique(tree.group.id) } } : {}) });
	for (const row of rows) for (const block of row) block.tree = reid(block.tree);
	const n = Math.max(1, Math.round(perRow));
	for (const id of children) {
		if (seen.has(id)) continue;
		let last = rows[rows.length - 1];
		if (!last || last.length >= n) rows.push((last = []));
		last.push({ id: unique(`b-${id}`), tree: id });
	}
	return colorGroups({ rows });
}

/**
 * Groups without a color get one: blocks the next one not in use, sub-groups one different from
 * every group around them (so nested outlines stay apart).
 */
function colorGroups(arr: TocArrangement): TocArrangement {
	const used = new Set(arr.rows.flat().map((b) => b.color).filter((c): c is string => !!c));
	let next = 0;
	const pick = () => {
		const free = GROUP_COLORS.find((c) => !used.has(c));
		const color = free ?? GROUP_COLORS[next++ % GROUP_COLORS.length]!;
		used.add(color);
		return color;
	};
	const paint = (tree: TocTree, around: string[], index: number): TocTree => {
		if (typeof tree === "string") return tree;
		let group = tree.group;
		if (group && !group.color) {
			const color = GROUP_COLORS.find((c, i) => !around.includes(c) && i >= index % GROUP_COLORS.length) ?? GROUP_COLORS.find((c) => !around.includes(c)) ?? GROUP_COLORS[0]!;
			group = { ...group, color };
		}
		const inner = group?.color ? [...around, group.color] : around;
		return { dir: tree.dir, items: tree.items.map((item, i) => paint(item, inner, index + i + 1)), ...(group ? { group } : {}) };
	};
	return {
		rows: arr.rows.map((row) =>
			row.map((b) => {
				if (!isGroup(b)) return b.color ? { id: b.id, tree: b.tree } : b;
				const color = b.color ?? pick();
				return { ...b, color, tree: paint(b.tree, [color], 1) };
			}),
		),
	};
}

function axisOf(side: Side): "row" | "col" {
	return side === "left" || side === "right" ? "row" : "col";
}

/** `tree` with `payload` put beside (left, right) or above / below (top, bottom) the cell `target`. */
function insertBeside(tree: TocTree, target: string, payload: TocTree, side: Side): TocTree {
	const dir = axisOf(side);
	const before = side === "left" || side === "top";
	if (typeof tree === "string") return tree === target ? { dir, items: before ? [payload, tree] : [tree, payload] } : tree;
	const items: TocTree[] = [];
	for (const item of tree.items) {
		if (item === target && tree.dir === dir) {
			if (before) items.push(payload, item);
			else items.push(item, payload);
		} else items.push(insertBeside(item, target, payload, side));
	}
	return { dir: tree.dir, items, ...(tree.group ? { group: tree.group } : {}) };
}

/** `tree` with the cell `target` and `payload` made into a new sub-group, where the cell was. */
function wrapAsSub(tree: TocTree, target: string, payload: TocTree, side: Side, id: string): TocTree {
	if (typeof tree === "string") {
		if (tree !== target) return tree;
		const before = side === "left" || side === "top";
		return { dir: axisOf(side), items: before ? [payload, tree] : [tree, payload], group: { id } };
	}
	return { dir: tree.dir, items: tree.items.map((item) => wrapAsSub(item, target, payload, side, id)), ...(tree.group ? { group: tree.group } : {}) };
}

/** Takes `cards` out of every block but `except` (groups close up; an emptied block goes away). */
function withoutCards(arr: TocArrangement, cards: ReadonlySet<string>, except?: TocBlock): TocArrangement {
	const rows = arr.rows
		.map((row) =>
			row
				.map((b) => {
					if (b === except) return b;
					const all = new Set(cardsOf(b.tree).filter((c) => !cards.has(c)));
					const tree = prune(b.tree, all, new Set());
					return tree === null ? null : { ...b, tree };
				})
				.filter((b): b is TocBlock => !!b),
		)
		.filter((row) => row.length > 0);
	return { rows };
}

function findBlock(arr: TocArrangement, pred: (b: TocBlock) => boolean): { row: number; index: number; block: TocBlock } | null {
	for (let r = 0; r < arr.rows.length; r++) {
		const row = arr.rows[r]!;
		for (let i = 0; i < row.length; i++) if (pred(row[i]!)) return { row: r, index: i, block: row[i]! };
	}
	return null;
}

/** What is moved: its tree, and the block it comes from. */
function payloadOf(arr: TocArrangement, moving: TocMoving): { tree: TocTree; block: TocBlock } | null {
	if (moving.kind === "card") {
		const found = findBlock(arr, (b) => cardsOf(b.tree).includes(moving.card));
		return found ? { tree: moving.card, block: found.block } : null;
	}
	if (moving.kind === "sub") {
		const found = findSub(arr, moving.sub);
		return found ? { tree: found.split, block: found.block } : null;
	}
	const found = findBlock(arr, (b) => b.id === moving.block);
	return found ? { tree: found.block.tree, block: found.block } : null;
}

/**
 * Moves a cell, a sub-group or a group to `drop`. `children` are the parent's children (for
 * normalizing); `newId` names a block or sub-group made by the move. Returns the arrangement
 * unchanged when the drop makes no sense (onto itself, a group into itself).
 */
export function moveIn(arr: TocArrangement, moving: TocMoving, drop: TocDrop, children: readonly string[], newId: string): TocArrangement {
	const source = payloadOf(arr, moving);
	if (!source) return arr;
	const payload = source.tree;
	const moved = new Set(cardsOf(payload));
	if (drop.kind === "cell" || drop.kind === "sub") {
		if (moved.has(drop.card)) return arr;
		// Take it out first (cards are unique, so the target is still found by its id).
		const rest = moving.kind === "block" ? { rows: arr.rows.map((row) => row.filter((b) => b.id !== moving.block)).filter((row) => row.length > 0) } : withoutCards(arr, moved);
		const target = findBlock(rest, (b) => cardsOf(b.tree).includes(drop.card));
		if (!target) return arr;
		const place = (tree: TocTree) => (drop.kind === "sub" ? wrapAsSub(tree, drop.card, payload, drop.side, newId) : insertBeside(tree, drop.card, payload, drop.side));
		const rows = rest.rows.map((row, r) => (r === target.row ? row.map((b, i) => (i === target.index ? { ...b, tree: place(b.tree) } : b)) : row));
		return normalize({ rows }, children, Number.POSITIVE_INFINITY);
	}
	// A grid cell of its own: put the new block in first (indices are the ones the drop was
	// measured on), then take the original out. A sub-group moved out becomes a group of its own.
	let placed: TocBlock;
	if (moving.kind === "block") placed = { ...source.block };
	else if (moving.kind === "sub" && typeof payload !== "string") placed = { id: newId, tree: { dir: payload.dir, items: payload.items }, ...(payload.group?.color ? { color: payload.group.color } : {}) };
	else placed = { id: newId, tree: payload };
	const rows = arr.rows.map((row) => [...row]);
	const r = Math.max(0, Math.min(drop.row, rows.length));
	if (drop.newRow || r === rows.length) rows.splice(r, 0, [placed]);
	else rows[r]!.splice(Math.max(0, Math.min(drop.index, rows[r]!.length)), 0, placed);
	let out: TocArrangement = { rows };
	if (moving.kind === "block") out = { rows: out.rows.map((row) => row.filter((b) => b === placed || b !== source.block)).filter((row) => row.length > 0) };
	else out = withoutCards(out, moved, placed);
	const clean = { rows: out.rows.map((row) => row.map((b) => ({ id: b.id, tree: b.tree, ...(b.color ? { color: b.color } : {}) }))) };
	return normalize(clean, children, Number.POSITIVE_INFINITY);
}

/** Changes the sub-groups of a tree by `fn` (null: the sub-group goes, its cells stay in its place). */
function mapSubs(tree: TocTree, id: string, fn: (g: TocSubGroup) => TocSubGroup | null): TocTree {
	if (typeof tree === "string") return tree;
	const items = tree.items.map((item) => mapSubs(item, id, fn));
	if (tree.group?.id !== id) return { dir: tree.dir, items, ...(tree.group ? { group: tree.group } : {}) };
	const group = fn(tree.group);
	return group ? { dir: tree.dir, items, group } : { dir: tree.dir, items };
}

/** A group's or sub-group's outline color (undefined: back to an automatic one). */
export function recolor(arr: TocArrangement, id: string, color: string | undefined): TocArrangement {
	return {
		rows: arr.rows.map((row) =>
			row.map((b) => {
				if (b.id === id) return { id: b.id, tree: b.tree, ...(color ? { color } : {}) };
				return { ...b, tree: mapSubs(b.tree, id, (g) => ({ id: g.id, ...(color ? { color } : {}) })) };
			}),
		),
	};
}

/**
 * Breaks a group up: a block's cells become cells of the grid of their own, in its place; a
 * sub-group's cells stay where they are in the group around it.
 */
export function ungroup(arr: TocArrangement, id: string): TocArrangement {
	return {
		rows: arr.rows.map((row) =>
			row.flatMap((b): TocBlock[] => {
				if (b.id === id) return cardsOf(b.tree).map((card, i) => ({ id: i === 0 ? b.id : `${b.id}-${i}`, tree: card }));
				const tree = mapSubs(b.tree, id, () => null);
				// The freed split merges into a parent running the same way.
				return [{ ...b, tree: prune(tree, new Set(cardsOf(tree)), new Set()) ?? tree }];
			}),
		),
	};
}
