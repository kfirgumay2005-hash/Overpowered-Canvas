import { describe, expect, it } from "vitest";
import { bounds, eraseFrom, hitsStroke, inPolygon, lassoed, pack, recognize, simplifyPath, strokePath, transform, unpack, type InkPoint } from "./ink";

const line = (n: number, fn: (t: number) => { x: number; y: number }): { x: number; y: number }[] => Array.from({ length: n }, (_, i) => fn(i / (n - 1)));
const ink = (pts: { x: number; y: number }[]): InkPoint[] => pts.map((p) => ({ ...p, p: 0.5 }));

describe("pack / unpack", () => {
	it("round-trips with and without tilt", () => {
		const pts: InkPoint[] = [
			{ x: 1.234, y: 5.678, p: 0.512 },
			{ x: 2, y: 3, p: 1.5, tiltX: 10, tiltY: -5 },
		];
		const packed = pack(pts);
		expect(packed).toEqual({ pts: [1.2, 5.7, 0.51, 2, 3, 1], tilt: [0, 0, 10, -5] });
		expect(unpack(packed.pts, packed.tilt)).toEqual([
			{ x: 1.2, y: 5.7, p: 0.51, tiltX: 0, tiltY: 0 },
			{ x: 2, y: 3, p: 1, tiltX: 10, tiltY: -5 },
		]);
		expect(pack([{ x: 0, y: 0, p: 0.5 }])).toEqual({ pts: [0, 0, 0.5] });
	});
});

describe("strokePath", () => {
	it("produces a closed outline for every tool", () => {
		const pts = ink(line(20, (t) => ({ x: t * 100, y: Math.sin(t * 6) * 10 })));
		for (const tool of ["pen", "pencil", "marker", "highlighter"] as const) {
			const d = strokePath(pts, tool, 6);
			expect(d.startsWith("M")).toBe(true);
			expect(d.endsWith("Z")).toBe(true);
		}
	});
});

describe("hit testing and erasing", () => {
	const stroke = ink(line(11, (t) => ({ x: t * 100, y: 0 })));
	it("hits within radius plus half the stroke size", () => {
		expect(hitsStroke({ x: 50, y: 6 }, 3, stroke, 6)).toBe(true);
		expect(hitsStroke({ x: 50, y: 20 }, 3, stroke, 6)).toBe(false);
	});
	it("splits a stroke where the eraser passes", () => {
		const runs = eraseFrom(stroke, { x: 50, y: 0 }, 15);
		expect(runs).toHaveLength(2);
		expect(runs[0]!.at(-1)!.x).toBe(30);
		expect(runs[1]![0]!.x).toBe(70);
		expect(eraseFrom(stroke, { x: 500, y: 0 }, 15)).toEqual([stroke]);
		expect(eraseFrom(stroke, { x: 50, y: 0 }, 1000)).toEqual([]);
	});
});

describe("lasso and transforms", () => {
	const square = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
	it("point in polygon", () => {
		expect(inPolygon({ x: 50, y: 50 }, square)).toBe(true);
		expect(inPolygon({ x: 150, y: 50 }, square)).toBe(false);
	});
	it("lassoes strokes that are mostly inside", () => {
		expect(lassoed([{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 200, y: 20 }], square)).toBe(true);
		expect(lassoed([{ x: 10, y: 10 }, { x: 200, y: 20 }, { x: 300, y: 20 }], square)).toBe(false);
	});
	it("scales around an origin and translates", () => {
		expect(transform([{ x: 10, y: 10 }], 5, 0, 2, { x: 0, y: 0 })).toEqual([{ x: 25, y: 20 }]);
		expect(bounds([{ x: 1, y: 2 }, { x: 5, y: -1 }], 1)).toEqual({ minX: 0, minY: -2, maxX: 6, maxY: 3 });
	});
});

describe("shape recognition", () => {
	const jitter = (pts: { x: number; y: number }[]) => pts.map((p, i) => ({ x: p.x + Math.sin(i * 1.7) * 1.5, y: p.y + Math.cos(i * 2.3) * 1.5 }));

	it("recognizes a circle", () => {
		const pts = jitter(line(60, (t) => ({ x: 100 + Math.cos(t * Math.PI * 2) * 80, y: 100 + Math.sin(t * Math.PI * 2) * 60 })));
		expect(recognize(pts)?.kind).toBe("ellipse");
	});

	it("recognizes a rectangle", () => {
		const corners = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }, { x: 0, y: 0 }];
		const pts: { x: number; y: number }[] = [];
		for (let i = 1; i < corners.length; i++) for (let k = 0; k < 15; k++) pts.push({ x: corners[i - 1]!.x + ((corners[i]!.x - corners[i - 1]!.x) * k) / 15, y: corners[i - 1]!.y + ((corners[i]!.y - corners[i - 1]!.y) * k) / 15 });
		expect(recognize(jitter(pts))?.kind).toBe("rectangle");
	});

	it("recognizes a triangle", () => {
		const corners = [{ x: 100, y: 0 }, { x: 200, y: 170 }, { x: 0, y: 170 }, { x: 100, y: 0 }];
		const pts: { x: number; y: number }[] = [];
		for (let i = 1; i < corners.length; i++) for (let k = 0; k < 15; k++) pts.push({ x: corners[i - 1]!.x + ((corners[i]!.x - corners[i - 1]!.x) * k) / 15, y: corners[i - 1]!.y + ((corners[i]!.y - corners[i - 1]!.y) * k) / 15 });
		expect(recognize(jitter(pts))?.kind).toBe("triangle");
	});

	it("recognizes lines and arrows", () => {
		expect(recognize(jitter(line(30, (t) => ({ x: t * 300, y: t * 40 }))))?.kind).toBe("line");
		const shaft = line(30, (t) => ({ x: t * 300, y: 0 }));
		const hook = [...line(8, (t) => ({ x: 300 - t * 40, y: -t * 30 })), ...line(8, (t) => ({ x: 260 + t * 40, y: -30 + t * 30 })), ...line(8, (t) => ({ x: 300 - t * 40, y: t * 30 }))];
		const arrow = recognize([...shaft, ...hook]);
		expect(arrow?.kind).toBe("arrow");
	});

	it("rejects scribbles and tiny strokes", () => {
		expect(recognize([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 4, y: 1 }, { x: 5, y: 5 }])).toBeNull();
		const scribble = line(80, (t) => ({ x: t * 200, y: Math.sin(t * 40) * 60 }));
		expect(recognize(scribble)).toBeNull();
	});

	it("simplifies paths", () => {
		expect(simplifyPath(line(10, (t) => ({ x: t * 10, y: 0 })), 1)).toHaveLength(2);
	});
});
