import { describe, expect, it } from "vitest";
import { insertBend, midpoints, nearestOnPolyline } from "./logic";

describe("edge editing", () => {
	const path = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

	it("finds the nearest point and its position along the line", () => {
		const n = nearestOnPolyline(path, { x: 50, y: 10 });
		expect(n.point).toEqual({ x: 50, y: 0 });
		expect(n.segment).toBe(0);
		expect(n.t).toBeCloseTo(0.25);
		expect(nearestOnPolyline(path, { x: 120, y: 100 }).t).toBeCloseTo(1);
	});

	it("lists segment midpoints", () => {
		expect(midpoints(path)).toEqual([{ x: 50, y: 0 }, { x: 100, y: 50 }]);
	});

	it("inserts a bend keeping interior points", () => {
		expect(insertBend(path, 1, { x: 150, y: 50 })).toEqual([{ x: 100, y: 0 }, { x: 150, y: 50 }]);
		expect(insertBend([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0, { x: 5, y: 5 })).toEqual([{ x: 5, y: 5 }]);
	});
});
