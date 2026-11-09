import { describe, expect, it } from "vitest";
import { paperMm, pdfPageSize, sheetIndexAt, sheetSize, sheetsFor, SHEET_GAP, stackOrigin, stackSheets, STACK_MARGIN } from "./layout";

describe("page format", () => {
	it("sizes sheets like paper: A4 is 210 × 297 mm, ~794 × 1123 board px at 96 dpi", () => {
		expect(paperMm({ format: "A4" })).toEqual({ width: 210, height: 297 });
		expect(paperMm({ format: "A4", landscape: true })).toEqual({ width: 297, height: 210 });
		expect(sheetSize({ format: "A4" })).toEqual({ width: 793.7, height: 1122.5 });
		expect(paperMm({ format: "Letter" })).toEqual({ width: 215.9, height: 279.4 });
	});
	it("keeps custom sizes sensible and portrait unless landscape", () => {
		expect(paperMm({ format: "custom", width: 300, height: 100 })).toEqual({ width: 100, height: 300 });
		expect(paperMm({ format: "custom", width: 300, height: 100, landscape: true })).toEqual({ width: 300, height: 100 });
		expect(paperMm({ format: "custom", width: 1, height: 99999 })).toEqual({ width: 50, height: 2000 });
		expect(paperMm({ format: "custom" })).toEqual({ width: 210, height: 297 });
	});
	it("puts a new stack around the content, or at the origin", () => {
		expect(stackOrigin({ minX: 100, minY: 40 })).toEqual({ x: 100 - STACK_MARGIN, y: 40 - STACK_MARGIN });
		expect(stackOrigin(null)).toEqual({ x: 0, y: 0 });
	});
	it("adds sheets as the content grows down", () => {
		const spec = { format: "A5" as const };
		const h = sheetSize(spec).height;
		expect(sheetsFor({ y: 0 }, spec, null)).toBe(1);
		expect(sheetsFor({ y: 0 }, spec, h - 1)).toBe(1);
		expect(sheetsFor({ y: 0 }, spec, h + 10)).toBe(2);
		expect(sheetsFor({ y: 0 }, spec, 3 * (h + SHEET_GAP) + 5)).toBe(4);
	});
	it("stacks sheets top to bottom and finds the sheet under a point", () => {
		const spec = { format: "A4" as const };
		const sheets = stackSheets({ x: 10, y: 20 }, spec, 3);
		expect(sheets.map((s) => s.y)).toEqual([20, 20 + 1122.5 + SHEET_GAP, 20 + 2 * (1122.5 + SHEET_GAP)]);
		expect(sheets.every((s) => s.x === 10 && s.width === 793.7)).toBe(true);
		expect(sheetIndexAt({ y: 20 }, spec, 0)).toBe(-1);
		expect(sheetIndexAt({ y: 20 }, spec, 30)).toBe(0);
		expect(sheetIndexAt({ y: 20 }, spec, 20 + 1122.5 + SHEET_GAP + 1)).toBe(1);
	});
	it("gives the PDF page size in inches", () => {
		const a4 = pdfPageSize({ format: "A4" });
		expect(a4.width).toBeCloseTo(8.268, 3);
		expect(a4.height).toBeCloseTo(11.693, 3);
	});
});
