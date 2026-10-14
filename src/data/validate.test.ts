import { describe, expect, it } from "vitest";
import { EDGE_DEFAULTS, NODE_DEFAULTS } from "./schema";
import { applyPatch, EDGE_SHAPE, InvalidExtraDataError, isJsonSafe, NODE_SHAPE, readEdge, readNode, readRoot } from "./validate";

describe("readNode", () => {
	it("returns {} for missing or non-object data", () => {
		expect(readNode(undefined)).toEqual({});
		expect(readNode("x")).toEqual({});
		expect(readNode([1])).toEqual({});
	});

	it("keeps valid fields and drops invalid and unknown ones", () => {
		expect(
			readNode({ kind: "sticky", shape: "nope", border: "dashed", opacity: 2, locked: "yes", future: 1, rotation: 45 }),
		).toEqual({ kind: "sticky", border: "dashed", rotation: 45 });
	});

	it("validates nested line data", () => {
		expect(readNode({ line: { points: [[0, 0], [10, 5]], from: { node: "a" }, endArrow: "diamond" } }).line).toEqual({
			points: [[0, 0], [10, 5]],
			from: { node: "a" },
			endArrow: "diamond",
		});
		expect(readNode({ line: { points: [[0, 0]] } }).line).toBeUndefined();
		expect(readNode({ line: { points: [[0, 0], [1, Number.NaN]] } }).line).toBeUndefined();
	});

	it("validates crop rectangles", () => {
		expect(readNode({ crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }).crop).toEqual({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 });
		expect(readNode({ crop: { x: 0.6, y: 0, w: 0.5, h: 1 } }).crop).toBeUndefined();
		expect(readNode({ crop: { x: 0, y: 0, w: 0, h: 1 } }).crop).toBeUndefined();
	});

	it("validates strokes and drops broken ones", () => {
		const good = { id: "s1", tool: "pen", color: "#000", size: 4, pts: [0, 0, 0.5, 1, 1, 0.6] };
		const badPts = { ...good, id: "s2", pts: [0, 0] };
		const badTilt = { ...good, id: "s3", tilt: [1, 2, 3] };
		expect(readNode({ strokes: [good, badPts, badTilt] }).strokes).toEqual([good, { ...good, id: "s3" }]);
	});
});

describe("readEdge / readRoot", () => {
	it("reads edges", () => {
		expect(readEdge({ path: "dotted", arrows: { to: "circle", from: "bad" }, labelT: 0.3, waypoints: [[1, 2]] })).toEqual({
			path: "dotted",
			arrows: { to: "circle" },
			labelT: 0.3,
			waypoints: [[1, 2]],
		});
		expect(readEdge({ labelT: 1.5 })).toEqual({});
	});

	it("requires a version on the root", () => {
		expect(readRoot({ dir: "rtl" })).toBeUndefined();
		expect(readRoot({ v: 1, dir: "rtl" })).toEqual({ v: 1, dir: "rtl" });
		expect(readRoot({ v: 1.5 })).toBeUndefined();
	});

	it("keeps JSON-safe frontmatter only", () => {
		expect(readRoot({ v: 1, frontmatter: { tags: ["a"], n: 1 } })?.frontmatter).toEqual({ tags: ["a"], n: 1 });
		expect(readRoot({ v: 1, frontmatter: { bad: Number.POSITIVE_INFINITY } })?.frontmatter).toBeUndefined();
	});
});

describe("applyPatch", () => {
	it("adds, replaces and removes fields without mutating the input", () => {
		const existing = { border: "dashed", align: "center" };
		const frozen = Object.freeze({ ...existing });
		const next = applyPatch(frozen, { border: "dotted", align: undefined }, NODE_SHAPE, NODE_DEFAULTS);
		expect(next).toEqual({ border: "dotted" });
		expect(frozen).toEqual(existing);
	});

	it("drops values equal to the default", () => {
		expect(applyPatch({ border: "dashed" }, { border: "solid" }, NODE_SHAPE, NODE_DEFAULTS)).toBeUndefined();
		expect(applyPatch(undefined, { route: "bezier", path: "dotted" }, EDGE_SHAPE, EDGE_DEFAULTS)).toEqual({ path: "dotted" });
	});

	it("keeps fields it does not know (written by a newer version)", () => {
		expect(applyPatch({ futureField: [1, 2] }, { locked: true }, NODE_SHAPE)).toEqual({ futureField: [1, 2], locked: true });
	});

	it("throws on invalid values and unknown patch keys", () => {
		expect(() => applyPatch({}, { opacity: 3 }, NODE_SHAPE)).toThrow(InvalidExtraDataError);
		expect(() => applyPatch({}, { nope: 1 } as never, NODE_SHAPE)).toThrow(InvalidExtraDataError);
	});

	it("returns undefined when nothing is left", () => {
		expect(applyPatch({ locked: true }, { locked: undefined }, NODE_SHAPE)).toBeUndefined();
	});
});

describe("isJsonSafe", () => {
	it("accepts plain JSON", () => {
		expect(isJsonSafe({ a: [1, "b", null, { c: true }] })).toBe(true);
	});
	it("rejects non-JSON values", () => {
		expect(isJsonSafe(Number.NaN)).toBe(false);
		expect(isJsonSafe({ f: () => 1 })).toBe(false);
		expect(isJsonSafe(new Map())).toBe(false);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(isJsonSafe(cyclic)).toBe(false);
	});
	it("allows the same object twice when it is not a cycle", () => {
		const shared = { a: 1 };
		expect(isJsonSafe({ x: shared, y: shared })).toBe(true);
	});
});
