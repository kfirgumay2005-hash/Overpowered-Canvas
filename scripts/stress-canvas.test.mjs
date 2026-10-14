import { describe, expect, it } from "vitest";
import { checkCanvasFile, hasErrors } from "../src/data/validate-file";
import { readEdge, readNode } from "../src/data/validate";
import { generateStressCanvas } from "./stress-canvas.mjs";

describe("generateStressCanvas", () => {
	const canvas = generateStressCanvas();

	it("meets the stress-test targets", () => {
		const strokes = canvas.nodes.reduce((sum, n) => sum + (n["x-opc"]?.strokes?.length ?? 0), 0);
		expect(canvas.nodes.filter((n) => n.type === "text" && n["x-opc"]?.kind !== "ink").length).toBe(1000);
		expect(strokes).toBe(2000);
		expect(canvas.edges.length).toBeGreaterThan(1400);
	});

	it("is a valid canvas with only standard node types", () => {
		const problems = checkCanvasFile(canvas);
		expect(hasErrors(problems)).toBe(false);
		expect(problems).toEqual([]);
	});

	it("only uses valid x-opc data", () => {
		for (const node of canvas.nodes) if (node["x-opc"]) expect(readNode(node["x-opc"])).toEqual(node["x-opc"]);
		for (const edge of canvas.edges) if (edge["x-opc"]) expect(readEdge(edge["x-opc"])).toEqual(edge["x-opc"]);
	});

	it("is deterministic", () => {
		expect(generateStressCanvas({ nodes: 50, strokes: 40, edges: 60, groups: 4 })).toEqual(
			generateStressCanvas({ nodes: 50, strokes: 40, edges: 60, groups: 4 }),
		);
	});
});

describe("formatCanvasJson", () => {
	it("round-trips through JSON.parse", async () => {
		const { formatCanvasJson } = await import("./format-canvas.mjs");
		const canvas = generateStressCanvas({ nodes: 30, strokes: 20, edges: 40, groups: 2 });
		expect(JSON.parse(formatCanvasJson(canvas))).toEqual(canvas);
	});
});
