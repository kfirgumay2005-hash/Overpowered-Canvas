import { describe, expect, it } from "vitest";
import { buildCanvasMetadata, readFrontmatter } from "./build";

const pos = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 5, offset: 5 } };

describe("readFrontmatter", () => {
	it("reads x-opc.frontmatter", () => {
		expect(readFrontmatter({ "x-opc": { v: 1, frontmatter: { tags: ["a"] } } })).toEqual({ tags: ["a"] });
	});
	it("ignores missing, empty or invalid frontmatter", () => {
		expect(readFrontmatter({})).toBeUndefined();
		expect(readFrontmatter({ "x-opc": { v: 1, frontmatter: {} } })).toBeUndefined();
		expect(readFrontmatter({ "x-opc": { v: 1, frontmatter: { x: Number.NaN } } })).toBeUndefined();
		expect(readFrontmatter(null)).toBeUndefined();
	});
});

describe("buildCanvasMetadata", () => {
	it("merges text-node caches, file embeds and frontmatter", () => {
		const meta = buildCanvasMetadata(
			{ "x-opc": { v: 1, frontmatter: { tags: ["project"], related: ["[[Plan|the plan]]", "plain"], owner: "[[Dana]]" } } },
			{
				embeds: [{ file: "notes/a.md" }, { file: "notes/b.md", subpath: "#Intro" }],
				caches: {
					n1: { links: [{ link: "x", original: "[[x]]", position: pos }], tags: [{ tag: "#t", position: pos }] },
					n2: { embeds: [{ link: "img.png", original: "![[img.png]]", position: pos }], headings: [{ heading: "H", level: 1, position: pos }] },
				},
			},
		);
		expect(meta.links?.map((l) => l.link)).toEqual(["x"]);
		expect(meta.embeds?.map((l) => l.link)).toEqual(["img.png", "notes/a.md", "notes/b.md#Intro"]);
		expect(meta.tags?.map((t) => t.tag)).toEqual(["#t"]);
		expect(meta.headings?.map((h) => h.heading)).toEqual(["H"]);
		expect(meta.frontmatter).toEqual({ tags: ["project"], related: ["[[Plan|the plan]]", "plain"], owner: "[[Dana]]" });
		expect(meta.frontmatterLinks).toEqual([
			{ key: "related.0", link: "Plan", original: "[[Plan|the plan]]", displayText: "the plan" },
			{ key: "owner", link: "Dana", original: "[[Dana]]", displayText: "Dana" },
		]);
	});

	it("returns an empty object for a plain canvas without index data", () => {
		expect(buildCanvasMetadata({ nodes: [] }, null)).toEqual({});
	});
});
