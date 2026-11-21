import { describe, expect, it } from "vitest";
import { moveStep, presentedVisibility, resolveSequence, shownAt, slideSteps } from "./layer-steps";

const layers = [
	{ id: "bg", name: "Background" },
	{ id: "a", name: "A" },
	{ id: "b", name: "B", hidden: true },
	{ id: "c", name: "C" },
];

describe("resolveSequence", () => {
	it("plays every shown layer bottom to top when no steps are stored", () => {
		const r = resolveSequence(undefined, layers);
		expect(r.implicit).toBe(true);
		expect(r.steps.map((s) => s.layers[0])).toEqual(["bg", "a", "c"]);
		expect(r.steps.every((s) => s.reveal === "accumulate" && s.camera === "canvas")).toBe(true);
	});

	it("plays nothing when the step list was emptied", () => {
		const r = resolveSequence({ steps: [] }, layers);
		expect(r.implicit).toBe(false);
		expect(r.steps).toEqual([]);
	});

	it("leaves base layers out of the default steps", () => {
		const r = resolveSequence({ base: ["bg"] }, layers);
		expect(r.steps.map((s) => s.layers[0])).toEqual(["a", "c"]);
		expect(r.base).toEqual(["bg"]);
	});

	it("keeps the stored order, drops missing, repeated and base layers", () => {
		const r = resolveSequence({ steps: [{ layer: "c" }, { layer: "gone" }, { layer: "a", reveal: "replace", camera: "layer" }, { layer: "c" }, { layer: "bg" }], base: ["bg", "gone"], camera: "keep" }, layers);
		expect(r.implicit).toBe(false);
		expect(r.base).toEqual(["bg"]);
		expect(r.steps).toEqual([
			{ layers: ["c"], reveal: "accumulate", camera: "keep" },
			{ layers: ["a"], reveal: "replace", camera: "layer" },
		]);
	});
});

describe("shownAt", () => {
	const steps = [
		{ layers: ["a"], reveal: "accumulate" as const },
		{ layers: ["b"], reveal: "accumulate" as const },
		{ layers: ["c"], reveal: "replace" as const },
		{ layers: ["a"], reveal: "accumulate" as const },
	];
	it("builds up and replaces", () => {
		expect([...shownAt(steps, 0)]).toEqual(["a"]);
		expect([...shownAt(steps, 1)].sort()).toEqual(["a", "b"]);
		expect([...shownAt(steps, 2)]).toEqual(["c"]);
		expect([...shownAt(steps, 3)].sort()).toEqual(["a", "c"]);
	});
	it("going back gives exactly the earlier state", () => {
		const forward = [0, 1, 2, 3].map((i) => [...shownAt(steps, i)].sort().join());
		const back = [3, 2, 1, 0].map((i) => [...shownAt(steps, i)].sort().join());
		expect(back).toEqual([...forward].reverse());
	});
	it("shows nothing before the first step", () => {
		expect(shownAt(steps, -1).size).toBe(0);
	});
});

describe("presentedVisibility", () => {
	it("shows base and revealed layers, hides the other managed ones, keeps the rest", () => {
		const v = presentedVisibility(layers, new Set(["a", "b"]), new Set(["b"]), new Set(["bg"]));
		expect(Object.fromEntries(v)).toEqual({ bg: false, a: true, b: false, c: false });
	});
	it("keeps a hidden layer that is not managed hidden", () => {
		const v = presentedVisibility(layers, new Set(["a"]), new Set(["a"]), new Set());
		expect(v.get("b")).toBe(true);
	});
});

describe("slideSteps", () => {
	it("turns the stops that reveal layers into steps", () => {
		const reveals: Record<string, string[]> = { s2: ["a"], s4: ["b", "c"] };
		const steps = slideSteps(["s1", "s2", "s3", "s4"], (id) => reveals[id], "replace");
		expect(steps.map((s) => s.layers)).toEqual([["a"], ["b", "c"]]);
		expect([...shownAt(steps, steps.length - 1)].sort()).toEqual(["b", "c"]);
	});
});

describe("moveStep", () => {
	it("moves an item", () => {
		expect(moveStep(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
		expect(moveStep(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
		expect(moveStep(["a", "b", "c"], 5, 0)).toEqual(["a", "b", "c"]);
	});
});
