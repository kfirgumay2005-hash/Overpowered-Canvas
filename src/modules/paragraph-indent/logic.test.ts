import { describe, expect, it } from "vitest";
import { applyIndent, applyOutdent, BREAK_CHAR, fixLeadingRun, INDENT_CHAR, indentText, inInlineMath, startsWithIndent, tabKeepsDefault, type Lines } from "./logic";

const doc = (text: string): Lines => {
	const lines = text.split("\n");
	return { count: lines.length, line: (n) => lines[n] ?? "" };
};
const keeps = (text: string, line: number) => tabKeepsDefault(doc(text), line);

describe("where Tab writes a paragraph indent", () => {
	it("in prose, headings and quotes", () => {
		expect(keeps("Once upon a time", 0)).toBe(false);
		expect(keeps("# Chapter", 0)).toBe(false);
		expect(keeps("> She said", 0)).toBe(false);
		expect(keeps("", 0)).toBe(false);
		expect(keeps(`${INDENT_CHAR}${INDENT_CHAR}Already indented`, 0)).toBe(false);
	});
	it("not in lists, tables, indented lines or quoted lists", () => {
		for (const line of ["- item", "  - nested", "1. first", "2) second", "* star", "- [ ] task", "| a | b |", "    code", "\tcode", "> - quoted item", "-"]) expect(keeps(line, 0)).toBe(true);
	});
	it("not in frontmatter", () => {
		const text = "---\ntitle: x\n---\nProse";
		expect(keeps(text, 1)).toBe(true);
		expect(keeps(text, 2)).toBe(true);
		expect(keeps(text, 3)).toBe(false);
	});
	it("not in code or math blocks", () => {
		const text = "a\n```js\nconst x = 1;\n```\nb\n~~~\nz\n~~~~\nc\n$$\nx^2\n$$\nd\n$$ inline $$\ne";
		const lines = text.split("\n");
		const inside = lines.map((_, i) => keeps(text, i));
		expect(inside).toEqual([false, true, true, true, false, true, true, true, false, true, true, true, false, true, false]);
	});
	it("a fence closes only with the same marker", () => {
		const text = "````\n```\nstill code\n````\nprose";
		expect(keeps(text, 2)).toBe(true);
		expect(keeps(text, 4)).toBe(false);
	});
});

describe("indent text", () => {
	it("is em spaces, never ASCII whitespace", () => {
		expect(indentText(2)).toBe("\u2003\u2003");
		expect(indentText(0)).toBe("\u2003");
		expect(indentText(99)).toBe("\u2003".repeat(8));
	});
});

const E = INDENT_CHAR;
const W = BREAK_CHAR;
const show = (t: string) => t.replace(/\u2003/g, "E").replace(/\u2060/g, "|");

describe("Tab", () => {
	it("writes the indent at the cursor", () => {
		expect(applyIndent("Once", 0, 0, 2)).toEqual({ text: `${E}${E}Once`, cursor: 2 });
		expect(applyIndent("Once", 2, 2, 2)).toEqual({ text: `On${E}${E}ce`, cursor: 4 });
		expect(applyIndent("Once", 1, 3, 1)).toEqual({ text: `O${E}e`, cursor: 2 });
	});
	it("never leaves four leading spaces in a row (the editor would show indented code)", () => {
		const two = applyIndent("Once", 0, 0, 2);
		const four = applyIndent(two.text, two.cursor, two.cursor, 2);
		expect(show(four.text)).toBe("EEE|EOnce");
		expect(four.cursor).toBe(5);
		const eight = applyIndent("Once", 0, 0, 8);
		expect(show(eight.text)).toBe("EEE|EEE|EEOnce");
		expect(/^\s{4}/.test(eight.text)).toBe(false);
	});
	it("keeps quote markers in front", () => {
		expect(show(applyIndent("> Said", 2, 2, 4).text)).toBe("> EEE|ESaid");
	});
	it("rebuilds a run typed or pasted by hand", () => {
		expect(show(fixLeadingRun(`${E}${E}${E}${E}${E}x`, 6).text)).toBe("EEE|EEx");
		expect(fixLeadingRun(`${E}${E}${E}${W}${E}x`, 6).text).toBe(`${E}${E}${E}${W}${E}x`);
	});
});

describe("Shift+Tab", () => {
	it("removes one indent before the cursor", () => {
		expect(applyOutdent(`${E}${E}${E}Text`, 3, 2)).toEqual({ text: `${E}Text`, cursor: 1 });
	});
	it("steps over the invisible breaks", () => {
		const r = applyOutdent(`${E}${E}${E}${W}${E}Text`, 5, 2)!;
		expect(show(r.text)).toBe("EEText");
		expect(r.cursor).toBe(2);
	});
	it("else removes it at the start of the line", () => {
		expect(applyOutdent(`${E}${E}Text`, 6, 2)).toEqual({ text: "Text", cursor: 4 });
		expect(applyOutdent(`> ${E}${E}Quote`, 9, 2)).toEqual({ text: "> Quote", cursor: 7 });
	});
	it("does nothing without an indent", () => {
		expect(applyOutdent("Text", 2, 2)).toBeNull();
	});
});

describe("inline math and code", () => {
	it("leaves Tab to math plugins inside $…$ and inside `…`", () => {
		expect(inInlineMath("see $x^2", 8)).toBe(true);
		expect(inInlineMath("see $x^2$ here", 13)).toBe(false);
		expect(inInlineMath("a `code", 7)).toBe(true);
		expect(inInlineMath("a `$` b", 7)).toBe(false);
		expect(inInlineMath("costs \\$5", 9)).toBe(false);
	});
});

describe("lines that wrap flush (no hanging indent in the editor)", () => {
	it("are the ones that start with a paragraph indent", () => {
		expect(startsWithIndent(indentText(2) + "Once")).toBe(true);
		expect(startsWithIndent(INDENT_CHAR + INDENT_CHAR + INDENT_CHAR + BREAK_CHAR + INDENT_CHAR + "x")).toBe(true);
		expect(startsWithIndent("\tcode")).toBe(false);
		expect(startsWithIndent("    code")).toBe(false);
		expect(startsWithIndent("Once" + INDENT_CHAR)).toBe(false);
		expect(startsWithIndent("")).toBe(false);
	});
});
