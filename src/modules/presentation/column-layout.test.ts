import { describe, expect, it } from "vitest";
import { columnClips, columnPositions, keepZoom, zoomAround } from "./column-layout";

describe("column layout", () => {
	it("starts each column after the card it continues from", () => {
		expect(columnPositions([300, 120, 500], 30)).toEqual([0, 330, 480]);
		expect(columnPositions([], 30)).toEqual([]);
	});
	it("cuts each column where the next one starts, never the last", () => {
		expect(columnClips(columnPositions([300, 120, 500], 30))).toEqual([330, 150, null]);
		expect(columnClips([0])).toEqual([null]);
		expect(columnClips([])).toEqual([]);
	});
	it("keeps the middle of the layout in the middle of the screen at any zoom", () => {
		const v = keepZoom(2, { width: 800, height: 600 });
		expect(v.x + v.zoom * 400).toBe(400);
		expect(v.y + v.zoom * 300).toBe(300);
		expect(keepZoom(1, { width: 800, height: 600 })).toEqual({ zoom: 1, x: 0, y: 0 });
	});
	it("zooms around the pinch point", () => {
		const v = { zoom: 1, x: 10, y: 20 };
		const at = { x: 300, y: 200 };
		const before = { x: (at.x - v.x) / v.zoom, y: (at.y - v.y) / v.zoom };
		const z = zoomAround(v, 2.5, at);
		expect(z.x + z.zoom * before.x).toBeCloseTo(at.x);
		expect(z.y + z.zoom * before.y).toBeCloseTo(at.y);
	});
});
