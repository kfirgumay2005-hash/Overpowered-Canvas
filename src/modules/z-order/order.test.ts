import { describe, expect, it } from "vitest";
import { reorder, type ZItem } from "./order";

const items: ZItem[] = [
	{ id: "a", z: 1 },
	{ id: "b", z: 2 },
	{ id: "c", z: 3 },
	{ id: "d", z: 4 },
];
const all = (id: string) => new Set(items.map((i) => i.id).filter((x) => x !== id));

describe("reorder", () => {
	it("brings to front above everything, keeping relative order", () => {
		expect(reorder(items, new Set(["a", "b"]), "front", all)).toEqual(new Map([["a", 5], ["b", 6]]));
	});

	it("sends to back below everything", () => {
		expect(reorder(items, new Set(["d"]), "back", all)).toEqual(new Map([["d", 0]]));
	});

	it("moves forward past the next overlapping item only", () => {
		expect(reorder(items, new Set(["a"]), "forward", all)).toEqual(new Map([["b", 1], ["a", 2]]));
		// b does not overlap a: a swaps with c instead.
		const noB = (id: string) => (id === "a" ? new Set(["c", "d"]) : all(id));
		expect(reorder(items, new Set(["a"]), "forward", noB)).toEqual(new Map([["c", 1], ["a", 3]]));
	});

	it("moves backward", () => {
		expect(reorder(items, new Set(["c"]), "backward", all)).toEqual(new Map([["b", 3], ["c", 2]]));
	});

	it("does nothing at the edges or for unknown targets", () => {
		expect(reorder(items, new Set(["d"]), "forward", all).size).toBe(0);
		expect(reorder(items, new Set(["a"]), "backward", all).size).toBe(0);
		expect(reorder(items, new Set(["zzz"]), "front", all).size).toBe(0);
	});
});
