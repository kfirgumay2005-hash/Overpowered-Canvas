import { describe, expect, it } from "vitest";
import { align, highlight, rehighlight, sourceRange, toWords, unhighlight } from "./source";

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
});
