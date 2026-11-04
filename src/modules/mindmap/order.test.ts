import { describe, expect, it } from "vitest";
import { boardPredecessor, followStored, placeChild, pruneOrder } from "./order";

const ids = (list: { id: string }[]) => list.map((n) => n.id).join("");
const nodes = (s: string) => [...s].map((id) => ({ id }));

describe("followStored", () => {
	it("follows the stored order", () => {
		expect(ids(followStored(nodes("abcd"), ["d", "a", "c", "b"]))).toBe("dacb");
	});
	it("keeps the board order without a stored one", () => {
		expect(ids(followStored(nodes("abcd"), undefined))).toBe("abcd");
	});
	it("puts children the list doesn't name after their board predecessor", () => {
		// e sits after c on the board; x first on the board.
		expect(ids(followStored(nodes("xabce"), ["c", "b", "a"]))).toBe("xceba");
	});
	it("ignores stale and repeated ids", () => {
		expect(ids(followStored(nodes("abc"), ["z", "c", "c", "a"]))).toBe("cab");
	});
});

describe("placeChild", () => {
	it("inserts after a sibling, first, or last", () => {
		expect(placeChild({}, "p", "x", ["a", "b"], "a").p).toEqual(["a", "x", "b"]);
		expect(placeChild({}, "p", "x", ["a", "b"], null).p).toEqual(["x", "a", "b"]);
		expect(placeChild({}, "p", "x", ["a", "b"]).p).toEqual(["a", "b", "x"]);
	});
	it("moves within the same parent", () => {
		expect(placeChild({ p: ["a", "b", "c", "d"] }, "p", "d", ["a", "b", "c", "d"], "a").p).toEqual(["a", "d", "b", "c"]);
	});
	it("takes the child out of its old parent's list", () => {
		const out = placeChild({ old: ["x", "y"], p: ["a"] }, "p", "x", ["a"], "a");
		expect(out).toEqual({ old: ["y"], p: ["a", "x"] });
	});
});

describe("boardPredecessor", () => {
	it("is the sibling before the card on the board", () => {
		expect(boardPredecessor(["a", "b", "c"], ["a", "d", "b", "c"], "d")).toBe("a");
		expect(boardPredecessor(["a", "b", "c"], ["d", "a", "b", "c"], "d")).toBeNull();
	});
});

describe("pruneOrder", () => {
	it("drops missing cards and empty lists", () => {
		const exists = (id: string) => id !== "gone";
		expect(pruneOrder({ p: ["a", "gone", "a"], gone: ["a"], q: ["gone"] }, exists)).toEqual({ p: ["a"] });
		expect(pruneOrder({ q: ["gone"] }, exists)).toBeUndefined();
	});
});
