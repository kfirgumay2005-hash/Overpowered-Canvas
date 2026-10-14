import { describe, expect, it } from "vitest";
import { benchmarkViewport, frameStats, percentile } from "./stats";

describe("percentile", () => {
	it("uses nearest-rank", () => {
		const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
		expect(percentile(sorted, 50)).toBe(5);
		expect(percentile(sorted, 95)).toBe(10);
		expect(percentile([], 50)).toBe(0);
	});
});

describe("frameStats", () => {
	it("summarizes frame times", () => {
		const s = frameStats([16, 16, 16, 40, 16]);
		expect(s.frames).toBe(5);
		expect(s.avgMs).toBeCloseTo(20.8, 1);
		expect(s.avgFps).toBeCloseTo(48.1, 1);
		expect(s.medianMs).toBe(16);
		expect(s.maxMs).toBe(40);
		expect(s.slowFrames).toBe(1);
		expect(s.verySlowFrames).toBe(1);
	});

	it("ignores invalid samples", () => {
		expect(frameStats([0, -1, Number.NaN]).frames).toBe(0);
	});
});

describe("benchmarkViewport", () => {
	it("is deterministic and starts/ends near the start point", () => {
		const start = { x: 100, y: 50, zoom: 0 };
		expect(benchmarkViewport(10, 300, start)).toEqual(benchmarkViewport(10, 300, start));
		const first = benchmarkViewport(0, 300, start);
		expect(first.x).toBeCloseTo(100);
		expect(first.y).toBeCloseTo(50);
	});
});
