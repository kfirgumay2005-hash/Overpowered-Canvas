import { describe, expect, it } from "vitest";
import fixture from "../../../test-fixtures/adpkd-outline.md?raw";
import { countItems, normalizeText, parseOutline, stripFrontmatter, writeOutline, type OutlineItem } from "./outline";


const spaces = { indent: "    ", ids: false };

/** Text and nesting only. */
function shape(items: OutlineItem[]): unknown[] {
	return items.map((i) => [i.kind, i.text, ...(i.id ? [i.id] : []), shape(i.children)]);
}

function depth(items: OutlineItem[]): number {
	return items.length ? 1 + Math.max(...items.map((i) => depth(i.children))) : 0;
}

describe("parseOutline", () => {
	it("reads the ADPKD note: one root heading, 157 nested items, 9 levels deep", () => {
		const items = parseOutline(fixture);
		expect(items).toHaveLength(1);
		expect(items[0]!.heading).toBe(1);
		expect(items[0]!.text).toBe("Malattia policistica renale autosomica dominante (ADPKD)");
		expect(countItems(items)).toBe(158);
		expect(depth(items)).toBe(9);
		expect(items[0]!.children.map((c) => c.text)).toEqual(["Gen", "Pat", "Diagnosi", "Terapia"]);
	});

	it("keeps block references and links verbatim", () => {
		const text = JSON.stringify(parseOutline(fixture));
		expect(text).toContain("iperproliferant ^mark-db34131a-6797-6438");
		const pdf = parseOutline("# R\n- [[Nefro.pdf#page=4&selection=1,2,3|Nefro, p.4]] causa più comune ^mark-1\n");
		expect(pdf[0]!.children[0]!.text).toBe("[[Nefro.pdf#page=4&selection=1,2,3|Nefro, p.4]] causa più comune ^mark-1");
	});

	it("nests headings, bullets of every kind, tabs and 2-space indents", () => {
		const md = "# A\n## B\n+ b1\n\t* b2\n\t\t1. b3\n  2) b4\n### C\n# D\n- d1\n  - d2\n";
		expect(shape(parseOutline(md))).toEqual([
			["node", "A", [["node", "B", [["node", "b1", [["node", "b2", [["node", "b3", []]]], ["node", "b4", []]]], ["node", "C", []]]]]],
			["node", "D", [["node", "d1", [["node", "d2", []]]]]],
		]);
	});

	it("reads ids, groups and the free-cards heading", () => {
		const md = "# G %%g:ab12%%\n- loose %%n:c1c1%%\n## Root %%n:r1r1%%\n- child %%n:k1k1%%\n# Free cards %%free%%\n- alone %%n:f1f1%%\n";
		expect(shape(parseOutline(md))).toEqual([
			["group", "G", "ab12", [["node", "loose", "c1c1", []], ["node", "Root", "r1r1", [["node", "child", "k1k1", []]]]]],
			["free", "Free cards", [["node", "alone", "f1f1", []]]],
		]);
	});

	it("treats plain paragraphs as items, and text right under a card heading as its text", () => {
		const md = "Intro line\nsame paragraph\n\nSecond\n# Root\nmore root text\n\n- child\n\nAfter the list\n";
		expect(shape(parseOutline(md))).toEqual([
			["node", "Intro line\nsame paragraph", []],
			["node", "Second", []],
			["node", "Root\nmore root text", [["node", "child", []], ["node", "After the list", []]]],
		]);
	});

	it("follows lazy continuation and indented paragraphs inside a bullet", () => {
		const md = "- first\nlazy\n\n  second paragraph\n- next\n";
		expect(shape(parseOutline(md))).toEqual([
			["node", "first\nlazy\n\nsecond paragraph", []],
			["node", "next", []],
		]);
	});

	it("does not glue consecutive lines together", () => {
		const items = parseOutline("- alpha\n  beta\n");
		expect(items[0]!.text).toBe("alpha\nbeta");
	});

	it("ignores front matter when asked to strip it", () => {
		const { frontmatter, body } = stripFrontmatter("---\ntags: [a]\nnota: x\n---\n# R\n- nota: not a property\n");
		expect(frontmatter).toBe("---\ntags: [a]\nnota: x\n---\n");
		expect(shape(parseOutline(body))).toEqual([["node", "R", [["node", "nota: not a property", []]]]]);
	});
});

describe("writeOutline", () => {
	it("round-trips the ADPKD note exactly", () => {
		expect(writeOutline(parseOutline(fixture), spaces)).toBe(fixture);
	});

	it("uses the configured indentation", () => {
		const items = parseOutline(fixture);
		const tabs = writeOutline(items, { indent: "\t", ids: false });
		expect(tabs).toContain("\n\t- Gen\n");
		expect(shape(parseOutline(tabs))).toEqual(shape(items));
		const two = writeOutline(items, { indent: "  ", ids: false });
		expect(shape(parseOutline(two))).toEqual(shape(items));
	});

	const tricky: [string, string][] = [
		["two lines", "alpha\nbeta"],
		["blank lines inside", "first\n\n\nafter two blanks"],
		["a list inside the card", "Steps:\n- one\n  - nested\n1. numbered\n2) other\n+ plus\n* star"],
		["headings inside the card", "Title\n# not a heading\n###### six"],
		["backslashes", "\\- already escaped\n\\\\ two\n\\(x\\) math"],
		["fenced code", "Code:\n```js\n- not a bullet\n# not a heading\n\n  indented\n```\nafter"],
		["tilde fence", "~~~\n* x\n~~~"],
		["right-to-left text", "שלום עולם\nمرحبا بالعالم\n- רשימה"],
		["indented lines", "a\n    deeply indented\n\tTabbed"],
		["empty first line", "\nsecond"],
		["percent signs", "50% %% not an id %%\n%%n:fake%% literal"],
		["embeds and links", "![[image.png]]\n[[file.pdf#page=4|p.4]] ^mark-x"],
	];
	for (const [name, text] of tricky)
		it(`keeps multi-line card text: ${name}`, () => {
			const items: OutlineItem[] = [
				{
					kind: "node",
					text: "Root\n- not a child\nsecond line",
					id: "r00t",
					heading: 1,
					children: [
						{ kind: "node", text, id: "c1c1", children: [{ kind: "node", text, id: "c2c2", children: [] }] },
						{ kind: "node", text: "sibling", id: "s1s1", children: [] },
					],
				},
			];
			for (const indent of ["\t", "    ", "  "]) {
				const md = writeOutline(items, { indent, ids: true });
				expect(shape(parseOutline(md)), md).toEqual(shape(items));
			}
		});

	it("writes ids as hidden comments and free-cards headings last", () => {
		const md = writeOutline(
			[
				{ kind: "node", text: "R", id: "r1r1", heading: 1, children: [{ kind: "node", text: "c", id: "c1c1", children: [] }] },
				{ kind: "free", text: "Free cards", heading: 1, children: [{ kind: "node", text: "f", id: "f1f1", children: [] }] },
			],
			{ indent: "\t", ids: true },
		);
		expect(md).toBe("# R %%n:r1r1%%\n- c %%n:c1c1%%\n\n# Free cards %%free%%\n- f %%n:f1f1%%\n");
	});
});

describe("normalizeText", () => {
	it("ignores trailing spaces and outer blank lines only", () => {
		expect(normalizeText("  a  \nb \n\n")).toBe("a\nb");
		expect(normalizeText("a\n\nb")).toBe("a\n\nb");
	});
});
