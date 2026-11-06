import { describe, expect, it } from "vitest";
import { align, highlight, locate, pickedRange, recolor, rehighlight, sourceRange, toWords, uncolor, unhighlight, withoutColors, withoutHighlights } from "./source";

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

describe("text color", () => {
	const red = "#e03131";
	const blue = "#1971c2";
	const at = (source: string, words: string): [number, number] => {
		const i = source.indexOf(words);
		return [i, i + words.length];
	};
	it("colors the picked words with a span", () => {
		expect(recolor("one two three", ...at("one two three", "two"), red)).toBe(`one <span style="color: ${red};">two</span> three`);
	});
	it("goes inside the formatting around the words", () => {
		expect(recolor("a **bold** b", ...at("a **bold** b", "bold"), red)).toBe(`a **<span style="color: ${red};">bold</span>** b`);
	});
	it("recolors instead of nesting a second color", () => {
		const once = recolor("one two three", ...at("one two three", "two"), red);
		const twice = recolor(once, ...at(once, "two"), blue);
		expect(twice).toBe(`one <span style="color: ${blue};">two</span> three`);
		expect(withoutColors(twice)).toBe("one two three");
	});
	it("widens over a color it cuts through", () => {
		const once = recolor("one two three", ...at("one two three", "two three"), red);
		const [, end] = at(once, "two");
		const start = once.indexOf("one");
		expect(recolor(once, start, end, blue)).toBe(`<span style="color: ${blue};">one two three</span>`);
	});
	it("keeps highlights whole: inside one, or around one it cuts through", () => {
		const marked = "a ==b c== d";
		// Inside the highlight: the color nests in it.
		expect(recolor(marked, ...at(marked, "b"), red)).toBe(`a ==<span style="color: ${red};">b</span> c== d`);
		// Across its edge: the whole highlight is taken in.
		const [s] = at(marked, "c");
		const [, e] = at(marked, "d");
		expect(recolor(marked, s, e, red)).toBe(`a <span style="color: ${red};">==b c== d</span>`);
	});
	it("a highlight across a color's edge takes the color in whole", () => {
		const colored = recolor("a b c d", ...at("a b c d", "b c"), red);
		const [s] = at(colored, "c");
		const [, e] = at(colored, "d");
		const out = rehighlight(colored, s, e, { color: "" });
		expect(out).toBe(`a ==<span style="color: ${red};">b c</span> d==`);
		expect(withoutColors(withoutHighlights(out))).toBe("a b c d");
	});
	it("colors line by line, keeping list markers out", () => {
		const list = "- one\n- two";
		expect(recolor(list, ...at(list, "one\n- two"), red)).toBe(`- <span style="color: ${red};">one</span>\n- <span style="color: ${red};">two</span>`);
	});
	it("removes the colors a stretch touches, and only colors", () => {
		const both = `<span style="color: ${red};">x</span> ==y== <span style="color: ${blue};">z</span>`;
		expect(uncolor(both, 0, both.length)).toBe("x ==y== z");
		expect(uncolor(both, 0, 3)).toBe(`x ==y== <span style="color: ${blue};">z</span>`);
	});
	it("maps rendered words back through colored text", () => {
		const source = `alpha <span style="color: ${red};">beta</span> gamma`;
		const rendered = "alpha beta gamma";
		expect(locate(rendered, source, 11, 16)).toEqual([source.indexOf("gamma"), source.length]);
	});
	it("leaves other spans alone", () => {
		const other = `<span class="x">keep</span>`;
		expect(withoutColors(other)).toBe(other);
	});
});

describe("pickedRange", () => {
	it("a swipe marks exactly the letters swiped, either way round", () => {
		expect(pickedRange("Hello wonderful world", 8, 11, false)).toEqual([8, 12]);
		expect(pickedRange("Hello wonderful world", 11, 8, false)).toEqual([8, 12]);
		expect(pickedRange("שלום עולם", 6, 7, false)).toEqual([6, 8]);
	});
	it("a tap marks the whole word under it", () => {
		expect(pickedRange("Hello wonderful world", 9, 9, true)).toEqual([6, 15]);
		expect(pickedRange("שלום עולם", 6, 6, true)).toEqual([5, 9]);
	});
	it("leaves spaces at the ends out", () => {
		expect(pickedRange("ab cd", 1, 3, false)).toEqual([1, 4]);
		expect(pickedRange("ab cd", 2, 2, false)).toEqual([3, 3]);
	});
});
