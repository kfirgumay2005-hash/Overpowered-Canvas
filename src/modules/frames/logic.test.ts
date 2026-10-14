import { describe, expect, it } from "vitest";
import { matches, move, orderFrames } from "./logic";

const f = (id: string, x: number, y: number, label = id) => ({ id, x, y, label });

describe("frames", () => {
	const frames = [f("c", 0, 600), f("b", 900, 10), f("a", 0, 0)];

	it("orders by reading order, mirrored in RTL", () => {
		expect(orderFrames(frames, undefined, false).map((x) => x.id)).toEqual(["a", "b", "c"]);
		expect(orderFrames(frames, undefined, true).map((x) => x.id)).toEqual(["b", "a", "c"]);
	});

	it("puts the stored order first and skips missing ids", () => {
		expect(orderFrames(frames, ["c", "gone", "b"], false).map((x) => x.id)).toEqual(["c", "b", "a"]);
	});

	it("moves items", () => {
		expect(move(["a", "b", "c"], 0, 3)).toEqual(["b", "c", "a"]);
		expect(move(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
		expect(move(["a", "b", "c"], 1, 2)).toEqual(["a", "b", "c"]);
	});

	it("filters by label", () => {
		expect(matches(f("x", 0, 0, "Sprint Plan"), "plan")).toBe(true);
		expect(matches(f("x", 0, 0, "תכנון"), "תכנ")).toBe(true);
		expect(matches(f("x", 0, 0, "Other"), "plan")).toBe(false);
	});
});
