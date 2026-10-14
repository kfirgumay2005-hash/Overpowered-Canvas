import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import type { TEdge, TNode } from "../mindmap/tree";
import { computeLayout, interpolate, spanningTree, type ElkLike, type Positions } from "./layout";

const elk = new ELK() as unknown as ElkLike;
const n = (id: string, x = 0, y = 0): TNode => ({ id, x, y, width: 120, height: 50 });
const nodes = [n("r", 1000, 500), n("a"), n("b"), n("c"), n("d"), n("e")];
const edges: TEdge[] = [
	{ from: "r", to: "a" },
	{ from: "r", to: "b" },
	{ from: "r", to: "c" },
	{ from: "r", to: "d" },
	{ from: "a", to: "e" },
	{ from: "e", to: "r" }, // cycle, dropped by the spanning tree
];
const opts = { spacing: 30, levelSpacing: 80 };

function overlaps(pos: Positions, all: TNode[]): boolean {
	const boxes = all.map((node) => ({ ...node, ...pos.get(node.id)! }));
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]!;
			const b = boxes[j]!;
			if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) return true;
		}
	return false;
}

describe("spanningTree", () => {
	it("drops cycle edges", () => {
		expect(spanningTree(nodes, edges)).toHaveLength(5);
	});
});

describe("computeLayout", () => {
	it("mind map to the right keeps the root in place and puts children to its right", async () => {
		const pos = await computeLayout(elk, nodes, edges, { algorithm: "mindmap", direction: "right", ...opts });
		expect(pos.get("r")).toEqual({ x: 1000, y: 500 });
		for (const id of ["a", "b", "c", "d"]) expect(pos.get(id)!.x).toBeGreaterThan(1000 + 120);
		expect(pos.get("e")!.x).toBeGreaterThan(pos.get("a")!.x);
		expect(overlaps(pos, nodes)).toBe(false);
	});

	it("mind map to the left mirrors it", async () => {
		const pos = await computeLayout(elk, nodes, edges, { algorithm: "mindmap", direction: "left", ...opts });
		for (const id of ["a", "b", "c", "d"]) expect(pos.get(id)!.x).toBeLessThan(1000);
	});

	it("balanced splits children on both sides", async () => {
		const pos = await computeLayout(elk, nodes, edges, { algorithm: "mindmap", direction: "balanced", ...opts });
		const xs = ["a", "b", "c", "d"].map((id) => pos.get(id)!.x);
		expect(xs.some((x) => x > 1000)).toBe(true);
		expect(xs.some((x) => x < 1000)).toBe(true);
		expect(pos.get("r")).toEqual({ x: 1000, y: 500 });
		expect(overlaps(pos, nodes)).toBe(false);
	});

	it("down, radial, layered and grid produce non-overlapping layouts", async () => {
		for (const [algorithm, direction] of [["mindmap", "down"], ["mindmap", "radial"], ["layered", "right"], ["grid", "right"]] as const) {
			const pos = await computeLayout(elk, nodes, edges, { algorithm, direction, ...opts });
			expect(pos.size, `${algorithm}/${direction}`).toBe(nodes.length);
			expect(overlaps(pos, nodes), `${algorithm}/${direction}`).toBe(false);
		}
	});
});

describe("interpolate", () => {
	it("eases from start to end", () => {
		const a: Positions = new Map([["x", { x: 0, y: 0 }]]);
		const b: Positions = new Map([["x", { x: 100, y: 0 }]]);
		expect(interpolate(a, b, 0).get("x")).toEqual({ x: 0, y: 0 });
		expect(interpolate(a, b, 1).get("x")).toEqual({ x: 100, y: 0 });
		expect(interpolate(a, b, 0.5).get("x")!.x).toBeGreaterThan(50);
	});
});

describe("level spacing", () => {
	it("keeps levels exactly levelSpacing apart", async () => {
		const pos = await computeLayout(elk, nodes, edges, { algorithm: "mindmap", direction: "right", spacing: 30, levelSpacing: 100 });
		expect(pos.get("a")!.x - (pos.get("r")!.x + 120)).toBe(100);
		expect(pos.get("e")!.x - (pos.get("a")!.x + 120)).toBe(100);
		const left = await computeLayout(elk, nodes, edges, { algorithm: "mindmap", direction: "left", spacing: 30, levelSpacing: 100 });
		expect(left.get("r")!.x - (left.get("a")!.x + 120)).toBe(100);
	});
});
