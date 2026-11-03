import { describe, expect, it } from "vitest";
import { inlinePageLinks, outlinePageLinks, withoutTrailingLinks } from "./page-links";

const targets = new Set(["anchor1", "root1"]);
const link = "[[Map.canvas#root1|Link]]";

describe("page links in a note", () => {
	it("puts a page link at the end of the card's line", () => {
		expect(inlinePageLinks(`Etiology\n\n${link}`, targets)).toBe(`Etiology ${link}`);
	});
	it("keeps the rest of a longer card under its first line", () => {
		expect(inlinePageLinks(`Title\nmore text\n\n${link}`, targets)).toBe(`Title ${link}\nmore text`);
	});
	it("leaves other links, and a card that is only a link, alone", () => {
		expect(inlinePageLinks("A\n\n[[Other#x|y]]", targets)).toBe("A\n\n[[Other#x|y]]");
		expect(inlinePageLinks(link, targets)).toBe(link);
	});
	it("takes a card that is both a page's root and a break point", () => {
		const both = "Genetics\n\n[[Map.canvas#anchor1|Back]]\n\n[[Map.canvas#root1|Link]]";
		expect(inlinePageLinks(both, targets)).toBe("Genetics [[Map.canvas#anchor1|Back]] [[Map.canvas#root1|Link]]");
	});
	it("gives the board's form back", () => {
		for (const text of [`Etiology\n\n${link}`, `Title\nmore text\n\n${link}`]) expect(outlinePageLinks(inlinePageLinks(text, targets), targets)).toBe(text);
		expect(outlinePageLinks("No [[Other#x|links]] here", targets)).toBe("No [[Other#x|links]] here");
	});
	it("takes the links off a page's title", () => {
		expect(withoutTrailingLinks(`Etiology ${link}`)).toBe("Etiology");
		expect(withoutTrailingLinks(link)).toBe(link);
	});
});
