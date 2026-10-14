import { describe, expect, it } from "vitest";
import { centeredRect, clampRect, croppedRatio, dragRect, FULL, isFull } from "./crop";

describe("image crop", () => {
	it("clamps into the image", () => {
		expect(clampRect({ x: 0.9, y: -0.2, w: 0.5, h: 2 })).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
		expect(isFull(FULL)).toBe(true);
	});

	it("computes the cropped pixel ratio", () => {
		expect(croppedRatio(2, { x: 0, y: 0, w: 0.5, h: 1 })).toBe(1);
	});

	it("drags corners and edges", () => {
		const r = dragRect(FULL, "se", -0.5, -0.25);
		expect(r).toEqual({ x: 0, y: 0, w: 0.5, h: 0.75 });
		const l = dragRect(FULL, "w", 0.2, 0);
		expect(l.x).toBeCloseTo(0.2);
		expect(l.w).toBeCloseTo(0.8);
		expect(dragRect({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, "move", 0.5, 0)).toEqual({ x: 0.5, y: 0.2, w: 0.5, h: 0.5 });
	});

	it("keeps a locked ratio on corner drags", () => {
		// 2:1 image, square crop.
		const r = dragRect({ x: 0, y: 0, w: 0.5, h: 1 }, "se", -0.25, 0, { ratio: 1, natural: 2 });
		expect(croppedRatio(2, r)).toBeCloseTo(1);
		expect(centeredRect(1, 2)).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
	});
});
