import { describe, expect, it } from "vitest";
import { angleOf, handleSize, normalizeAngle, projectOnLine, withAngle } from "./geometry";

describe("infinite line geometry", () => {
	it("normalizes angles to [0, 180)", () => {
		expect(normalizeAngle(0)).toBe(0);
		expect(normalizeAngle(180)).toBe(0);
		expect(normalizeAngle(-45)).toBe(135);
		expect(normalizeAngle(405)).toBe(45);
		expect(normalizeAngle(179.99999)).toBe(0);
		expect(normalizeAngle(Number.NaN)).toBe(0);
	});

	it("reads old horizontal / vertical lines", () => {
		expect(angleOf({ axis: "h", width: 2 })).toBe(0);
		expect(angleOf({ axis: "v", width: 2 })).toBe(90);
		expect(angleOf({ axis: "h", angle: 30, width: 2 })).toBe(30);
	});

	it("stores 0 and 90 the old way, other angles with the nearest axis", () => {
		expect(withAngle({ axis: "h", angle: 30, width: 2 }, 90)).toEqual({ axis: "v", width: 2 });
		expect(withAngle({ axis: "v", width: 2 }, 180)).toEqual({ axis: "h", width: 2 });
		expect(withAngle({ axis: "h", width: 2 }, 30)).toEqual({ axis: "h", angle: 30, width: 2 });
		expect(withAngle({ axis: "h", width: 2 }, 100)).toEqual({ axis: "v", angle: 100, width: 2 });
	});

	it("uses a square handle for slanted lines", () => {
		expect(handleSize(0).width).toBeGreaterThan(handleSize(0).height);
		expect(handleSize(90).height).toBeGreaterThan(handleSize(90).width);
		expect(handleSize(45).width).toBe(handleSize(45).height);
	});

	it("projects a point onto the line", () => {
		expect(projectOnLine({ x: 0, y: 0 }, 0, { x: 50, y: 30 })).toEqual({ x: 50, y: 0 });
		const p = projectOnLine({ x: 0, y: 0 }, 45, { x: 10, y: 0 });
		expect(p.x).toBeCloseTo(5);
		expect(p.y).toBeCloseTo(5);
	});
});
