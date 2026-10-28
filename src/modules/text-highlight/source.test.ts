import { describe, expect, it } from "vitest";
import { align, highlight, locate, rehighlight, sourceRange, toWords, unhighlight, withoutHighlights } from "./source";

/** Highlights the rendered words `pick` (first occurrence) of `source`. */
function pickAndMark(source: string, rendered: string, pick: string, color = ""): string {
	const from = rendered.indexOf(pick);
	const [s, e] = toWords(rendered, from, from + pick.length);
	const range = sourceRange(align(rendered, source), s, e)!;
	return highlight(source, range[0], range[1], { color });
}

describe("text highlight", () => {
	it("maps plain text one to one", () => {
		expect(pickAndMark("The brown fox", "The brown fox", "brown")).toBe("The ==brown== fox");
	});
	it("snaps to whole words", () => {
		expect(toWords("The brown fox", 5, 8)).toEqual([4, 9]);
		expect(pickAndMark("The brown fox", "The brown fox", "rown f")).toBe("The ==brown fox==");
	});
	it("takes in formatting it cuts through", () => {
		expect(pickAndMark("The **quick** brown fox", "The quick brown fox", "quick brown")).toBe("The ==**quick** brown== fox");
	});
	it("uses a colored mark for a chosen color", () => {
		expect(pickAndMark("one two three", "one two three", "two", "#ffd43b")).toBe('one <mark style="background: #ffd43b;">two</mark> three');
	});
	it("highlights line by line, keeping list markers out", () => {
		const source = "- apples\n- pears";
		expect(pickAndMark(source, "apples\npears", "apples\npears")).toBe("- ==apples==\n- ==pears==");
	});
	it("skips text the renderer added", () => {
		const map = align("NoteSome text", "> [!note]\n> Some text");
		const r = sourceRange(map, 4, 13)!;
		expect("> [!note]\n> Some text".slice(r[0], r[1])).toBe("Some text");
	});
	it("removes the highlights a stretch touches", () => {
		const s = 'a ==b== c <mark style="background: red;">d</mark> ==e==';
		expect(unhighlight(s, 2, 7)).toBe('a b c <mark style="background: red;">d</mark> ==e==');
		expect(unhighlight(s, 0, s.length)).toBe("a b c d e");
	});
	it("recolors a highlight instead of nesting another", () => {
		expect(rehighlight("a ==b c== d", 4, 5, { color: "#ffd43b" })).toBe('a <mark style="background: #ffd43b;">b c</mark> d');
		expect(rehighlight("a b c", 2, 3, { color: "" })).toBe("a ==b== c");
	});
	it("doesn't land inside an earlier colored mark", () => {
		const source = 'a <mark style="background: #74c0fc80;">b</mark> cat';
		const rendered = "a b cat";
		const r = locate(rendered, source, 4, 7)!;
		expect(source.slice(r[0], r[1])).toBe("cat");
		const next = rehighlight(source, r[0], r[1], { color: "" });
		expect(withoutHighlights(next)).toBe(withoutHighlights(source));
	});
	it("keeps the first letter after a long link", () => {
		const source = "see [docs](https://example.com/a/very/long/path/that/goes/on/and/on/forever) word here";
		const rendered = "see docs word here";
		const from = rendered.indexOf("word");
		const r = locate(rendered, source, from, from + 4)!;
		expect(source.slice(r[0], r[1])).toBe("word");
	});
	it("an extra rendered space doesn't shift the words", () => {
		const source = "The brown fox";
		const rendered = "\nThe brown fox";
		const r = sourceRange(align(rendered, source), 5, 10)!;
		expect(source.slice(r[0], r[1])).toBe("brown");
	});
	it("picks the same occurrence of a repeated word", () => {
		const source = "go **go** go";
		const rendered = "go go go";
		const r = locate(rendered, source, 6, 8)!;
		expect(r).toEqual([10, 12]);
	});
	it("treats right-to-left letters with marks as one word", () => {
		const text = "\u05E9\u05C1\u05B8\u05DC\u05D5\u05B9\u05DD x";
		expect(toWords(text, 2, 3)).toEqual([0, 7]);
	});
});
