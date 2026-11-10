import { describe, expect, it } from "vitest";
import { escapeMarkdown, plainTitle, titleMarkdown } from "./title-text";

const MARKED = '(📖)se il calcolo invece è <mark style="background: #ffd43b80;">più grande</mark>';

describe("card titles", () => {
	it("keeps the first line's formatting for rendering", () => {
		expect(titleMarkdown(`${MARKED}\nsecond line`)).toBe(MARKED);
		expect(titleMarkdown("\n## **Bold** ==mark==")).toBe("**Bold** ==mark==");
		expect(titleMarkdown("- [ ] a task")).toBe("a task");
		expect(titleMarkdown("> quoted <span style=\"color: #e03131;\">red</span>")).toBe('quoted <span style="color: #e03131;">red</span>');
		expect(titleMarkdown("See ![[pic.png]] and ![alt](x.png)")).toBe("See [[pic.png]] and alt");
	});

	it("gives plain text without tags, marks or entities", () => {
		expect(plainTitle(MARKED)).toBe("(📖)se il calcolo invece è più grande");
		expect(plainTitle('<span style="color: #e03131;">**red**</span> &amp; ==blue==')).toBe("red & blue");
		expect(plainTitle("## Beta-blockers\n\n[[x.canvas#a|Link]]")).toBe("Beta-blockers");
		expect(plainTitle("See [[Notes/Drug A|drug A]] and [[Notes/Drug B]]")).toBe("See drug A and Drug B");
	});

	it("escapes a plain name so it renders as written", () => {
		expect(escapeMarkdown("my_file *draft* <1>")).toBe("my\\_file \\*draft\\* \\<1\\>");
	});
});
