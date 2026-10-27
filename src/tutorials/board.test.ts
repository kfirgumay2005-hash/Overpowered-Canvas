import { describe, expect, it } from "vitest";
import { checkCanvasFile, hasErrors } from "../data/validate-file";
import { createTranslator, LOCALE_IDS } from "../i18n";
import { en } from "../i18n/locales/en";
import { added, addedEdges, card, count, edge, ellipsePoints, extraOf, ink, kindOf, practicePdf, strokeCount, sticky, title } from "./board";
import { TUTORIALS } from "./catalog";

describe("board builders", () => {
	it("makes headings and plain floating text", () => {
		expect(title("t", "Hello", 0, 0).text).toBe("# Hello");
		expect(title("t", "Hello", 0, 0, 300, 50, 2).text).toBe("## Hello");
		expect(title("t", "Hello", 0, 0, 300, 50, 0).text).toBe("Hello");
		expect(kindOf(title("t", "x", 0, 0))).toBe("text");
	});

	it("wraps an ink stroke in its carrier", () => {
		const node = ink("i", ellipsePoints(100, 50, 80, 40));
		const strokes = extraOf(node).strokes as { pts: number[] }[];
		expect(strokes).toHaveLength(1);
		const pts = strokes[0]!.pts;
		for (let i = 0; i + 2 < pts.length; i += 3) {
			expect(pts[i]).toBeGreaterThanOrEqual(0);
			expect(pts[i]).toBeLessThanOrEqual(node.width);
			expect(pts[i + 1]).toBeGreaterThanOrEqual(0);
			expect(pts[i + 1]).toBeLessThanOrEqual(node.height);
		}
	});
});

describe("check helpers", () => {
	const before = { nodes: [card("a", "A", 0, 0), sticky("s", "S", 0, 0)], edges: [edge("e", "a", "right", "s", "left")] };
	const now = { nodes: [...before.nodes, sticky("s2", "", 0, 0)], edges: [...before.edges, edge("e2", "s", "right", "s2", "left")] };

	it("finds what was added", () => {
		expect(added(before, now).map((n) => n.id)).toEqual(["s2"]);
		expect(addedEdges(before, now).map((e) => e.id)).toEqual(["e2"]);
		expect(count(now, (n) => kindOf(n) === "sticky")).toBe(2);
	});

	it("counts strokes", () => {
		expect(strokeCount(before)).toBe(0);
		expect(strokeCount({ nodes: [ink("i", ellipsePoints(0, 0, 10, 10))] })).toBe(1);
	});
});

describe("tutorial catalog", () => {
	it("has unique tutorial ids", () => {
		expect(new Set(TUTORIALS.map((d) => d.id)).size).toBe(TUTORIALS.length);
	});

	for (const locale of LOCALE_IDS) {
		const t = createTranslator(locale);
		for (const def of TUTORIALS) {
			it(`${def.id} builds a valid board in ${locale}`, () => {
				const folder = `tutorials/${def.id}`;
				const board = def.board(t, folder);
				// File cards point at the tutorial's own practice files, which have usable names.
				const files = (def.files?.(t) ?? []).map((f) => `${folder}/${f.path}`);
				for (const f of files) expect(f).not.toMatch(/[\\:*?"<>|#^[\]]/);
				for (const n of board.nodes) if (n.type === "file") expect(files).toContain(n.file);
				const file = { nodes: board.nodes, edges: board.edges, "x-opc": { v: 1, ...board.root } };
				const problems = checkCanvasFile(file);
				expect(hasErrors(problems), JSON.stringify(problems)).toBe(false);
				// No dangling edges or duplicate ids (warnings the validator tolerates).
				expect(problems, JSON.stringify(problems)).toEqual([]);
				const ids = board.nodes.map((n) => n.id);
				expect(new Set(ids).size).toBe(ids.length);
				// Every text in the board is translated (no raw keys left).
				for (const n of board.nodes) expect(String(n.text ?? n.label ?? "")).not.toMatch(/tut\.\w+\./);
			});
		}
	}

	for (const def of TUTORIALS)
		it(`${def.id} steps are complete`, () => {
			for (const key of [def.title, def.summary]) expect(en[key]).toBeTruthy();
			for (const step of def.steps) {
				expect(en[step.title]).toBeTruthy();
				expect(en[step.body]).toBeTruthy();
				// A task needs a way to notice it was done, and a way to show it.
				if (step.task) {
					expect(en[step.task]).toBeTruthy();
					expect(step.check, step.task).toBeTypeOf("function");
					expect(step.demo, step.task).toBeTypeOf("function");
				}
			}
		});
});

describe("practice PDF", () => {
	it("points startxref and every xref entry at the right place", () => {
		const pdf = practicePdf(["0 0 1 rg 10 10 100 100 re f", "0 g 1 w 0 0 m 10 10 l S"]);
		const start = Number(/startxref\n(\d+)/.exec(pdf)![1]);
		expect(pdf.slice(start, start + 4)).toBe("xref");
		const entries = [...pdf.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
		expect(entries).toHaveLength(6);
		entries.forEach((o, i) => expect(pdf.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
	});
});
