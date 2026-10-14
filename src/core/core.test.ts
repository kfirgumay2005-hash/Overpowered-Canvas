import { describe, expect, it } from "vitest";
import { sortByDependencies } from "./dependencies";
import { findOverlaps } from "./overlaps";

describe("sortByDependencies", () => {
	it("puts dependencies first and keeps the rest in order", () => {
		const order = sortByDependencies([
			{ id: "mindmap", dependsOn: ["layout"] },
			{ id: "nodes" },
			{ id: "layout", dependsOn: ["nodes"] },
		]).map((m) => m.id);
		expect(order).toEqual(["nodes", "layout", "mindmap"]);
	});

	it("throws on unknown dependencies", () => {
		expect(() => sortByDependencies([{ id: "a", dependsOn: ["ghost"] }])).toThrow(/unknown module "ghost"/);
	});

	it("throws on cycles", () => {
		expect(() =>
			sortByDependencies([
				{ id: "a", dependsOn: ["b"] },
				{ id: "b", dependsOn: ["a"] },
			]),
		).toThrow(/cycle/);
	});
});

describe("findOverlaps", () => {
	const modules = [
		{ id: "shapes", overlapsWith: ["advanced-canvas" as const] },
		{ id: "mindmap-keys", overlapsWith: ["canvas-mindmap" as const] },
		{ id: "presentation", overlapsWith: ["advanced-canvas" as const] },
		{ id: "minimap" },
	];

	it("lists our active overlapping modules per enabled plugin", () => {
		expect(findOverlaps(new Set(["advanced-canvas", "other"]), modules, new Set(["shapes", "presentation", "minimap"]), [])).toEqual([
			{ plugin: "advanced-canvas", modules: ["shapes", "presentation"] },
		]);
	});

	it("skips acknowledged plugins and plugins with no active overlap", () => {
		const enabled = new Set(["advanced-canvas", "canvas-mindmap"]);
		expect(findOverlaps(enabled, modules, new Set(["shapes"]), ["advanced-canvas"])).toEqual([]);
		expect(findOverlaps(enabled, modules, new Set(["minimap"]), [])).toEqual([]);
	});
});
