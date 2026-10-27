import { describe, expect, it } from "vitest";
import type { Stroke } from "../../data/schema";
import type { CanvasNodeData } from "../../data/json-canvas";
import { cardUnder, remapRefs } from "./stick";
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

describe("ink stuck to cards", () => {
	const cards = [
		{ id: "top", x: 0, y: 0, width: 100, height: 50 },
		{ id: "below", x: 0, y: 0, width: 400, height: 400 },
	];
	it("belongs to the topmost card holding most of its points", () => {
		expect(cardUnder([{ x: 10, y: 10 }, { x: 50, y: 20 }, { x: 90, y: 40 }], cards)).toBe("top");
		expect(cardUnder([{ x: 10, y: 10 }, { x: 200, y: 200 }, { x: 300, y: 300 }], cards)).toBe("below");
		expect(cardUnder([{ x: -50, y: -50 }, { x: 500, y: 500 }], cards)).toBeNull();
	});
	it("pasted references follow the copies or are dropped", () => {
		const nodes = [
			{ id: "n1", type: "text", x: 0, y: 0, width: 1, height: 1, "x-opc": { kind: "ink", anchor: "a" } },
			{ id: "n2", type: "text", x: 0, y: 0, width: 1, height: 1, "x-opc": { kind: "ink", anchor: "gone" } },
			{ id: "n3", type: "text", x: 0, y: 0, width: 1, height: 1, "x-opc": { kind: "line", line: { points: [], from: { node: "a" }, to: { node: "gone" } } } },
		] as unknown as CanvasNodeData[];
		remapRefs(nodes, new Map([["a", "a2"]]));
		expect((nodes[0]!["x-opc"] as { anchor?: string }).anchor).toBe("a2");
		expect((nodes[1]!["x-opc"] as { anchor?: string }).anchor).toBeUndefined();
		expect((nodes[2]!["x-opc"] as { line: { from?: unknown; to?: unknown } }).line).toEqual({ points: [], from: { node: "a2" } });
	});
});
