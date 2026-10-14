import { describe, expect, it } from "vitest";
import { anchor, arrowAngle, astarRoute, bestSide, orthogonalRoute, pointAlong, polylineLength, polylinePath, projectOnPolyline, simplify, trim, type Box, type P } from "./routing";

const box = (x: number, y: number, w: number, h: number): Box => ({ minX: x, minY: y, maxX: x + w, maxY: y + h });

function isOrthogonal(points: P[]) {
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1]!;
		const b = points[i]!;
		expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true);
	}
}

function hitsBox(points: P[], b: Box) {
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1]!;
		const c = points[i]!;
		const minX = Math.min(a.x, c.x);
		const maxX = Math.max(a.x, c.x);
		const minY = Math.min(a.y, c.y);
		const maxY = Math.max(a.y, c.y);
		if (maxX > b.minX && minX < b.maxX && maxY > b.minY && minY < b.maxY) return true;
	}
	return false;
}

describe("anchor / bestSide", () => {
	const b = box(0, 0, 200, 100);
	it("anchors at side midpoints", () => {
		expect(anchor(b, "top")).toEqual({ x: 100, y: 0 });
		expect(anchor(b, "right")).toEqual({ x: 200, y: 50 });
		expect(anchor(b, "bottom")).toEqual({ x: 100, y: 100 });
		expect(anchor(b, "left")).toEqual({ x: 0, y: 50 });
	});
	it("picks the side facing a point", () => {
		expect(bestSide(b, { x: 500, y: 60 })).toBe("right");
		expect(bestSide(b, { x: -500, y: 60 })).toBe("left");
		expect(bestSide(b, { x: 100, y: -300 })).toBe("top");
		expect(bestSide(b, { x: 120, y: 400 })).toBe("bottom");
	});
});

describe("simplify", () => {
	it("removes duplicates and collinear points", () => {
		expect(simplify([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }])).toEqual([
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 10, y: 5 },
		]);
	});
});

describe("orthogonalRoute", () => {
	it("connects facing sides with axis-aligned segments", () => {
		const a = box(0, 0, 100, 60);
		const b = box(300, 200, 100, 60);
		const pts = orthogonalRoute(anchor(a, "right"), "right", anchor(b, "left"), "left", [a, b]);
		isOrthogonal(pts);
		expect(pts[0]).toEqual({ x: 100, y: 30 });
		expect(pts[pts.length - 1]).toEqual({ x: 300, y: 230 });
		// Leaves to the right, arrives from the left.
		expect(pts[1]!.x).toBeGreaterThan(100);
		expect(pts[pts.length - 2]!.x).toBeLessThan(300);
	});

	it("goes around when sides face away", () => {
		const a = box(0, 0, 100, 60);
		const b = box(300, 0, 100, 60);
		const pts = orthogonalRoute(anchor(a, "left"), "left", anchor(b, "right"), "right", [a, b]);
		isOrthogonal(pts);
		expect(pts.length).toBeGreaterThan(3);
	});
});

describe("astarRoute", () => {
	it("routes around an obstacle between the nodes", () => {
		const a = box(0, 0, 100, 60);
		const b = box(500, 0, 100, 60);
		const wall = box(220, -200, 60, 460);
		const pts = astarRoute(anchor(a, "right"), "right", anchor(b, "left"), "left", [a, b, wall]);
		expect(pts).not.toBeNull();
		isOrthogonal(pts!);
		expect(hitsBox(pts!.slice(1, -1), wall)).toBe(false);
		expect(pts![0]).toEqual({ x: 100, y: 30 });
		expect(pts![pts!.length - 1]).toEqual({ x: 500, y: 30 });
	});

	it("gives up (null) when the target is enclosed", () => {
		const a = box(0, 0, 100, 60);
		const b = box(500, 0, 100, 60);
		const ring = [box(400, -100, 20, 260), box(680, -100, 20, 260), box(400, -100, 300, 20), box(400, 140, 300, 20)];
		expect(astarRoute(anchor(a, "right"), "right", anchor(b, "left"), "left", [a, b, ...ring], { maxCells: 5000 })).toBeNull();
	});
});

describe("polyline helpers", () => {
	const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
	it("measures and walks a polyline", () => {
		expect(polylineLength(line)).toBe(200);
		expect(pointAlong(line, 0.5).point).toEqual({ x: 100, y: 0 });
		expect(pointAlong(line, 0.75).point).toEqual({ x: 100, y: 50 });
		expect(pointAlong(line, 0.75).tangent).toEqual({ x: 0, y: 1 });
	});
	it("projects a point to a fraction", () => {
		expect(projectOnPolyline(line, { x: 130, y: 50 })).toBeCloseTo(0.75);
		expect(projectOnPolyline(line, { x: -50, y: 0 })).toBe(0);
	});
	it("trims both ends", () => {
		expect(trim(line, 10, 20)).toEqual([{ x: 10, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }]);
		expect(trim([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 50, y: 0 }], 7, 0)).toEqual([{ x: 7, y: 0 }, { x: 50, y: 0 }]);
	});
	it("builds paths with rounded corners", () => {
		expect(polylinePath(line)).toBe("M0 0 L100 0 L100 100");
		expect(polylinePath(line, 10)).toBe("M0 0 L90 0 Q100 0 100 10 L100 100");
	});
	it("computes arrow angles matching the core side rotations", () => {
		expect(arrowAngle({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(180); // arriving at a top side
		expect(arrowAngle({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeCloseTo(0); // bottom side
		expect(arrowAngle({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(270); // right side
		expect(arrowAngle({ x: 0, y: 0 }, { x: -10, y: 0 })).toBeCloseTo(90); // left side
	});
});
