import { describe, expect, it } from "vitest";
import { blockAt } from "./block";

const note = [
	"---",
	"tags: [x]",
	"---",
	"# Title",
	"",
	"First paragraph line one",
	"line two of it.",
	"",
	"- Parent",
	"\t- Child A",
	"\t  more of A",
	"\t\t- Grandchild",
	"\t- Child B",
	"- Lone bullet",
	"  continued text",
	"",
	"```",
	"# not a heading",
	"- not a bullet",
	"```",
	"## Section",
	"text in section",
].map((l) => l);

describe("blockAt", () => {
	it("a bullet takes everything nested under it", () => {
		expect(blockAt(note, 8)).toEqual({ from: 8, to: 12, text: "- Parent\n\t- Child A\n\t  more of A\n\t\t- Grandchild\n\t- Child B" });
		expect(blockAt(note, 9)!.text).toBe("- Child A\n  more of A\n\t- Grandchild");
	});

	it("a lone bullet loses its marker; its text lines belong to it", () => {
		expect(blockAt(note, 13)!.text).toBe("Lone bullet\ncontinued text");
		expect(blockAt(note, 14)).toMatchObject({ from: 13, to: 14 });
		expect(blockAt(note, 11)!.text).toBe("Grandchild");
		expect(blockAt(note, 10)).toMatchObject({ from: 9, to: 11 });
	});

	it("a paragraph runs between blank lines", () => {
		expect(blockAt(note, 6)).toEqual({ from: 5, to: 6, text: "First paragraph line one\nline two of it." });
	});

	it("a heading takes its section; fenced code is not structure", () => {
		expect(blockAt(note, 20)).toEqual({ from: 20, to: 21, text: "## Section\ntext in section" });
		expect(blockAt(note, 18)).toMatchObject({ from: 16, to: 19 });
		expect(blockAt(note, 3)!.to).toBe(21);
	});

	it("blank lines and front matter are no block", () => {
		expect(blockAt(note, 4)).toBeNull();
		expect(blockAt(note, 1)).toBeNull();
	});
});
