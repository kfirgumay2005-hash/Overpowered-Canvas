import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import type { CanvasFileData } from "../../data/json-canvas";
import type { ElkLike } from "../auto-layout/layout";
import { applyNote, type ApplyOptions } from "./apply";
import type { AutoHeaders } from "./headers";
import { exportNote, splitNote } from "./note";
import { writeOutline } from "./outline";
import { buildStructure } from "./structure";

const elk = new ELK() as unknown as ElkLike;
const card = (id: string, text: string, x: number, y: number, extra?: object) => ({ id, type: "text" as const, text, x, y, width: 120, height: 50, ...(extra ? { "x-opc": { v: 1, ...extra } } : {}) });
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, fromNode: from, toNode: to });
const md = (data: CanvasFileData, autoHeaders: AutoHeaders | null, plain = false) => writeOutline(buildStructure(data, { rtl: false, freeLabel: "Free cards", autoHeaders }).items, { indent: "\t", ids: false, plain });

function options(autoHeaders: AutoHeaders | null): ApplyOptions {
	let n = 0;
	return { layout: "right", rtl: false, spacing: 30, levelSpacing: 80, newId: () => `new${n++}`, resolveFile: () => null, textWidth: 320, fileSize: { width: 400, height: 300 }, autoHeaders };
}

// Root → A (3 children: a1 a2 a3), B (1 child: b1 → b11 → b111).
const board: CanvasFileData = {
	nodes: [
		card("r", "Root", 0, 300),
		card("a", "A", 300, 0),
		card("b", "B", 300, 600),
		card("a1", "a1", 600, 0),
		card("a2", "a2", 600, 100),
		card("a3", "a3", 600, 200),
		card("b1", "b1", 600, 600),
		card("b11", "b11", 900, 600),
		card("b111", "b111", 1200, 600),
	],
	edges: [edge("r", "a"), edge("r", "b"), edge("a", "a1"), edge("a", "a2"), edge("a", "a3"), edge("b", "b1"), edge("b1", "b11"), edge("b11", "b111")],
};

describe("automatic header rules", () => {
	it("off: the outline is as before", () => {
		expect(md(board, null)).toBe("# Root\n- A\n\t- a1\n\t- a2\n\t- a3\n- B\n\t- b1\n\t\t- b11\n\t\t\t- b111\n");
	});

	it("by number of children: a card with at least N children becomes a heading", () => {
		expect(md(board, { rule: "children", n: 3 })).toBe("# Root\n- B\n\t- b1\n\t\t- b11\n\t\t\t- b111\n\n## A\n- a1\n- a2\n- a3\n");
		// N = 1: every card with a child; levels follow the nearest heading above (up to H6).
		expect(md(board, { rule: "children", n: 1 })).toBe("# Root\n\n## A\n- a1\n- a2\n- a3\n\n## B\n\n### b1\n\n#### b11\n- b111\n");
	});

	it("by depth: levels 1 … N are headings, deeper levels an outline", () => {
		expect(md(board, { rule: "depth", n: 3 })).toBe("# Root\n\n## A\n\n### a1\n\n### a2\n\n### a3\n\n## B\n\n### b1\n- b11\n\t- b111\n");
		expect(md(board, { rule: "depth", n: 1 })).toBe(md(board, null));
	});

	it("a card's own setting wins: a level of its own, or never a header", () => {
		const own: CanvasFileData = { ...board, nodes: board.nodes!.map((n) => (n.id === "a" ? card("a", "A", 300, 0, { header: -1 }) : n.id === "b1" ? card("b1", "b1", 600, 600, { header: 4 }) : n)) };
		const out = md(own, { rule: "children", n: 1 });
		expect(out).toContain("# Root\n- A\n\t- a1\n");
		expect(out).toContain("\n#### b1\n");
	});

	it("follows the plain-first format: no blank line between a heading and its lines", () => {
		expect(md(board, { rule: "children", n: 3 }, true)).toBe("# Root\nB\n- b1\n\t- b11\n\t\t- b111\n\n## A\na1\na2\na3\n");
	});

	it("headings the rules make come back as plain cards (nothing stored on them)", async () => {
		const rules: AutoHeaders = { rule: "depth", n: 2 };
		const opts = { canvasPath: "m.canvas", rtl: false, freeLabel: "Free cards", indent: "\t", autoHeaders: rules } as never;
		const note = exportNote(board, opts);
		const { items, data } = splitNote(note);
		const back = await applyNote(items, data, board, elk, options(rules));
		for (const n of back.data.nodes!) expect((n["x-opc"] as { header?: number } | undefined)?.header).toBeUndefined();
		expect(back.updated).toBe(0);
		expect(exportNote(back.data, opts)).toBe(note);
	});

	it("a heading the rules make, written as a plain line in the note, becomes never a header", async () => {
		const rules: AutoHeaders = { rule: "children", n: 3 };
		const opts = { canvasPath: "m.canvas", rtl: false, freeLabel: "Free cards", indent: "\t", autoHeaders: rules } as never;
		const note = exportNote(board, opts);
		expect(note).toContain("\n## A");
		const { items, data } = splitNote(note.replace(/\n\n## A( %%n:a%%)?\n- a1/, (_m, id: string | undefined) => `\n- A${id ?? ""}\n\t- a1`).replace("\n- a2", "\n\t- a2").replace("\n- a3", "\n\t- a3"));
		const back = await applyNote(items, data, board, elk, options(rules));
		expect((back.data.nodes!.find((n) => n.id === "a")!["x-opc"] as { header?: number } | undefined)?.header).toBe(-1);
		expect(exportNote(back.data, opts)).not.toContain("## A");
	});
});
