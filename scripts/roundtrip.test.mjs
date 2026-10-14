import { describe, expect, it } from "vitest";
import { readEdge, readNode, readRoot } from "../src/data/validate";
import { checkCanvasFile } from "../src/data/validate-file";
import { ORIGINAL } from "./roundtrip.mjs";

describe("round-trip fixture", () => {
	it("uses only valid x-opc data", () => {
		for (const node of ORIGINAL.nodes) expect(readNode(node["x-opc"])).toEqual(node["x-opc"] ?? {});
		for (const edge of ORIGINAL.edges) expect(readEdge(edge["x-opc"])).toEqual(edge["x-opc"] ?? {});
		expect(readRoot(ORIGINAL["x-opc"])).toEqual(ORIGINAL["x-opc"]);
	});

	it("contains exactly the expected non-standard items", () => {
		const warnings = checkCanvasFile(ORIGINAL).map((p) => `${p.level}:${p.path}`);
		expect(warnings).toEqual(["warning:nodes[5].type"]);
	});
});
