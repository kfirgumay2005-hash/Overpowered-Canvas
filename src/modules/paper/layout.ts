// Page format: sheets of paper on the board (pure, unit-tested).
import type { PaperSpec } from "../../data/schema";

/** Paper sizes in millimetres, portrait. */
export const PAPER_FORMATS = {
	A3: [297, 420],
	A4: [210, 297],
	A5: [148, 210],
	Letter: [215.9, 279.4],
	Legal: [215.9, 355.6],
} as const;

/** Board pixels per millimetre: at 100 % zoom a sheet is as big on screen as on paper (96 dpi). */
export const PX_PER_MM = 96 / 25.4;
/** Room between two sheets of a stack, in board pixels. */
export const SHEET_GAP = 48;
/** Room left around the content when a stack is first placed around it. */
export const STACK_MARGIN = 56;

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The sheet size in millimetres (custom sizes are kept between 50 and 2000 mm). */
export function paperMm(spec: PaperSpec): { width: number; height: number } {
	const clamp = (v: number | undefined, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(2000, Math.max(50, v)) : fallback);
	const [w, h] = spec.format === "custom" ? [clamp(spec.width, 210), clamp(spec.height, 297)] : PAPER_FORMATS[spec.format];
	return spec.landscape ? { width: Math.max(w, h), height: Math.min(w, h) } : { width: Math.min(w, h), height: Math.max(w, h) };
}

/** The sheet size on the board. */
export function sheetSize(spec: PaperSpec): { width: number; height: number } {
	const mm = paperMm(spec);
	return { width: Math.round(mm.width * PX_PER_MM * 10) / 10, height: Math.round(mm.height * PX_PER_MM * 10) / 10 };
}

/** Where a new stack goes: around the content already there (a margin in), or at the origin. */
export function stackOrigin(content: { minX: number; minY: number } | null): { x: number; y: number } {
	return content ? { x: Math.round(content.minX - STACK_MARGIN), y: Math.round(content.minY - STACK_MARGIN) } : { x: 0, y: 0 };
}

/** How many sheets a stack needs so that content reaching down to `bottom` is on paper. */
export function sheetsFor(origin: { y: number }, spec: PaperSpec, bottom: number | null): number {
	if (bottom === null) return 1;
	const { height } = sheetSize(spec);
	return Math.max(1, Math.ceil((bottom - origin.y + SHEET_GAP) / (height + SHEET_GAP)));
}

/** The sheets of a stack, top to bottom. */
export function stackSheets(origin: { x: number; y: number }, spec: PaperSpec, count: number): Box[] {
	const { width, height } = sheetSize(spec);
	return Array.from({ length: Math.max(1, count) }, (_, i) => ({ x: origin.x, y: Math.round((origin.y + i * (height + SHEET_GAP)) * 10) / 10, width, height }));
}

/** The sheet a board point lies on (or the gap after it), -1 above the stack. */
export function sheetIndexAt(origin: { y: number }, spec: PaperSpec, y: number): number {
	const { height } = sheetSize(spec);
	return y < origin.y ? -1 : Math.floor((y - origin.y) / (height + SHEET_GAP));
}

/** Electron's printToPDF page size (inches) for a spec. */
export function pdfPageSize(spec: PaperSpec): { width: number; height: number } {
	const mm = paperMm(spec);
	return { width: mm.width / 25.4, height: mm.height / 25.4 };
}
