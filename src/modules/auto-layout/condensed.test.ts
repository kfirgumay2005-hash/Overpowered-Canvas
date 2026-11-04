import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import type { TEdge, TNode } from "../mindmap/tree";
import { computeLayout, type ElkLike, type Positions } from "./layout";
import { connectorsClash } from "./radial";

const elk = new ELK() as unknown as ElkLike;
const opts = { spacing: 30, levelSpacing: 80 };

/** A tree of `count` cards, widths 120–320 and heights 40–140, branching unevenly (seeded). */
function tree(count: number, seed = 7): { nodes: TNode[]; edges: TEdge[] } {
	let s = seed;
	const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
	const nodes: TNode[] = [{ id: "r", x: 0, y: 0, width: 220, height: 80 }];
	const edges: TEdge[] = [];
	for (let i = 1; i < count; i++) {
		const parent = nodes[Math.floor(Math.pow(rnd(), 1.8) * Math.min(i, 40))]!.id;
		nodes.push({ id: `n${i}`, x: 0, y: i * 10, width: 120 + Math.round(rnd() * 200), height: 40 + Math.round(rnd() * 100) });
		edges.push({ from: parent, to: `n${i}` });
	}
	return { nodes, edges };
}

function overlaps(pos: Positions, all: TNode[]): number {
	const boxes = all.map((n) => ({ ...n, ...pos.get(n.id)! }));
	let n = 0;
	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++) {
			const a = boxes[i]!;
			const b = boxes[j]!;
			if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) n++;
		}
	return n;
}

const kidsOf = (edges: TEdge[]) => {
	const kids = new Map<string, string[]>();
	for (const e of edges) (kids.get(e.from) ?? kids.set(e.from, []).get(e.from)!).push(e.to);
	return kids;
};
const area = (pos: Positions, all: TNode[]) => {
	const xs = all.map((n) => pos.get(n.id)!.x);
	const ys = all.map((n) => pos.get(n.id)!.y);
	return (Math.max(...all.map((n) => pos.get(n.id)!.x + n.width)) - Math.min(...xs)) * (Math.max(...all.map((n) => pos.get(n.id)!.y + n.height)) - Math.min(...ys));
};

describe("condensed radial", () => {
	for (const count of [12, 60, 150]) {
		const { nodes, edges } = tree(count);
		it(`places ${count} cards without overlaps or crossing connectors`, async () => {
			const pos = await computeLayout(elk, nodes, edges, { algorithm: "mindmap", direction: "condensed", ...opts });
			expect(overlaps(pos, nodes)).toBe(0);
			expect(connectorsClash(pos, new Map(nodes.map((n) => [n.id, n])), kidsOf(edges), "r")).toBe(false);
		});
		it(`is more compact than the radial layout (${count} cards)`, async () => {
			const condensed = await computeLayout(elk, nodes, edges, { algorithm: "mindmap", direction: "condensed", ...opts });
			const radial = await computeLayout(elk, nodes, edges, { algorithm: "mindmap", direction: "radial", ...opts });
			expect(area(condensed, nodes)).toBeLessThan(area(radial, nodes) * 0.8);
		});
	}
	it("keeps the root in place and goes round in the map's order", async () => {
		const n = (id: string, x = 0, y = 0): TNode => ({ id, x, y, width: 120, height: 50 });
		const all = [n("r", 500, 500), n("a"), n("b"), n("c"), n("d")];
		const edges: TEdge[] = ["a", "b", "c", "d"].map((k) => ({ from: "r", to: k }));
		for (const rtl of [false, true]) {
			const pos = await computeLayout(elk, all, edges, { algorithm: "mindmap", direction: "condensed", ...opts, order: { r: ["c", "a", "d", "b"] }, rtl });
			expect(pos.get("r")).toEqual({ x: 500, y: 500 });
			const angle = (id: string) => {
				const p = pos.get(id)!;
				const dx = p.x - 500;
				return (Math.atan2(rtl ? -dx : dx, -(p.y - 500)) + 2 * Math.PI + 0.3) % (2 * Math.PI);
			};
			expect(["a", "b", "c", "d"].sort((p, q) => angle(p) - angle(q)).join("")).toBe("cadb");
		}
	});
	it("a second run changes nothing", async () => {
		const { nodes, edges } = tree(60, 3);
		const run = async (list: TNode[]) => {
			const pos = await computeLayout(elk, list, edges, { algorithm: "mindmap", direction: "condensed", ...opts });
			return list.map((node) => ({ ...node, ...pos.get(node.id)! }));
		};
		const once = await run(nodes);
		const twice = await run(once);
		expect(await run(twice)).toEqual(twice);
	});
});
