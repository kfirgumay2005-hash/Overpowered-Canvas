import { describe, expect, it } from "vitest";
import { cssColor, fitTransform, toMap, toWorld, unionBox } from "./logic";

describe("minimap", () => {
	it("unions boxes", () => {
		expect(unionBox([{ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: -5, minY: 2, maxX: 3, maxY: 20 }])).toEqual({ minX: -5, minY: 0, maxX: 10, maxY: 20 });
		expect(unionBox([])).toBeNull();
	});

	it("fits the world and round-trips points", () => {
		const t = fitTransform({ minX: 0, minY: 0, maxX: 1000, maxY: 500 }, 220, 150, 10);
		expect(t.scale).toBeCloseTo(0.2);
		const p = toMap(t, 1000, 500);
		expect(p.x).toBeCloseTo(210);
		const w = toWorld(t, p.x, p.y);
		expect(w.x).toBeCloseTo(1000);
		expect(w.y).toBeCloseTo(500);
		// Centered vertically: 500 * 0.2 = 100 tall in a 150 map.
		expect(toMap(t, 0, 0).y).toBeCloseTo(25);
	});

	it("resolves canvas colors", () => {
		expect(cssColor("1", { "1": "233, 49, 71" })).toBe("rgb(233, 49, 71)");
		expect(cssColor("2", { "2": "#ff8800" })).toBe("#ff8800");
		expect(cssColor("#123456", {})).toBe("#123456");
		expect(cssColor(undefined, {})).toBeNull();
	});
});
