import { describe, expect, it } from "vitest";
import type { Stroke } from "../../data/schema";
import { absolutePoints, CARRIER_PAD, makeStroke, refit } from "./carriers";

const style = { tool: "pen" as const, color: "#000", size: 4 };

describe("carriers", () => {
	it("stores points relative to the carrier and restores them", () => {
		const s = makeStroke("s1", [{ x: 110, y: 220, p: 0.5 }, { x: 150, y: 260, p: 0.6 }], { x: 100, y: 200 }, style);
		expect(s.pts).toEqual([10, 20, 0.5, 50, 60, 0.6]);
		expect(absolutePoints(s, { x: 100, y: 200 }).map((p) => [p.x, p.y])).toEqual([[110, 220], [150, 260]]);
	});

	it("refits the box around all strokes without moving them on the canvas", () => {
		const origin = { x: 100, y: 100 };
		const a = makeStroke("a", [{ x: 120, y: 120, p: 0.5 }, { x: 140, y: 130, p: 0.5 }], origin, style);
		const b = makeStroke("b", [{ x: 40, y: 300, p: 0.5 }, { x: 60, y: 310, p: 0.5 }], origin, style);
		const fit = refit([a, b], origin)!;
		expect(fit.box.x).toBe(40 - 2 - CARRIER_PAD);
		expect(fit.box.y).toBe(120 - 2 - CARRIER_PAD);
		const abs = fit.strokes.map((s: Stroke) => absolutePoints(s, fit.box)[0]);
		expect(abs.map((p) => [p!.x, p!.y])).toEqual([[120, 120], [40, 300]]);
		expect(refit([], origin)).toBeNull();
	});
});
