import { describe, expect, it } from "vitest";
import type { TEdge, TNode } from "../mindmap/tree";
import { largestRoot, walkStep } from "./walk";

const box = (id: string, x: number, y: number): TNode => ({ id, x, y, width: 100, height: 40 });
const map = (...n: TNode[]) => new Map(n.map((b) => [b.id, b]));

// r ─┬─ a ── a1
//    ├─ b
//    └─ c        and a lone card z
const nodes = map(box("r", 0, 100), box("a", 200, 0), box("b", 200, 100), box("c", 200, 200), box("a1", 400, 0), box("z", 0, 600));
const edges: TEdge[] = [
	{ from: "r", to: "b" },
	{ from: "r", to: "a" },
	{ from: "r", to: "c" },
	{ from: "a", to: "a1" },
];
const none = new Map<string, string>();

describe("walking a map", () => {
	it("goes to the first child, back to the parent and along the siblings", () => {
		expect(walkStep(nodes, edges, "r", "right", none)).toBe("a");
		expect(walkStep(nodes, edges, "a", "right", none)).toBe("a1");
		expect(walkStep(nodes, edges, "a1", "left", none)).toBe("a");
		expect(walkStep(nodes, edges, "a", "left", none)).toBe("r");
		expect(walkStep(nodes, edges, "a", "down", none)).toBe("b");
		expect(walkStep(nodes, edges, "b", "down", none)).toBe("c");
		expect(walkStep(nodes, edges, "b", "up", none)).toBe("a");
	});
	it("stops at the ends", () => {
		expect(walkStep(nodes, edges, "c", "down", none)).toBeNull();
		expect(walkStep(nodes, edges, "a", "up", none)).toBeNull();
		expect(walkStep(nodes, edges, "a1", "right", none)).toBeNull();
		expect(walkStep(nodes, edges, "r", "left", none)).toBeNull();
		expect(walkStep(nodes, edges, "r", "down", none)).toBeNull();
	});
	it("returns to the child visited last", () => {
		expect(walkStep(nodes, edges, "r", "right", new Map([["r", "c"]]))).toBe("c");
	});
	it("follows maps that grow to the left or downwards", () => {
		const rtl = map(box("r", 400, 100), box("a", 200, 0), box("b", 200, 100));
		const e = [
			{ from: "r", to: "a" },
			{ from: "r", to: "b" },
		];
		expect(walkStep(rtl, e, "r", "left", none)).toBe("a");
		expect(walkStep(rtl, e, "a", "right", none)).toBe("r");
		expect(walkStep(rtl, e, "a", "down", none)).toBe("b");
		const down = map(box("r", 100, 0), box("a", 0, 200), box("b", 200, 200));
		expect(walkStep(down, e, "r", "down", none)).toBe("a");
		expect(walkStep(down, e, "a", "right", none)).toBe("b");
		expect(walkStep(down, e, "b", "up", none)).toBe("r");
	});
	it("keeps the two sides of a balanced map apart", () => {
		const both = map(box("r", 200, 100), box("a", 400, 100), box("b", 0, 100));
		const e = [
			{ from: "r", to: "a" },
			{ from: "r", to: "b" },
		];
		expect(walkStep(both, e, "r", "right", none)).toBe("a");
		expect(walkStep(both, e, "r", "left", none)).toBe("b");
		expect(walkStep(both, e, "a", "down", none)).toBeNull();
	});
	it("starts at the root of the biggest map", () => {
		expect(largestRoot(nodes, edges)).toBe("r");
	});
});
