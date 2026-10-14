import { describe, expect, it } from "vitest";
import { balance, childPosition, childrenOf, descendants, directionBetween, logical, neighbor, parentOf, roots, siblingPosition, type TEdge, type TNode } from "./tree";

const n = (id: string, x: number, y: number, w = 100, h = 50): TNode => ({ id, x, y, width: w, height: h });
const edges: TEdge[] = [
	{ from: "r", to: "a" },
	{ from: "r", to: "b" },
	{ from: "a", to: "c" },
	{ from: "c", to: "r" }, // cycle
];

describe("structure", () => {
	it("children, parent, descendants (cycle-safe)", () => {
		expect(childrenOf(edges, "r")).toEqual(["a", "b"]);
		expect(parentOf(edges, "c")).toBe("a");
		expect(parentOf(edges, "zz")).toBeNull();
		expect(descendants(edges, "r")).toEqual(["a", "b", "c"]);
	});
	it("roots", () => {
		expect(roots([n("r", 0, 0), n("a", 0, 0), n("x", 0, 0)], [{ from: "r", to: "a" }])).toEqual(["r", "x"]);
	});
	it("mirrors horizontal directions in RTL", () => {
		expect(logical("right", true)).toBe("left");
		expect(logical("down", true)).toBe("down");
		expect(logical("right", false)).toBe("right");
	});
});

describe("placement", () => {
	const parent = n("p", 0, 0, 200, 60);
	const size = { width: 100, height: 40 };
	it("first child is centered beside the parent", () => {
		expect(childPosition(parent, [], size, "right")).toEqual({ x: 280, y: 10 });
		expect(childPosition(parent, [], size, "left")).toEqual({ x: -180, y: 10 });
		expect(childPosition(parent, [], size, "down")).toEqual({ x: 50, y: 140 });
	});
	it("next children stack after existing ones on that side", () => {
		expect(childPosition(parent, [n("c1", 280, 10, 100, 40), n("other", -300, 500)], size, "right")).toEqual({ x: 280, y: 80 });
	});
	it("siblings go below (horizontal maps) or beside (vertical maps)", () => {
		expect(siblingPosition(n("s", 10, 20, 100, 40), "right", size)).toEqual({ x: 10, y: 90 });
		expect(siblingPosition(n("s", 10, 20, 100, 40), "down", size)).toEqual({ x: 140, y: 20 });
	});
	it("direction between nodes", () => {
		expect(directionBetween(n("a", 0, 0), n("b", 300, 10))).toBe("right");
		expect(directionBetween(n("a", 0, 0), n("b", 0, -300))).toBe("up");
	});
});

describe("navigation and balance", () => {
	it("finds the nearest aligned neighbor", () => {
		const from = n("f", 0, 0);
		const others = [n("r1", 300, 0), n("r2", 200, 180), n("u", 0, -200), n("far", 900, 0)];
		expect(neighbor(from, others, "right")).toBe("r1");
		expect(neighbor(from, others, "up")).toBe("u");
		expect(neighbor(from, others, "left")).toBeNull();
	});
	it("balances children by weight", () => {
		const [a, b] = balance([{ id: 1, w: 5 }, { id: 2, w: 1 }, { id: 3, w: 1 }, { id: 4, w: 3 }], (c) => c.w);
		expect(a.map((c) => c.id)).toEqual([1]);
		expect(b.map((c) => c.id)).toEqual([2, 3, 4]);
	});
});
