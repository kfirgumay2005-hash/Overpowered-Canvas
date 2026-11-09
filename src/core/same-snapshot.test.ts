import { describe, expect, it } from "vitest";
import { sameSnapshot } from "./history";

const node = (id: string, extra: object = {}) => ({ id, type: "text" as const, text: id, x: 0, y: 0, width: 10, height: 10, ...extra });

describe("sameSnapshot", () => {
	it("is true for the same board in new objects sharing values", () => {
		const opc = { v: 1, kind: "ink" };
		const a = { nodes: [node("a", { "x-opc": opc }), node("b")], edges: [{ id: "e", fromNode: "a", toNode: "b" }], "x-opc": { v: 1 } };
		const b = { nodes: [node("a", { "x-opc": opc }), node("b")], edges: [{ id: "e", fromNode: "a", toNode: "b" }], "x-opc": { v: 1 } };
		expect(sameSnapshot(a, b)).toBe(true);
	});
	it("sees a changed field, a replaced x-opc, a moved card, a new card or a reordered board", () => {
		const a = { nodes: [node("a", { "x-opc": { v: 1, border: "dashed" } }), node("b")], edges: [] };
		expect(sameSnapshot(a, { ...a, nodes: [node("a", { "x-opc": { v: 1, border: "dotted" } }), node("b")] })).toBe(false);
		expect(sameSnapshot(a, { ...a, nodes: [{ ...a.nodes[0]!, x: 5 }, node("b")] })).toBe(false);
		expect(sameSnapshot(a, { ...a, nodes: [...a.nodes, node("c")] })).toBe(false);
		expect(sameSnapshot(a, { ...a, nodes: [a.nodes[1]!, a.nodes[0]!] })).toBe(false);
		expect(sameSnapshot(a, { ...a, "x-opc": { v: 1, pages: [] } } as never)).toBe(false);
	});
	it("treats an absent field and an undefined one alike", () => {
		expect(sameSnapshot({ nodes: [node("a")], edges: [] }, { nodes: [{ ...node("a"), color: undefined }], edges: [] })).toBe(true);
	});
});
