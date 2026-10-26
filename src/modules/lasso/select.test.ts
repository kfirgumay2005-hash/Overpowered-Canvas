import { describe, expect, it } from "vitest";
import { caught } from "./select";

describe("lasso", () => {
	const square = [
		{ x: 0, y: 0 },
		{ x: 500, y: 0 },
		{ x: 500, y: 500 },
		{ x: 0, y: 500 },
	];
	const nodes = [
		{ id: "in", x: 100, y: 100, width: 100, height: 50 },
		{ id: "half", x: 420, y: 100, width: 200, height: 50 }, // middle at 520: outside
		{ id: "out", x: 700, y: 100, width: 100, height: 50 },
		{ id: "g-in", x: 50, y: 300, width: 300, height: 150, group: true },
		{ id: "g-part", x: 300, y: 300, width: 400, height: 150, group: true },
	];
	it("catches cards by their middle and groups only when entirely inside", () => {
		expect([...caught(square, nodes, []).nodes].sort()).toEqual(["g-in", "in"]);
	});
	it("catches edges whose middle is inside or whose cards are both caught", () => {
		const edges = [
			{ id: "a", from: "in", fromSide: "right" as const, to: "out", toSide: "left" as const }, // middle x = 450: inside
			{ id: "b", from: "half", fromSide: "right" as const, to: "out", toSide: "left" as const },
		];
		expect([...caught(square, nodes, edges).edges]).toEqual(["a"]);
	});
});
