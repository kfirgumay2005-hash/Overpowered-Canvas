import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import type { TNode } from "../mindmap/tree";
import { collapseGroups, expandPositions, type BoxNode } from "./blocks";
import { computeLayout, type ElkLike } from "./layout";

const elk = new ELK() as unknown as ElkLike;
const node = (id: string, x: number, y: number, width = 100, height = 50, group = false): BoxNode => ({ id, x, y, width, height, group });

describe("groups as rigid blocks", () => {
	const all = [
		node("root", 0, 0),
		node("g", 300, -100, 400, 300, true),
		node("in1", 320, -80),
		node("in2", 500, 50),
		node("inner", 450, -90, 220, 120, true),
		node("leaf", 0, 400),
	];
	const edges = [
		{ from: "root", to: "in1" },
		{ from: "root", to: "leaf" },
		{ from: "in1", to: "in2" },
	];

	it("turns a group into one node and maps its edges", () => {
		const b = collapseGroups(all, new Set(["root", "in1", "in2", "leaf"]), new Set(["g", "inner"]), edges);
		expect(b.nodes.map((n) => n.id).sort()).toEqual(["g", "leaf", "root"]);
		expect(b.edges).toEqual([
			{ from: "root", to: "g" },
			{ from: "root", to: "leaf" },
		]);
		expect(b.members.get("g")!.sort()).toEqual(["in1", "in2", "inner"]);
	});

	it("moves members with their group and keeps their relative places, without overlaps", async () => {
		const b = collapseGroups(all, new Set(["root", "in1", "in2", "leaf"]), new Set(["g"]), edges);
		const laid = await computeLayout(elk, b.nodes, b.edges, { algorithm: "mindmap", direction: "right", spacing: 30, levelSpacing: 80 });
		const byId = new Map<string, TNode>(all.map((n) => [n.id, n]));
		const pos = expandPositions(b, laid, byId);
		const g = pos.get("g")!;
		for (const id of ["in1", "in2", "inner"]) {
			expect(pos.get(id)!.x - g.x).toBe(byId.get(id)!.x - 300);
			expect(pos.get(id)!.y - g.y).toBe(byId.get(id)!.y + 100);
		}
		const leaf = { ...pos.get("leaf")!, width: 100, height: 50 };
		const group = { ...g, width: 400, height: 300 };
		const apart = leaf.x >= group.x + group.width || group.x >= leaf.x + leaf.width || leaf.y >= group.y + group.height || group.y >= leaf.y + leaf.height;
		expect(apart).toBe(true);
	});

	it("a card inside a group pulls its whole group into the layout", () => {
		const b = collapseGroups(all, new Set(["root", "in1"]), new Set(), edges);
		expect(b.nodes.map((n) => n.id).sort()).toEqual(["g", "root"]);
	});
});
