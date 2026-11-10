import { describe, expect, it } from "vitest";
import { cardsOf, findSub, groupsAround, moveIn, normalize, recolor, simpleArrangement, subGroupsOf, ungroup, type TocArrangement } from "./toc-layout";

const kids = ["B", "C", "D", "E", "F"];
const shape = (arr: TocArrangement) => arr.rows.map((row) => row.map((b) => b.tree));

describe("table of contents arrangement", () => {
	it("lays the simple grid out in rows of N", () => {
		expect(shape(simpleArrangement(["a", "b", "c", "d", "e", "f", "g"], 3))).toEqual([["a", "b", "c"], ["d", "e", "f"], ["g"]]);
		expect(shape(simpleArrangement([], 3))).toEqual([]);
	});

	it("fits a stored arrangement to the children: gone cards out, new ones at the end", () => {
		const stored: TocArrangement = { rows: [[{ id: "g", tree: { dir: "row", items: ["B", "X"] }, color: "1" }, { id: "d", tree: "D" }]] };
		const out = normalize(stored, ["B", "D", "N1", "N2"], 3);
		// The group lost X: a lone cell is not a group (no color).
		expect(out.rows[0]!.map((b) => b.tree)).toEqual(["B", "D", "N1"]);
		expect(out.rows[0]![0]!.color).toBeUndefined();
		expect(shape(out)[1]).toEqual(["N2"]);
	});

	it("forms a group by dropping a cell beside or below another, as the drawings show", () => {
		let arr = simpleArrangement(kids, 2);
		// C to the right of B, D below B, E right of D.
		arr = moveIn(arr, { kind: "card", card: "C" }, { kind: "cell", card: "B", side: "right" }, kids, "n1");
		arr = moveIn(arr, { kind: "card", card: "D" }, { kind: "cell", card: "B", side: "bottom" }, kids, "n2");
		arr = moveIn(arr, { kind: "card", card: "E" }, { kind: "cell", card: "D", side: "right" }, kids, "n3");
		const group = arr.rows[0]![0]!;
		expect(group.tree).toEqual({ dir: "row", items: [{ dir: "col", items: ["B", { dir: "row", items: ["D", "E"] }] }, "C"] });
		expect(group.color).toBeTruthy();
		// F is still a cell of its own.
		expect(arr.rows.flat().filter((b) => b.tree === "F")).toHaveLength(1);
		expect(new Set(arr.rows.flat().flatMap((b) => cardsOf(b.tree)))).toEqual(new Set(kids));
	});

	it("moves a cell into a new cell of the grid, out of its group", () => {
		let arr = simpleArrangement(kids, 5);
		arr = moveIn(arr, { kind: "card", card: "C" }, { kind: "cell", card: "B", side: "right" }, kids, "n1");
		// Out of the group into a new row at the end.
		arr = moveIn(arr, { kind: "card", card: "C" }, { kind: "slot", row: 1, index: 0, newRow: true }, kids, "n2");
		expect(shape(arr)).toEqual([["B", "D", "E", "F"], ["C"]]);
		// Next to the first cell of the first row.
		arr = moveIn(arr, { kind: "card", card: "F" }, { kind: "slot", row: 0, index: 1, newRow: false }, kids, "n3");
		expect(shape(arr)[0]).toEqual(["B", "F", "D", "E"]);
	});

	it("moves a whole group, keeping its color", () => {
		let arr = simpleArrangement(kids, 5);
		arr = moveIn(arr, { kind: "card", card: "C" }, { kind: "cell", card: "B", side: "bottom" }, kids, "n1");
		const group = arr.rows[0]![0]!;
		arr = recolor(arr, group.id, "#ff0000");
		arr = moveIn(arr, { kind: "block", block: group.id }, { kind: "slot", row: 0, index: 4, newRow: false }, kids, "n2");
		expect(shape(arr)[0]).toEqual(["D", "E", "F", { dir: "col", items: ["B", "C"] }]);
		expect(arr.rows[0]![3]!.color).toBe("#ff0000");
	});

	it("drops a group beside a cell: the two groups become one", () => {
		let arr = simpleArrangement(kids, 5);
		arr = moveIn(arr, { kind: "card", card: "C" }, { kind: "cell", card: "B", side: "right" }, kids, "n1");
		const g = arr.rows[0]![0]!.id;
		arr = moveIn(arr, { kind: "block", block: g }, { kind: "cell", card: "F", side: "bottom" }, kids, "n2");
		expect(shape(arr)).toEqual([["D", "E", { dir: "col", items: ["F", { dir: "row", items: ["B", "C"] }] }]]);
	});

	it("ignores drops into themselves", () => {
		let arr = simpleArrangement(kids, 5);
		const same = moveIn(arr, { kind: "card", card: "B" }, { kind: "cell", card: "B", side: "right" }, kids, "n");
		expect(same).toBe(arr);
		arr = moveIn(arr, { kind: "card", card: "C" }, { kind: "cell", card: "B", side: "right" }, kids, "n1");
		const g = arr.rows[0]![0]!.id;
		expect(moveIn(arr, { kind: "block", block: g }, { kind: "cell", card: "C", side: "top" }, kids, "n2")).toBe(arr);
	});

	it("breaks a group up in its place", () => {
		let arr = simpleArrangement(kids, 5);
		arr = moveIn(arr, { kind: "card", card: "C" }, { kind: "cell", card: "B", side: "right" }, kids, "n1");
		arr = ungroup(arr, arr.rows[0]![0]!.id);
		expect(shape(normalize(arr, kids, 5))).toEqual([["B", "C", "D", "E", "F"]]);
	});

	describe("sub-groups", () => {
		/** B, C, D in one group (a row). */
		const grouped = () => {
			let arr = simpleArrangement(kids, 5);
			arr = moveIn(arr, { kind: "card", card: "C" }, { kind: "cell", card: "B", side: "right" }, kids, "n1");
			return moveIn(arr, { kind: "card", card: "D" }, { kind: "cell", card: "C", side: "right" }, kids, "n2");
		};

		it("makes a sub-group from a cell dropped on the middle of a cell of the same group", () => {
			const arr = moveIn(grouped(), { kind: "card", card: "D" }, { kind: "sub", card: "C", side: "bottom" }, kids, "s1");
			const block = arr.rows[0]![0]!;
			expect(block.tree).toEqual({ dir: "row", items: ["B", { dir: "col", items: ["C", "D"], group: { id: "s1", color: expect.any(String) } }] });
			// Its own outline color, not the group's.
			expect(findSub(arr, "s1")!.split.group!.color).not.toBe(block.color);
			expect(groupsAround(arr, "D")).toEqual([block.id, "s1"]);
			expect(groupsAround(arr, "B")).toEqual([block.id]);
		});

		it("nests sub-groups in sub-groups", () => {
			let arr = moveIn(grouped(), { kind: "card", card: "D" }, { kind: "sub", card: "C", side: "bottom" }, kids, "s1");
			arr = moveIn(arr, { kind: "card", card: "B" }, { kind: "sub", card: "D", side: "right" }, kids, "s2");
			// B left the group's top level: s1 holds the whole group now, so it is the group's outline.
			expect(subGroupsOf(arr.rows[0]![0]!.tree).map((s) => s.group!.id)).toEqual(["s2"]);
			expect(groupsAround(arr, "B")).toEqual([arr.rows[0]![0]!.id, "s2"]);
			// With a cell left beside them, both levels stay.
			let deep = moveIn(grouped(), { kind: "card", card: "D" }, { kind: "sub", card: "C", side: "bottom" }, kids, "s1");
			deep = moveIn(deep, { kind: "card", card: "E" }, { kind: "cell", card: "B", side: "left" }, kids, "x");
			deep = moveIn(deep, { kind: "card", card: "B" }, { kind: "sub", card: "D", side: "right" }, kids, "s2");
			expect(subGroupsOf(deep.rows[0]![0]!.tree).map((s) => s.group!.id)).toEqual(["s1", "s2"]);
			expect(groupsAround(deep, "B")).toEqual([deep.rows[0]![0]!.id, "s1", "s2"]);
			const colors = [deep.rows[0]![0]!.color, findSub(deep, "s1")!.split.group!.color, findSub(deep, "s2")!.split.group!.color];
			expect(new Set(colors).size).toBe(3);
		});

		it("moves a sub-group as a unit, inside its group or out to a group of its own", () => {
			let arr = moveIn(grouped(), { kind: "card", card: "D" }, { kind: "sub", card: "C", side: "bottom" }, kids, "s1");
			arr = recolor(arr, "s1", "#123456");
			const inside = moveIn(arr, { kind: "sub", sub: "s1" }, { kind: "cell", card: "B", side: "left" }, kids, "x");
			expect(inside.rows[0]![0]!.tree).toEqual({ dir: "row", items: [{ dir: "col", items: ["C", "D"], group: { id: "s1", color: "#123456" } }, "B"] });
			const out = moveIn(arr, { kind: "sub", sub: "s1" }, { kind: "slot", row: 1, index: 0, newRow: true }, kids, "g2");
			expect(shape(out)).toEqual([["B", "E", "F"], [{ dir: "col", items: ["C", "D"] }]]);
			expect(out.rows[1]![0]!.color).toBe("#123456");
		});

		it("dissolves a sub-group in its place, and one left with one cell", () => {
			const arr = moveIn(grouped(), { kind: "card", card: "D" }, { kind: "sub", card: "C", side: "right" }, kids, "s1");
			expect(ungroup(arr, "s1").rows[0]![0]!.tree).toEqual({ dir: "row", items: ["B", "C", "D"] });
			// D leaves the grid's children: the sub-group of C alone is no group.
			const left = normalize(arr, ["B", "C", "E", "F"], 5);
			expect(left.rows[0]![0]!.tree).toEqual({ dir: "row", items: ["B", "C"] });
		});
	});
});
