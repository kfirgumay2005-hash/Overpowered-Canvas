import { describe, expect, it } from "vitest";
import { fixSelection, leavesGroup, regroupCopies } from "./logic";

const groups: Record<string, string> = { a1: "A", a2: "A", a3: "A", b1: "B", b2: "B" };
const groupOf = (id: string) => groups[id];
const fix = (before: string[], after: string[], opts: { entered?: string; toggledOff?: boolean } = {}) =>
	fixSelection({ before: new Set(before), after: new Set(after), groupOf, entered: opts.entered ?? null, toggledOff: !!opts.toggledOff });

describe("smart group selection", () => {
	it("a click on one card picks its whole group", () => {
		expect([...fix([], ["a1"]).add]).toEqual(["A"]);
	});
	it("a plain click on one card of the selected group keeps the group", () => {
		expect([...fix(["a1", "a2", "a3"], ["a2"]).add]).toEqual(["A"]);
	});
	it("cards outside groups change nothing", () => {
		const r = fix([], ["x", "y"]);
		expect(r.add.size + r.remove.size).toBe(0);
	});
	it("a shift-click that takes a card out drops its whole group, other groups stay", () => {
		const r = fix(["a1", "a2", "a3", "b1", "b2"], ["a1", "a3", "b1", "b2"], { toggledOff: true });
		expect([...r.remove]).toEqual(["A"]);
		expect([...r.add]).toEqual(["B"]);
	});
	it("a shrinking selection box never drops cards by itself", () => {
		expect(fix(["a1", "a2"], ["a1"]).remove.size).toBe(0);
	});
	it("an entered group is picked card by card", () => {
		const r = fix(["a1", "a2", "a3"], ["a2"], { entered: "A" });
		expect(r.add.size + r.remove.size).toBe(0);
	});
	it("leaves the entered group when something else or nothing is selected", () => {
		expect(leavesGroup(new Set(["a1"]), groupOf, "A")).toBe(false);
		expect(leavesGroup(new Set(["a1", "b1"]), groupOf, "A")).toBe(true);
		expect(leavesGroup(new Set<string>(), groupOf, "A")).toBe(true);
	});
});

describe("copies of grouped cards", () => {
	let n = 0;
	const newId = () => `new${++n}`;
	it("form their own group and keep other data", () => {
		const input = [
			{ id: "1", "x-opc": { smartGroup: "A", locked: true } },
			{ id: "2", "x-opc": { smartGroup: "A" } },
			{ id: "3", "x-opc": { smartGroup: "B" } },
			{ id: "4" },
		];
		const out = regroupCopies(input, "x-opc", newId);
		expect(out[0]!["x-opc"]).toEqual({ smartGroup: "new1", locked: true });
		expect(out[1]!["x-opc"]).toEqual({ smartGroup: "new1" });
		// A single copied card of a group is no group.
		expect(out[2]!["x-opc"]).toBeUndefined();
		expect(out[3]).toBe(input[3]);
		// The input is untouched (history snapshots share these objects).
		expect(input[0]!["x-opc"]).toEqual({ smartGroup: "A", locked: true });
	});
});
