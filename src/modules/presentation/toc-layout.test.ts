import { describe, expect, it } from "vitest";
import { cardsOf, moveIn, normalize, recolor, simpleArrangement, ungroup, type TocArrangement } from "./toc-layout";

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
});
