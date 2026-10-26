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

describe("radial layout", () => {
	const sized = (id: string, width: number, height: number, x = 0, y = 0): TNode => ({ id, x, y, width, height });

	it("never overlaps cards of mixed sizes, even in big trees", async () => {
		const all: TNode[] = [sized("root", 300, 120, 500, 500)];
		const tree: TEdge[] = [];
		let k = 0;
		const grow = (parent: string, depth: number) => {
			if (depth === 3) return;
			for (let i = 0; i < (depth === 0 ? 9 : 4); i++) {
				const id = `n${k++}`;
				all.push(sized(id, 80 + ((k * 37) % 320), 40 + ((k * 53) % 160)));
				tree.push({ from: parent, to: id });
				grow(id, depth + 1);
			}
		};
		grow("root", 0);
		const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction: "radial", spacing: 30, levelSpacing: 80 });
		expect(pos.size).toBe(all.length);
		expect(overlaps(pos, all)).toBe(false);
		expect(pos.get("root")).toEqual({ x: 500, y: 500 });
	});

	it("puts children on a ring around the root, in their current order", async () => {
		const all = [sized("r", 200, 80, 0, 0), sized("top", 120, 50, 40, -300), sized("right", 120, 50, 400, 10), sized("bottom", 120, 50, 40, 300), sized("left", 120, 50, -400, 10)];
		const tree = ["right", "left", "top", "bottom"].map((to) => ({ from: "r", to }));
		const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction: "radial", spacing: 30, levelSpacing: 80 });
		const c = (id: string) => ({ x: pos.get(id)!.x + 60, y: pos.get(id)!.y + 25 });
		expect(c("top").y).toBeLessThan(0);
		expect(c("bottom").y).toBeGreaterThan(80);
		expect(c("right").x).toBeGreaterThan(200);
		expect(c("left").x).toBeLessThan(0);
		expect(overlaps(pos, all)).toBe(false);
	});

	it("lays out several trees side by side without overlap", async () => {
		const all = [sized("a", 100, 40), sized("a1", 100, 40), sized("a2", 100, 40), sized("b", 100, 40), sized("b1", 300, 200)];
		const tree = [{ from: "a", to: "a1" }, { from: "a", to: "a2" }, { from: "b", to: "b1" }];
		const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction: "radial", spacing: 30, levelSpacing: 80 });
		expect(overlaps(pos, all)).toBe(false);
	});
});
