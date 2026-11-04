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

describe("sibling order", () => {
	const at = (id: string, x: number, y: number): TNode => ({ id, x, y, width: 120, height: 50 });
	// Created a, b, c (edges in that order), then dragged on the board to read c, a, b.
	const board = [at("r", 0, 0), at("a", 300, 100), at("b", 300, 200), at("c", 300, -100)];
	const tree: TEdge[] = ["a", "b", "c"].map((to) => ({ from: "r", to }));
	const order = (pos: Positions, ids: string[], axis: "x" | "y") => [...ids].sort((p, q) => pos.get(p)![axis] - pos.get(q)![axis]);

	it("keeps the order the cards show on the board, run after run", async () => {
		for (const direction of ["right", "left"] as const) {
			let all = board;
			for (let run = 0; run < 3; run++) {
				const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction, ...opts });
				expect(order(pos, ["a", "b", "c"], "y")).toEqual(["c", "a", "b"]);
				expect(pos.get("r")).toEqual({ x: 0, y: 0 });
				all = all.map((n) => ({ ...n, ...pos.get(n.id)! }));
			}
		}
	});

	it("keeps left-to-right order in maps that grow down", async () => {
		const below = [at("r", 0, 0), at("a", 200, 200), at("b", 400, 200), at("c", -200, 200)];
		const pos = await computeLayout(elk, below, tree, { algorithm: "mindmap", direction: "down", ...opts });
		expect(order(pos, ["a", "b", "c"], "x")).toEqual(["c", "a", "b"]);
	});

	it("balanced keeps each child on its side, in order", async () => {
		const both = [at("r", 0, 0), at("a", 300, 100), at("b", -300, 0), at("c", 300, -100), at("d", -300, -200)];
		const four: TEdge[] = ["a", "b", "c", "d"].map((to) => ({ from: "r", to }));
		const pos = await computeLayout(elk, both, four, { algorithm: "mindmap", direction: "balanced", ...opts });
		expect(pos.get("a")!.x).toBeGreaterThan(0);
		expect(pos.get("c")!.x).toBeGreaterThan(0);
		expect(pos.get("b")!.x).toBeLessThan(0);
		expect(pos.get("d")!.x).toBeLessThan(0);
		expect(pos.get("c")!.y).toBeLessThan(pos.get("a")!.y);
		expect(pos.get("d")!.y).toBeLessThan(pos.get("b")!.y);
	});
});

describe("stored sibling order", () => {
	// Children stacked a, b, c, d on the board; the map's order says d, a, c, b.
	const kids = ["a", "b", "c", "d"].map((id, i) => n(id, 300, i * 80));
	const all = [n("r", 0, 120), ...kids];
	const tree: TEdge[] = kids.map((k) => ({ from: "r", to: k.id }));
	const order = { r: ["d", "a", "c", "b"] };
	const byAxis = (pos: Positions, axis: "x" | "y") => ["a", "b", "c", "d"].sort((p, q) => pos.get(p)![axis] - pos.get(q)![axis]).join("");
	for (const direction of ["right", "left"] as const)
		it(`wins over board positions (${direction})`, async () => {
			const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction, ...opts, order });
			expect(byAxis(pos, "y")).toBe("dacb");
		});
	for (const direction of ["down", "up"] as const)
		it(`wins over board positions (${direction})`, async () => {
			const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction, ...opts, order });
			expect(byAxis(pos, "x")).toBe("dacb");
		});
	for (const direction of ["down", "up"] as const)
		it(`reads right to left in right-to-left canvases (${direction})`, async () => {
			const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction, ...opts, order, rtl: true });
			expect(byAxis(pos, "x")).toBe("bcad");
		});
	it("goes counter-clockwise in right-to-left radial maps", async () => {
		const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction: "radial", ...opts, order, rtl: true });
		const r = pos.get("r")!;
		const angle = (id: string) => {
			const p = pos.get(id)!;
			return (Math.atan2(-(p.x + 60 - (r.x + 60)), -(p.y + 25 - (r.y + 25))) + 2 * Math.PI) % (2 * Math.PI);
		};
		expect(["a", "b", "c", "d"].sort((p, q) => angle(p) - angle(q)).join("")).toBe("dacb");
	});
	it("goes clockwise from the top in radial maps", async () => {
		const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction: "radial", ...opts, order });
		const r = pos.get("r")!;
		const angle = (id: string) => {
			const p = pos.get(id)!;
			return (Math.atan2(p.x + 60 - (r.x + 60), -(p.y + 25 - (r.y + 25))) + 2 * Math.PI) % (2 * Math.PI);
		};
		expect(["a", "b", "c", "d"].sort((p, q) => angle(p) - angle(q)).join("")).toBe("dacb");
	});
	it("balanced maps read clockwise: right side top to bottom, then left side bottom to top", async () => {
		const pos = await computeLayout(elk, all, tree, { algorithm: "mindmap", direction: "balanced", ...opts, order });
		const r = pos.get("r")!;
		const right = ["a", "b", "c", "d"].filter((id) => pos.get(id)!.x > r.x).sort((p, q) => pos.get(p)!.y - pos.get(q)!.y);
		const left = ["a", "b", "c", "d"].filter((id) => pos.get(id)!.x < r.x).sort((p, q) => pos.get(q)!.y - pos.get(p)!.y);
		expect([...right, ...left].join("")).toBe("dacb");
	});
});

describe("radial stability", () => {
	// A root with branches all around, each with a few children (one branch points straight up).
	const all: TNode[] = [n("r", 0, 0)];
	const tree: TEdge[] = [];
	for (let i = 0; i < 5; i++) {
		all.push(n(`b${i}`, 300 * Math.cos((i * 2 * Math.PI) / 5 - Math.PI / 2), 300 * Math.sin((i * 2 * Math.PI) / 5 - Math.PI / 2)));
		tree.push({ from: "r", to: `b${i}` });
		for (let j = 0; j < 3; j++) {
			all.push(n(`b${i}k${j}`, (j - 1) * 150, -600 + i * 10));
			tree.push({ from: `b${i}`, to: `b${i}k${j}` });
		}
	}
	for (const rtl of [false, true])
		it(`a second run changes nothing${rtl ? " (right to left)" : ""}`, async () => {
			const run = async (nodes: TNode[]) => {
				const pos = await computeLayout(elk, nodes, tree, { algorithm: "mindmap", direction: "radial", ...opts, rtl });
				return nodes.map((node) => ({ ...node, ...pos.get(node.id)! }));
			};
			const once = await run(all);
			const twice = await run(once);
			const thrice = await run(twice);
			expect(thrice).toEqual(twice);
		});
});
