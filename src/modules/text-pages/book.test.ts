import { describe, expect, it } from "vitest";
import type { CanvasFileData, CanvasNodeData } from "../../data/json-canvas";
import { buildBook, headingMarkdown, withCardText, type BookItem } from "./book";

const card = (id: string, text: string, y: number, page?: string, x = 0): CanvasNodeData => ({ id, type: "text", text, x, y, width: 100, height: 50, ...(page ? { "x-opc": { v: 1, page } } : {}) }) as CanvasNodeData;
const edge = (from: string, to: string) => ({ id: `${from}-${to}`, fromNode: from, toNode: to });
const options = { rtl: false, mainTitle: "Main", untitled: "Untitled", freeLabel: "Loose" };

/** Text of the items as an indented list (`#` marks headings). */
function shape(items: BookItem[], depth = 0): string[] {
	return items.flatMap((i) => [`${"  ".repeat(depth)}${i.heading ? "#".repeat(i.heading) + " " : ""}${i.text}`, ...shape(i.children, depth + 1)]);
}

const board: CanvasFileData = {
	nodes: [
		card("root", "Heart", 0),
		card("a", "Valves\n\n[[b.canvas#proot|Link]]", 100),
		card("b", "Chambers", 200),
		card("other", "Lung", 500),
		card("loose", "A note", 900),
		card("proot", "Valves\n\n[[b.canvas#a|Link]]", 0, "p1", 2000),
		card("pkid", "Mitral", 100, "p1", 2300),
		{ id: "ink", type: "text", text: "", x: 0, y: 0, width: 10, height: 10, "x-opc": { v: 1, kind: "ink" } } as CanvasNodeData,
	],
	edges: [edge("root", "a"), edge("root", "b"), edge("other", "loose2"), edge("proot", "pkid")],
	"x-opc": { v: 1, pages: [{ id: "p1", anchor: "a", root: "proot" }] },
} as CanvasFileData;

describe("buildBook", () => {
	it("makes one text page per canvas page, parents first", () => {
		const book = buildBook(board, options);
		expect(book.pages.map((p) => [p.id, p.title])).toEqual([["", "Main"], ["p1", "Valves"]]);
	});

	it("turns each map into a heading with nested bullets, without drawings", () => {
		const book = buildBook(board, options);
		expect(shape(book.pages[0]!.items)).toEqual(["# Heart", "  Valves", "  Chambers", "# Loose", "  Lung", "  A note"]);
	});

	it("gives every independent map its own heading", () => {
		const book = buildBook({ nodes: [card("a", "One", 0), card("b", "Kid", 100), card("c", "Two", 500), card("d", "Kid 2", 600)], edges: [edge("a", "b"), edge("c", "d")] }, options);
		expect(shape(book.pages[0]!.items)).toEqual(["# One", "  Kid", "# Two", "  Kid 2"]);
	});

	it("marks the cards that lead to a page and takes their link line away", () => {
		const page = buildBook(board, options).pages[0]!;
		const anchor = page.items[0]!.children[0]!;
		expect(anchor).toMatchObject({ id: "a", text: "Valves", opens: "p1" });
		expect(anchor.source).toContain("[[b.canvas#proot|Link]]");
	});

	it("starts a page with its root and knows the way back", () => {
		const page = buildBook(board, options).pages[1]!;
		expect(page).toMatchObject({ parent: "", anchor: "a" });
		expect(shape(page.items)).toEqual(["# Valves", "  Mitral"]);
	});

	it("nests page parents", () => {
		const data: CanvasFileData = {
			nodes: [card("r", "R", 0), card("a", "A", 100), card("pr", "A", 0, "p1"), card("b", "B", 100, "p1"), card("qr", "B", 0, "q1"), card("c", "C", 100, "q1")],
			edges: [edge("r", "a"), edge("pr", "b"), edge("qr", "c")],
			"x-opc": { v: 1, pages: [{ id: "p1", anchor: "a", root: "pr" }, { id: "q1", anchor: "b", root: "qr", parent: "p1" }] },
		} as CanvasFileData;
		const book = buildBook(data, options);
		expect(book.pages.map((p) => [p.id, p.parent])).toEqual([["", undefined], ["p1", ""], ["q1", "p1"]]);
		expect(book.pageOf.get("c")).toBe("q1");
	});

	it("keeps a page's root as its heading when it stands alone", () => {
		const data: CanvasFileData = {
			nodes: [card("r", "R", 0), card("a", "A", 100), card("pr", "A", 0, "p1")],
			edges: [edge("r", "a")],
			"x-opc": { v: 1, pages: [{ id: "p1", anchor: "a", root: "pr" }] },
		} as CanvasFileData;
		expect(shape(buildBook(data, options).pages[1]!.items)).toEqual(["# A"]);
	});

	it("shows cards of a page that is gone on the main page", () => {
		const book = buildBook({ nodes: [card("a", "A", 0, "gone"), card("b", "B", 100, "gone")], edges: [edge("a", "b")] }, options);
		expect(shape(book.pages[0]!.items)).toEqual(["# A", "  B"]);
	});

	it("handles an empty canvas", () => {
		expect(buildBook({}, options).pages).toMatchObject([{ id: "", items: [] }]);
	});
});

describe("headingMarkdown", () => {
	it("does not double the marks of a card that has a heading", () => {
		expect(headingMarkdown("# Title\nmore", 1)).toBe("# Title\nmore");
		expect(headingMarkdown("Title", 2)).toBe("## Title");
		expect(headingMarkdown("## Title", 1)).toBe("# Title");
	});
});

describe("withCardText", () => {
	it("replaces a card's text and keeps everything else", () => {
		const raw = JSON.stringify({ nodes: [{ id: "a", type: "text", text: "old", extra: 1 }], edges: [], "x-opc": { v: 1 } });
		expect(JSON.parse(withCardText(raw, "a", "new")!)).toEqual({ nodes: [{ id: "a", type: "text", text: "new", extra: 1 }], edges: [], "x-opc": { v: 1 } });
	});
	it("refuses anything but a text card", () => {
		expect(withCardText(JSON.stringify({ nodes: [{ id: "a", type: "file" }] }), "a", "x")).toBeNull();
		expect(withCardText(JSON.stringify({ nodes: [] }), "a", "x")).toBeNull();
	});
});
