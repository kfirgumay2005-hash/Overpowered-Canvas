import { describe, expect, it } from "vitest";
import { readNode } from "../../data/validate";
import { absoluteLine, borderPoint, carryBends, carrySquare, cornersOf, isSquare, keepSquareEnds, squareCorners, fitLine, LINE_PAD, lineNodeData, shapeNodeData, snapEnds } from "./model";

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

describe("corners of a drawn line", () => {
	const walk = (pts: [number, number][], step = 2) => {
		const out: { x: number; y: number }[] = [];
		for (let i = 0; i + 1 < pts.length; i++) {
			const [ax, ay] = pts[i]!;
			const [bx, by] = pts[i + 1]!;
			const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
			for (let k = 0; k < n; k++) out.push({ x: ax + ((bx - ax) * k) / n + (k % 2 ? 1.5 : -1.5), y: ay + ((by - ay) * k) / n });
		}
		out.push({ x: pts[pts.length - 1]![0], y: pts[pts.length - 1]![1] });
		return out;
	};
	it("a wobbly straight drag stays straight", () => {
		expect(cornersOf(walk([[0, 0], [300, 10]]), 12)).toHaveLength(2);
	});
	it("an L-shaped drag keeps its corner", () => {
		const c = cornersOf(walk([[0, 0], [200, 0], [200, 150]]), 12);
		expect(c).toHaveLength(3);
		expect(Math.abs(c[1]!.x - 200)).toBeLessThan(6);
		expect(Math.abs(c[1]!.y)).toBeLessThan(6);
	});
	it("a detour around a card keeps both turns", () => {
		expect(cornersOf(walk([[0, 0], [0, -120], [300, -120], [300, 0]]), 12)).toHaveLength(4);
	});
	it("drops corners inside the attached cards", () => {
		const from = { x: -50, y: -50, width: 100, height: 100 };
		const c = cornersOf(walk([[0, 0], [30, 30], [200, 30]]), 5, from);
		expect(c).toHaveLength(2);
	});
});

describe("square routes", () => {
	it("squares nearly straight segments by moving the corners", () => {
		const sq = squareCorners([{ x: 0, y: 0 }, { x: 4, y: 200 }, { x: 300, y: 206 }, { x: 302, y: 100 }]);
		expect(sq).toEqual([{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 302, y: 200 }, { x: 302, y: 100 }]);
		expect(isSquare(sq)).toBe(true);
	});
	it("keeps diagonal segments", () => {
		expect(isSquare(squareCorners([{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 100 }]))).toBe(false);
	});
	it("corners slide with a moved end and stay square", () => {
		const route = [{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 300, y: 200 }, { x: 300, y: 100 }];
		const moved = carrySquare(route, route[0]!, { x: 450, y: 140 });
		expect(moved).toEqual([{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 450, y: 200 }, { x: 450, y: 140 }]);
		expect(isSquare(moved)).toBe(true);
	});
	it("bent ends meet the card straight across from the corner", () => {
		const box = { x: 0, y: 0, width: 100, height: 50 };
		expect(snapEnds([{ x: 50, y: 25 }, { x: 30, y: 200 }, { x: 300, y: 200 }], box)[0]).toEqual({ x: 30, y: 50 });
	});
});

describe("square routes and resized cards", () => {
	it("pulls the corner back in front of a card that shrank", () => {
		const route = [{ x: 96, y: 60 }, { x: 96, y: 454 }, { x: 396, y: 454 }, { x: 396, y: 380 }];
		const out = keepSquareEnds(route, { x: 0, y: 0, width: 60, height: 60 });
		expect(out[0]!.x).toBe(out[1]!.x);
		expect(out[1]!.x).toBeLessThanOrEqual(60);
		expect(isSquare(out)).toBe(true);
	});
});
