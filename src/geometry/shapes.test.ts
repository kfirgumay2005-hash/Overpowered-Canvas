import { describe, expect, it } from "vitest";
import { SHAPES } from "../data/schema";
import { pathNumbers, shapeGeometry, shapeMinSize, sizeForTextRoom, textRoom } from "./shapes";

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

describe("shapeMinSize", () => {
	it("gives a diamond room for its text and keeps other shapes at the card size", () => {
		expect(shapeMinSize("decision", { width: 120, height: 40 })).toEqual({ width: 240, height: 120 });
		expect(shapeMinSize("decision", { width: 250, height: 60 })).toEqual({ width: 320, height: 180 });
		expect(shapeMinSize("process", { width: 120, height: 40 })).toEqual({ width: 120, height: 40 });
	});
});

describe("sizeForTextRoom", () => {
	it("is the plain size without a shape", () => {
		expect(textRoom(null, 200, 80)).toEqual({ x: 200, y: 80 });
		expect(sizeForTextRoom(null, "x", 80, 150, 1, 2400)).toBe(150);
	});

	it("solves a parallelogram's width in one step, whose slant changes with the width", () => {
		// A short, tall card: guessing from the current share swung wider and narrower each step.
		const height = 120;
		for (const room of [40, 60, 150, 400]) {
			const w = sizeForTextRoom("parallelogram", "x", height, room, 1, 2400);
			expect(textRoom("parallelogram", w, height).x).toBeGreaterThanOrEqual(room);
			expect(textRoom("parallelogram", w - 1, height).x).toBeLessThan(room);
			// Asking again at the solved size for the same text gives the same width.
			const shortfall = room - textRoom("parallelogram", w, height).x;
			expect(sizeForTextRoom("parallelogram", "x", height, textRoom("parallelogram", w, height).x + shortfall, 1, 2400)).toBe(w);
		}
	});

	it("stays within its bounds", () => {
		expect(sizeForTextRoom("decision", "x", 100, 10, 50, 2400)).toBe(50);
		expect(sizeForTextRoom("decision", "x", 100, 99999, 50, 2400)).toBe(2400);
	});
});
