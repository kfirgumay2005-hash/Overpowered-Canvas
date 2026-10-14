import { describe, expect, it } from "vitest";
import { diffMembers, formatProperties, matchesQuery, parseList, parseProperties } from "./logic";

const note = { path: "Projects/Alpha.md", tags: ["project/alpha", "Work"], frontmatter: { status: "doing", owner: "Dana" }, links: ["People/Dana.md", "Specs/API.md"] };

describe("query groups", () => {
	it("matches tags, folders, properties and links", () => {
		expect(matchesQuery(note, { tags: ["project"] })).toBe(true);
		expect(matchesQuery(note, { tags: ["#work", "project/alpha"] })).toBe(true);
		expect(matchesQuery(note, { tags: ["proj"] })).toBe(false);
		expect(matchesQuery(note, { folder: "Projects" })).toBe(true);
		expect(matchesQuery(note, { folder: "/projects/" })).toBe(true);
		expect(matchesQuery(note, { folder: "Proj" })).toBe(false);
		expect(matchesQuery(note, { properties: [{ key: "status", value: "Doing" }] })).toBe(true);
		expect(matchesQuery(note, { properties: [{ key: "owner" }] })).toBe(true);
		expect(matchesQuery(note, { properties: [{ key: "due" }] })).toBe(false);
		expect(matchesQuery(note, { linksTo: ["Dana"] })).toBe(true);
		expect(matchesQuery(note, { linksTo: ["Specs/API"] })).toBe(true);
		expect(matchesQuery(note, { linksTo: ["Other"] })).toBe(false);
		expect(matchesQuery(note, { tags: ["work"], folder: "Archive" })).toBe(false);
	});

	it("matches nothing with an empty query", () => {
		expect(matchesQuery(note, {})).toBe(false);
		expect(matchesQuery(note, { auto: true })).toBe(false);
	});

	it("parses the editor fields", () => {
		expect(parseList("a, #b , [[c]],")).toEqual(["a", "b", "c"]);
		expect(parseProperties("status: doing\nowner\n: x\n")).toEqual([{ key: "status", value: "doing" }, { key: "owner" }]);
		expect(formatProperties([{ key: "status", value: "doing" }, { key: "owner" }])).toBe("status: doing\nowner");
	});

	it("diffs members", () => {
		expect(diffMembers(["a.md", "b.md"], ["b.md", "c.md"], new Set(["a.md", "b.md"]))).toEqual({ add: ["c.md"], remove: ["a.md"] });
	});
});
