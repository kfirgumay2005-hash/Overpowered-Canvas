import { describe, expect, it } from "vitest";
import { nextSlide, outgoing, slideOrder, type SlideEdge } from "./path";

describe("outgoing", () => {
	it("orders by explicit order, then numeric label, then file order", () => {
		const edges: SlideEdge[] = [
			{ from: "a", to: "x" },
			{ from: "a", to: "y", label: "2" },
			{ from: "a", to: "z", order: 1 },
			{ from: "b", to: "w" },
		];
		expect(outgoing(edges, "a")).toEqual(["z", "y", "x"]);
		expect(outgoing(edges, "c")).toEqual([]);
	});
});

describe("nextSlide / slideOrder", () => {
	// a → b → c, a → d (second), d → e; cycle e → a is ignored once visited.
	const edges: SlideEdge[] = [
		{ from: "a", to: "b", order: 1 },
		{ from: "a", to: "d", order: 2 },
		{ from: "b", to: "c" },
		{ from: "d", to: "e" },
		{ from: "e", to: "a" },
	];

	it("follows edges depth-first and backtracks to remaining branches", () => {
		expect(nextSlide(edges, ["a"])).toBe("b");
		expect(nextSlide(edges, ["a", "b", "c"])).toBe("d");
		expect(nextSlide(edges, ["a", "b", "c", "d", "e"])).toBeNull();
	});

	it("lists the whole presentation", () => {
		expect(slideOrder(edges, "a")).toEqual(["a", "b", "c", "d", "e"]);
		expect(slideOrder([], "solo")).toEqual(["solo"]);
	});
});
