import { describe, expect, it } from "vitest";
import { readNode } from "../../data/validate";
import { absoluteLine, borderPoint, carryBends, fitLine, LINE_PAD, lineNodeData, shapeNodeData, snapEnds } from "./model";

describe("free lines", () => {
	it("fits the box around the points", () => {
		const { box, rel } = fitLine([{ x: 100, y: 50 }, { x: 300, y: 150 }]);
		expect(box).toEqual({ x: 100 - LINE_PAD, y: 50 - LINE_PAD, width: 200 + 2 * LINE_PAD, height: 100 + 2 * LINE_PAD });
		expect(rel).toEqual([[LINE_PAD, LINE_PAD], [200 + LINE_PAD, 100 + LINE_PAD]]);
	});

	it("builds valid line node data and restores absolute points", () => {
		const data = lineNodeData("l1", [{ x: 0, y: 0 }, { x: 100, y: 0 }], { to: "n2" }, { endArrow: "triangle", color: "#f00", strokeWidth: 3 });
		expect(data.color).toBe("#f00");
		const extra = readNode(data["x-opc"]);
		expect(extra).toEqual(data["x-opc"]);
		expect(absoluteLine(extra.line!, data)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
	});

	it("finds the border point toward a target", () => {
		const box = { x: 0, y: 0, width: 200, height: 100 };
		expect(borderPoint(box, { x: 500, y: 50 })).toEqual({ x: 200, y: 50 });
		expect(borderPoint(box, { x: 100, y: -500 })).toEqual({ x: 100, y: 0 });
	});

	it("snaps attached ends to card borders", () => {
		const pts = snapEnds([{ x: 50, y: 50 }, { x: 400, y: 50 }], { x: 0, y: 0, width: 100, height: 100 }, { x: 350, y: 0, width: 100, height: 100 });
		expect(pts).toEqual([{ x: 100, y: 50 }, { x: 350, y: 50 }]);
	});

	it("builds valid standalone shape data", () => {
		const data = shapeNodeData("s", "ellipse", { x: 1.4, y: 2.6, width: 10, height: 50 }, { color: "#000000" });
		expect(data).toMatchObject({ x: 1, y: 3, width: 20, height: 50, color: "#000000" });
		expect(readNode(data["x-opc"])).toEqual({ kind: "shape", shape: "ellipse" });
	});
});

describe("carryBends", () => {
	it("moves, turns and stretches bends with the ends", () => {
		const pts = [{ x: 0, y: 0 }, { x: 50, y: 50 }, { x: 100, y: 0 }];
		expect(carryBends(pts, { x: 10, y: 10 }, { x: 110, y: 10 })[1]).toEqual({ x: 60, y: 60 });
		const turned = carryBends(pts, { x: 0, y: 0 }, { x: 0, y: 200 })[1]!;
		expect(turned.x).toBeCloseTo(-100);
		expect(turned.y).toBeCloseTo(100);
	});
});
