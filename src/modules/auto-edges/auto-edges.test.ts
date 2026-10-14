import { describe, expect, it } from "vitest";
import { desiredAutoEdges, linkPath } from "./logic";

describe("linkPath", () => {
	it("extracts the target of wikilinks and plain values", () => {
		expect(linkPath("[[Note B]]")).toBe("Note B");
		expect(linkPath("[[folder/Note B|alias]]")).toBe("folder/Note B");
		expect(linkPath("[[Note B#Heading]]")).toBe("Note B");
		expect(linkPath("Note C")).toBe("Note C");
		expect(linkPath("")).toBeNull();
		expect(linkPath(42)).toBeNull();
	});
});

describe("desiredAutoEdges", () => {
	const resolve = (link: string) => ({ "Note B": "b.md", "Note C": "c.md" })[link] ?? null;
	it("links note cards listed in the property", () => {
		const edges = desiredAutoEdges(
			[
				{ id: "A", path: "a.md", property: ["[[Note B]]", "[[Note C]]", "[[Missing]]"] },
				{ id: "B", path: "b.md", property: "[[Note C]]" },
				{ id: "C", path: "c.md", property: undefined },
			],
			resolve,
		);
		expect([...edges.keys()].sort()).toEqual(["A->B", "A->C", "B->C"]);
	});

	it("connects to every card of a note shown twice, never to itself", () => {
		const edges = desiredAutoEdges(
			[
				{ id: "A", path: "a.md", property: ["[[Note B]]"] },
				{ id: "B1", path: "b.md", property: null },
				{ id: "B2", path: "b.md", property: "[[Note B]]" },
			],
			resolve,
		);
		expect([...edges.keys()].sort()).toEqual(["A->B1", "A->B2", "B2->B1"]);
	});
});
