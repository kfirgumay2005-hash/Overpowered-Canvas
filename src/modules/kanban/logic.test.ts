import { describe, expect, it } from "vitest";
import { columnAt, propertyMatches, slug, targetColumn, type Column } from "./logic";

const col = (id: string, x: number, value: string, key = "status"): Column => ({ id, box: { x, y: 0, width: 300, height: 600 }, key, value });
const cols = [col("todo", 0, "todo"), col("doing", 400, "doing"), col("done", 800, "Done")];

describe("kanban", () => {
	it("finds the column under a card", () => {
		expect(columnAt(cols, { x: 450, y: 100, width: 100, height: 50 })?.id).toBe("doing");
		expect(columnAt(cols, { x: 320, y: 100, width: 50, height: 50 })).toBeNull();
		const inner = { id: "inner", box: { x: 420, y: 20, width: 100, height: 100 }, key: "status", value: "x" };
		expect(columnAt([...cols, inner], { x: 440, y: 40, width: 40, height: 40 })?.id).toBe("inner");
	});

	it("matches property values loosely", () => {
		expect(propertyMatches("Done", "done")).toBe(true);
		expect(propertyMatches(["a", "doing"], "doing")).toBe(true);
		expect(propertyMatches(3, "3")).toBe(true);
		expect(propertyMatches(undefined, "todo")).toBe(false);
		expect(propertyMatches({ a: 1 }, "todo")).toBe(false);
	});

	it("decides where a card goes", () => {
		expect(targetColumn(cols, cols[0]!, "done")?.id).toBe("done");
		expect(targetColumn(cols, cols[0]!, "todo")).toBeNull();
		expect(targetColumn(cols, cols[0]!, "unknown")).toBeNull();
		expect(targetColumn(cols, cols[0]!, undefined)).toBeNull();
		// Columns of another property are not targets.
		expect(targetColumn([...cols, col("p", 1200, "high", "priority")], cols[0]!, "high")).toBeNull();
	});

	it("slugs labels", () => {
		expect(slug("To do")).toBe("to-do");
		expect(slug("  בעבודה! ")).toBe("בעבודה");
	});
});
