// The table of contents' free arrangement (pure, unit-tested).
//
// A parent's children are shown as cells in rows. Each row holds blocks; a block is one cell, or
// a cell group: cells placed beside or below each other, as a tree of rows and columns (a cell
// dropped to the right of another makes a row of the two, one dropped below makes a column), so
// cells of different sizes stay tidy (three small cells beside or below one large cell).

import type { TocArrangement, TocBlock, TocTree } from "../../data/schema";

export type { TocArrangement, TocBlock, TocTree };

export type Side = "left" | "right" | "top" | "bottom";

/** Where a dragged cell or group lands. */
export type TocDrop =
	/** Beside or below a cell: joins (or makes) that cell's group. */
	| { kind: "cell"; card: string; side: Side }
	/** A cell of the grid of its own: in row `row` before block `index`, or a new row there. */
	| { kind: "slot"; row: number; index: number; newRow: boolean };

/** What is dragged: one cell, or a whole group. */
export type TocMoving = { kind: "card"; card: string } | { kind: "block"; block: string };

/** Colors given to new groups in turn (canvas colors). */
export const GROUP_COLORS = ["5", "4", "1", "6", "3", "2"];

export function cardsOf(tree: TocTree): string[] {
	return typeof tree === "string" ? [tree] : tree.items.flatMap(cardsOf);
}

export function isGroup(block: TocBlock): boolean {
	return typeof block.tree !== "string";
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
 * Keeps only `keep` cards, each once; containers with one item become that item, a row inside a
 * row (or a column inside a column) is merged into it.
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
		if (typeof kept !== "string" && kept.dir === tree.dir) items.push(...kept.items);
		else items.push(kept);
	}
	if (items.length === 0) return null;
	if (items.length === 1) return items[0]!;
	return { dir: tree.dir, items };
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
	const rows: TocBlock[][] = [];
	for (const row of stored.rows) {
		const out: TocBlock[] = [];
		for (const block of row) {
			const tree = prune(block.tree, keep, seen);
			if (tree === null) continue;
			let id = block.id;
			while (ids.has(id)) id = `${id}+`;
			ids.add(id);
			out.push({ id, tree, ...(block.color && typeof tree !== "string" ? { color: block.color } : {}) });
		}
		if (out.length) rows.push(out);
	}
	const n = Math.max(1, Math.round(perRow));
	for (const id of children) {
		if (seen.has(id)) continue;
		let last = rows[rows.length - 1];
		if (!last || last.length >= n) rows.push((last = []));
		let bid = `b-${id}`;
		while (ids.has(bid)) bid = `${bid}+`;
		ids.add(bid);
		last.push({ id: bid, tree: id });
	}
	return colorGroups({ rows });
}

/** Groups without a color get the next one not in use. */
function colorGroups(arr: TocArrangement): TocArrangement {
	const used = new Set(arr.rows.flat().map((b) => b.color).filter((c): c is string => !!c));
	let next = 0;
	const pick = () => {
		const free = GROUP_COLORS.find((c) => !used.has(c));
		const color = free ?? GROUP_COLORS[next++ % GROUP_COLORS.length]!;
		used.add(color);
		return color;
	};
	return { rows: arr.rows.map((row) => row.map((b) => (isGroup(b) && !b.color ? { ...b, color: pick() } : !isGroup(b) && b.color ? { id: b.id, tree: b.tree } : b))) };
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
	return { dir: tree.dir, items };
}

/** Takes card `id` out of the arrangement (its group closes up; an emptied block goes away). */
function withoutCard(arr: TocArrangement, id: string): TocArrangement {
	const rows = arr.rows
		.map((row) =>
			row
				.map((b) => {
					const all = new Set(cardsOf(b.tree));
					all.delete(id);
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

/**
 * Moves a cell or a group to `drop`. `children` are the parent's children (for normalizing);
 * `newId` names a block made for a cell dropped into a cell of the grid of its own. Returns the
 * arrangement unchanged when the drop makes no sense (a cell onto itself, a group into itself).
 */
export function moveIn(arr: TocArrangement, moving: TocMoving, drop: TocDrop, children: readonly string[], newId: string): TocArrangement {
	const source = moving.kind === "card" ? findBlock(arr, (b) => cardsOf(b.tree).includes(moving.card)) : findBlock(arr, (b) => b.id === moving.block);
	if (!source) return arr;
	const payload: TocTree = moving.kind === "card" ? moving.card : source.block.tree;
	const moved = new Set(cardsOf(payload));
	if (drop.kind === "cell") {
		if (moved.has(drop.card)) return arr;
		// Take it out first (cards are unique, so the target is still found by its id).
		const rest = moving.kind === "card" ? withoutCard(arr, moving.card) : { rows: arr.rows.map((row) => row.filter((b) => b.id !== moving.block)).filter((row) => row.length > 0) };
		const target = findBlock(rest, (b) => cardsOf(b.tree).includes(drop.card));
		if (!target) return arr;
		const rows = rest.rows.map((row, r) => (r === target.row ? row.map((b, i) => (i === target.index ? { ...b, tree: insertBeside(b.tree, drop.card, payload, drop.side) } : b)) : row));
		return normalize({ rows }, children, Number.POSITIVE_INFINITY);
	}
	// A grid cell of its own: put the new block in first (indices are the ones the drop was
	// measured on), then take the original out.
	const block: TocBlock = moving.kind === "block" ? { ...source.block } : { id: newId, tree: payload };
	const placed: TocBlock = { ...block };
	const rows = arr.rows.map((row) => [...row]);
	const r = Math.max(0, Math.min(drop.row, rows.length));
	if (drop.newRow || r === rows.length) rows.splice(r, 0, [placed]);
	else rows[r]!.splice(Math.max(0, Math.min(drop.index, rows[r]!.length)), 0, placed);
	let out: TocArrangement = { rows };
	if (moving.kind === "block") out = { rows: out.rows.map((row) => row.filter((b) => b === placed || b !== source.block)).filter((row) => row.length > 0) };
	else {
		// The card's old place: every occurrence except the new block.
		out = {
			rows: out.rows
				.map((row) =>
					row
						.map((b) => {
							if (b === placed) return b;
							const all = new Set(cardsOf(b.tree));
							all.delete(moving.card);
							const tree = prune(b.tree, all, new Set());
							return tree === null ? null : { ...b, tree };
						})
						.filter((b): b is TocBlock => !!b),
				)
				.filter((row) => row.length > 0),
		};
	}
	const clean = { rows: out.rows.map((row) => row.map((b) => ({ id: b.id, tree: b.tree, ...(b.color ? { color: b.color } : {}) }))) };
	return normalize(clean, children, Number.POSITIVE_INFINITY);
}

/** The group's outline color (undefined: back to an automatic one). */
export function recolor(arr: TocArrangement, block: string, color: string | undefined): TocArrangement {
	return { rows: arr.rows.map((row) => row.map((b) => (b.id === block ? { id: b.id, tree: b.tree, ...(color ? { color } : {}) } : b))) };
}

/** Breaks a group up: its cells become cells of the grid of their own, in its place. */
export function ungroup(arr: TocArrangement, block: string): TocArrangement {
	return {
		rows: arr.rows.map((row) =>
			row.flatMap((b) => (b.id === block ? cardsOf(b.tree).map((id, i) => ({ id: i === 0 ? b.id : `${b.id}-${i}`, tree: id })) : [b])),
		),
	};
}
