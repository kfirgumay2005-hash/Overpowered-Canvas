import { describe, expect, it } from "vitest";
import { checkCanvasFile, hasErrors, stripInvalidExtra } from "./validate-file";

const node = (id: string, extra: Record<string, unknown> = {}) => ({ id, type: "text", text: "", x: 0, y: 0, width: 10, height: 10, ...extra });

describe("checkCanvasFile", () => {
	it("accepts a valid file", () => {
		const file = {
			nodes: [node("a"), node("b", { "x-opc": { kind: "sticky" } })],
			edges: [{ id: "e", fromNode: "a", toNode: "b" }],
			"x-opc": { v: 1 },
		};
		expect(checkCanvasFile(file)).toEqual([]);
	});

	it("accepts an empty object", () => {
		expect(checkCanvasFile({})).toEqual([]);
	});

	it("reports structural errors", () => {
		const problems = checkCanvasFile({ nodes: [node("a"), node("a"), { ...node("c"), x: Number.NaN }] });
		expect(hasErrors(problems)).toBe(true);
		expect(problems.map((p) => p.path)).toEqual(["nodes[1].id", "nodes[2].x"]);
	});

	it("warns (but does not fail) on non-standard node types and dangling edges", () => {
		const problems = checkCanvasFile({ nodes: [node("a", { type: "custom" })], edges: [{ id: "e", fromNode: "a", toNode: "zzz" }] });
		expect(hasErrors(problems)).toBe(false);
		expect(problems.map((p) => p.level)).toEqual(["warning", "warning"]);
	});

	it("rejects extra data that cannot be serialized", () => {
		const problems = checkCanvasFile({ nodes: [node("a", { "x-opc": { bad: Number.POSITIVE_INFINITY } })], "x-opc": "nope" });
		expect(problems.filter((p) => p.level === "error").map((p) => p.path)).toEqual(["nodes[0].x-opc", "x-opc"]);
	});

	it("rejects non-object files", () => {
		expect(hasErrors(checkCanvasFile(null))).toBe(true);
		expect(hasErrors(checkCanvasFile([]))).toBe(true);
	});
});

describe("stripInvalidExtra", () => {
	it("removes only the broken extra data", () => {
		const file = {
			nodes: [node("a", { "x-opc": { bad: Number.NaN } }), node("b", { "x-opc": { kind: "sticky" } })],
			edges: [{ id: "e", fromNode: "a", toNode: "b", "x-opc": "nope" }],
			"x-opc": { v: 1 },
		};
		const out = stripInvalidExtra(file, checkCanvasFile(file));
		expect(out.nodes?.[0]).not.toHaveProperty("x-opc");
		expect(out.nodes?.[1]?.["x-opc"]).toEqual({ kind: "sticky" });
		expect(out.edges?.[0]).not.toHaveProperty("x-opc");
		expect(out["x-opc"]).toEqual({ v: 1 });
		expect(file.nodes[0]).toHaveProperty("x-opc"); // input untouched
	});

	it("returns the same object when all is well", () => {
		const file = { nodes: [node("a")] };
		expect(stripInvalidExtra(file, checkCanvasFile(file))).toBe(file);
	});
});
