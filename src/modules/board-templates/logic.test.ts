import { describe, expect, it } from "vitest";
import { checkCanvasFile, hasErrors } from "../../data/validate-file";
import { BUILTIN_IDS, builtinTemplate } from "./builtins";
import { bounds, extract, instantiate, mirror, normalize, reid, uniqueName } from "./logic";

const data = {
	nodes: [
		{ id: "a", type: "text", text: "A", x: 100, y: 50, width: 100, height: 50 },
		{ id: "b", type: "text", text: "B", x: 400, y: 50, width: 100, height: 50 },
		{ id: "l", type: "text", text: "", x: 200, y: 50, width: 200, height: 40, "x-opc": { kind: "line", line: { points: [[0, 20], [200, 20]], from: { node: "a" }, to: { node: "b" } } } },
		{ id: "c", type: "text", text: "C", x: 900, y: 900, width: 100, height: 50 },
	],
	edges: [
		{ id: "e1", fromNode: "a", fromSide: "right" as const, toNode: "b", toSide: "left" as const, "x-opc": { waypoints: [[300, 0]] } },
		{ id: "e2", fromNode: "b", toNode: "c" },
	],
	"x-opc": { v: 1, frameOrder: ["a"] },
};

describe("board templates", () => {
	it("extracts a selection with its inner edges", () => {
		const sel = extract(data, new Set(["a", "b"]));
		expect(sel.nodes.map((n) => n.id)).toEqual(["a", "b"]);
		expect(sel.edges.map((e) => e.id)).toEqual(["e1"]);
	});

	it("normalizes to the origin, moving waypoints too", () => {
		const n = normalize(extract(data, new Set(["a", "b"])));
		expect(bounds(n)).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 50 });
		expect((n.edges[0]!["x-opc"] as { waypoints: number[][] }).waypoints).toEqual([[200, -50]]);
	});

	it("gives fresh ids and remaps references", () => {
		let i = 0;
		const r = reid(data, () => `n${i++}`);
		const ids = new Set(r.nodes.map((n) => n.id));
		expect(ids.has("a")).toBe(false);
		const line = r.nodes.find((n) => (n["x-opc"] as { kind?: string } | undefined)?.kind === "line")!["x-opc"] as { line: { from: { node: string }; to: { node: string } } };
		expect(ids.has(line.line.from.node) && ids.has(line.line.to.node)).toBe(true);
		for (const e of r.edges) expect(ids.has(e.fromNode) && ids.has(e.toNode)).toBe(true);
		expect(ids.has((r["x-opc"] as { frameOrder: string[] }).frameOrder[0]!)).toBe(true);
		// The input is not modified.
		expect(data.nodes[0]!.id).toBe("a");
	});

	it("mirrors for RTL", () => {
		const m = mirror(extract(data, new Set(["a", "b", "l"])));
		expect(m.nodes.find((n) => n.id === "a")!.x).toBe(-200);
		expect(m.edges[0]!.fromSide).toBe("left");
		const line = m.nodes.find((n) => n.id === "l")!["x-opc"] as { line: { points: number[][] } };
		expect(line.line.points).toEqual([[200, 20], [0, 20]]);
	});

	it("instantiates at a position", () => {
		const out = instantiate(extract(data, new Set(["a", "b"])), { x: 1000, y: 1000 }, () => Math.random().toString(36).slice(2));
		expect(bounds(out)).toEqual({ minX: 1000, minY: 1000, maxX: 1400, maxY: 1050 });
	});

	it("builds valid built-in templates", () => {
		const t = ((k: string) => k) as never;
		for (const id of BUILTIN_IDS) {
			const tpl = builtinTemplate(id, t, false);
			expect(hasErrors(checkCanvasFile(tpl)), id).toBe(false);
			expect(tpl.nodes!.length).toBeGreaterThan(0);
			const ids = new Set(tpl.nodes!.map((n) => n.id));
			expect(ids.size).toBe(tpl.nodes!.length);
			for (const e of tpl.edges ?? []) expect(ids.has(e.fromNode) && ids.has(e.toNode), id).toBe(true);
		}
	});

	it("finds a unique name", () => {
		const taken = new Set(["Board", "Board 2"]);
		expect(uniqueName("Board", (n) => taken.has(n))).toBe("Board 3");
		expect(uniqueName("New", (n) => taken.has(n))).toBe("New");
	});
});
