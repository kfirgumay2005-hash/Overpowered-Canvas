import { describe, expect, it } from "vitest";
import { extractStyleBlocks, parseStyleAttributes, validateAttribute } from "./logic";

// The tests use JSON inside the comment blocks so they don't need Obsidian's YAML parser.
const css = `
.foo { color: red; }
/* @opc-node-style
{"key": "pattern", "label": "Pattern", "icon": "grid", "options": [
  {"label": "None", "value": null}, {"label": "Dots", "value": "dots", "icon": "circle-dot"}, {"label": "Lines", "value": "lines"}]}
*/
/* @opc-edge-style {"key": "weight", "options": [{"label": "Normal", "value": null}, {"label": "Bold", "value": "bold"}]} */
/* @opc-node-style {"key": "BAD KEY", "options": []} */
`;

describe("style attributes", () => {
	it("finds node and edge blocks", () => {
		expect(extractStyleBlocks(css).map((b) => b.target)).toEqual(["node", "edge", "node"]);
	});

	it("parses and validates", () => {
		const attrs = parseStyleAttributes([css], JSON.parse);
		expect(attrs).toEqual([
			{
				target: "node",
				key: "pattern",
				label: "Pattern",
				icon: "grid",
				options: [
					{ label: "None", value: null },
					{ label: "Dots", value: "dots", icon: "circle-dot" },
					{ label: "Lines", value: "lines" },
				],
			},
			{ target: "edge", key: "weight", label: "weight", options: [{ label: "Normal", value: null }, { label: "Bold", value: "bold" }] },
		]);
	});

	it("requires exactly one null option and safe keys/values", () => {
		expect(validateAttribute({ key: "a", options: [{ label: "x", value: "1" }] }, "node")).toBeNull();
		expect(validateAttribute({ key: "a", options: [{ value: null }, { value: null }] }, "node")).toBeNull();
		expect(validateAttribute({ key: "opc-mine", options: [{ value: null }] }, "node")).toBeNull();
		expect(validateAttribute({ key: "a", options: [{ value: null }, { value: "x y" }] }, "node")).toBeNull();
		expect(validateAttribute({ key: "a", options: [{ value: null }] }, "edge")).toEqual({ target: "edge", key: "a", label: "a", options: [{ label: "—", value: null }] });
	});

	it("skips blocks that fail to parse and lets later files win", () => {
		const later = `/* @opc-edge-style {"key": "weight", "label": "Weight", "options": [{"label": "N", "value": null}]} */`;
		const attrs = parseStyleAttributes(["/* @opc-node-style {broken */", css, later], JSON.parse);
		expect(attrs.find((a) => a.key === "weight")?.label).toBe("Weight");
	});
});
