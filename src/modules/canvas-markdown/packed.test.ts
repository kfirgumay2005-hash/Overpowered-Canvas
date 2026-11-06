import { describe, expect, it } from "vitest";
import { packedSection } from "./packed";

describe("packedSection", () => {
	it("puts each plain line of a packed block in a paragraph of its own", () => {
		const lines = ["Esami ematici", "- Emocromo", "- EGA", "Esami delle urine", "- Urinocultura", "Prelievi bioptici", "Altro"];
		expect(packedSection(lines)).toBe("Esami ematici\n- Emocromo\n- EGA\n\nEsami delle urine\n- Urinocultura\n\nPrelievi bioptici\n\nAltro");
	});
	it("leaves a block alone when nothing would be merged", () => {
		expect(packedSection(["Only line", "- child", "\t- grandchild"])).toBeNull();
		expect(packedSection(["- a", "- b"])).toBeNull();
	});
	it("keeps indented continuation lines inside their bullet", () => {
		expect(packedSection(["A", "- b", "  more of b", "C"])).toBe("A\n- b\n  more of b\n\nC");
	});
	it("leaves code and comment blocks as they are", () => {
		expect(packedSection(["A", "```", "x", "```", "B"])).toBeNull();
		expect(packedSection(["%%", "## canvas-data", "%%"])).toBeNull();
	});
});
