import { describe, expect, it } from "vitest";
import type { InkPoint } from "../../geometry/ink";
import { addPoint } from "./index";

const pt = (x: number, y = 0): InkPoint => ({ x, y, p: 0.5 });

describe("pen samples", () => {
	it("merges samples under the threshold, ending under the pen", () => {
		const points = [pt(0)];
		for (let i = 1; i <= 40; i++) addPoint(points, pt(i * 0.1), 1);
		// 4 px in 0.1 px steps with a 1 px threshold: about one point per pixel, the last exactly at 4.
		expect(points.length).toBeGreaterThanOrEqual(4);
		expect(points.length).toBeLessThanOrEqual(6);
		expect(points[points.length - 1]!.x).toBeCloseTo(4);
		// Kept points are a threshold apart, less one sample step at most.
		for (let i = 1; i < points.length - 1; i++) expect(points[i]!.x - points[i - 1]!.x).toBeGreaterThanOrEqual(0.9 - 1e-9);
	});
	it("keeps the shape of a slow curve (no long straight jumps)", () => {
		const points = [pt(20, 0)];
		for (let i = 1; i <= 400; i++) addPoint(points, pt(Math.cos(i / 40) * 20, Math.sin(i / 40) * 20), 1);
		// Fewer points than samples, none of them far apart.
		expect(points.length).toBeLessThan(401);
		for (let i = 1; i < points.length; i++) expect(Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y)).toBeLessThan(1.6);
	});
	it("adds every sample that is far enough, and keeps the first one", () => {
		const points = [pt(0)];
		for (let i = 1; i <= 5; i++) addPoint(points, pt(i * 3), 1);
		expect(points.map((p) => p.x)).toEqual([0, 3, 6, 9, 12, 15]);
	});
});
