import { describe, expect, it } from "vitest";
import { DOT_SPACING, gridPattern, MIN_CELL_PX } from "./logic";

describe("grid pattern", () => {
	it("puts lines on multiples of the cell in canvas coordinates", () => {
		const p = gridPattern(5, { x: 0, y: 0, scale: 1, width: 800, height: 600 });
		expect(p.cell).toBe(5 * DOT_SPACING);
		// Canvas x = 0 sits at the view center.
		expect(p.x).toBe(400);
		expect(p.y).toBe(300);
		const shifted = gridPattern(5, { x: 30, y: -30, scale: 2, width: 800, height: 600 });
		expect(shifted.cell).toBe(200);
		expect(shifted.x).toBe(400 - 30 * 2);
		expect(shifted.y).toBe(300 - 70 * 2);
	});

	it("thins out lines that would be too dense", () => {
		const p = gridPattern(1, { x: 0, y: 0, scale: 0.1, width: 800, height: 600 });
		expect(p.cell).toBeGreaterThanOrEqual(MIN_CELL_PX);
	});
});
