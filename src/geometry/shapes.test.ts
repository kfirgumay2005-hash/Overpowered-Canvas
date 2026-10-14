import { describe, expect, it } from "vitest";
import { SHAPES } from "../data/schema";
import { pathNumbers, shapeGeometry } from "./shapes";

/** x/y pairs of M/L/C commands; arc flags make A commands noisy, so those are checked loosely. */
function coordinates(d: string): number[] {
	return pathNumbers(d.replace(/A[^A-Za-z]*/g, " "));
}

describe("shapeGeometry", () => {
	for (const shape of SHAPES) {
		it(`${shape}: closed outline inside the box at several sizes`, () => {
			for (const [w, h] of [[200, 100], [80, 240], [37, 37]] as const) {
				const g = shapeGeometry(shape, w, h);
				expect(g.d.length).toBeGreaterThan(10);
				expect(g.d.trim().endsWith("Z")).toBe(true);
				const nums = coordinates(g.d);
				for (const n of nums) {
					expect(n).toBeGreaterThanOrEqual(-0.01);
					expect(n).toBeLessThanOrEqual(Math.max(w, h) + 0.01);
				}
				const { top, right, bottom, left } = g.insets;
				for (const v of [top, right, bottom, left]) {
					expect(v).toBeGreaterThanOrEqual(0);
					expect(v).toBeLessThan(0.5);
				}
				expect(top + bottom).toBeLessThan(0.9);
				expect(left + right).toBeLessThan(0.9);
			}
		});
	}

	it("is deterministic and survives degenerate sizes", () => {
		expect(shapeGeometry("star", 100, 100)).toEqual(shapeGeometry("star", 100, 100));
		expect(() => shapeGeometry("cloud", 0, -5)).not.toThrow();
	});

	it("draws a diamond through the edge midpoints", () => {
		expect(shapeGeometry("decision", 100, 60).d).toBe("M50,0 L100,30 L50,60 L0,30 Z");
	});
});
