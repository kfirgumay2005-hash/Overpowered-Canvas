import { describe, expect, it } from "vitest";
import { branchOf, cardLink, freeRegion, pageChildren, pageDepth, pagePath, titleOf, withLink, withoutLink, withoutPage, type PlanNode } from "./logic";

const n = (id: string, x: number, y: number, extra: Partial<PlanNode> = {}): PlanNode => ({ id, x, y, width: 100, height: 40, group: false, page: "", ...extra });

describe("the branch that moves to a page", () => {
	// root → treat → beta → (b1, b2), treat → ace; a group around b1 and b2; a mark on b2.
	const nodes = [
		n("root", 0, 0),
		n("treat", 200, 0),
		n("beta", 400, 0),
		n("g", 580, -20, { width: 200, height: 160, group: true }),
		n("b1", 600, 0),
		n("b2", 600, 80),
		n("ink", 610, 90, { width: 20, height: 20, stuckTo: "b2" }),
		n("ace", 400, 200),
		n("other", 600, 400, { page: "p1" }),
	];
	const edges = [
		{ from: "root", to: "treat" },
		{ from: "treat", to: "beta" },
		{ from: "treat", to: "ace" },
		{ from: "beta", to: "b1" },
		{ from: "beta", to: "b2" },
		{ from: "b2", to: "other" },
	];
	it("takes the cards below the anchor, their group and marks, not the anchor", () => {
		expect(branchOf(nodes, edges, "beta").sort()).toEqual(["b1", "b2", "g", "ink"]);
	});
	it("stays on the anchor's page", () => {
		expect(branchOf(nodes, edges, "beta")).not.toContain("other");
	});
	it("a group reached through an edge takes what it holds", () => {
		const linked = [...edges, { from: "ace", to: "g" }];
		expect(branchOf(nodes, linked, "ace").sort()).toEqual(["b1", "b2", "g", "ink"]);
	});
	it("is empty for a card without children", () => {
		expect(branchOf(nodes, edges, "ace")).toEqual([]);
	});
});

describe("links between a card and its page", () => {
	it("adds a link on its own line and takes it away again", () => {
		const link = cardLink("Maps/Hypertension.canvas", "abc123", "Link");
		expect(link).toBe("[[Maps/Hypertension.canvas#abc123|Link]]");
		const text = withLink("Beta-blockers\n", link);
		expect(text).toBe("Beta-blockers\n\n[[Maps/Hypertension.canvas#abc123|Link]]");
		expect(withoutLink(text, "abc123")).toBe("Beta-blockers");
		expect(withoutLink("a [[x.canvas#abc123]] b", "abc123")).toBe("ab");
		expect(withoutLink(text, "zzz")).toBe(text);
	});
	it("titles skip heading marks and show link text", () => {
		expect(titleOf("## Beta-blockers\n\n[[x.canvas#a|Link]]")).toBe("Beta-blockers");
		expect(titleOf("See [[Notes/Drug A|drug A]] and [[Notes/Drug B]]")).toBe("See drug A and Drug B");
	});
});

describe("the page tree", () => {
	const pages = [
		{ id: "a", anchor: "x", root: "y" },
		{ id: "b", anchor: "y2", root: "z", parent: "a" },
		{ id: "c", anchor: "z2", root: "w", parent: "b" },
	];
	it("knows each page's path and depth", () => {
		expect(pagePath(pages, "c").map((p) => p.id)).toEqual(["a", "b", "c"]);
		expect(pageDepth(pages, "b")).toBe(2);
		expect(pageChildren(pages).get("")!.map((p) => p.id)).toEqual(["a"]);
	});
	it("merging a page hands its pages to its parent", () => {
		expect(withoutPage(pages, "b")).toEqual([
			{ id: "a", anchor: "x", root: "y" },
			{ id: "c", anchor: "z2", root: "w", parent: "a" },
		]);
	});
	it("puts a new page right of everything", () => {
		expect(freeRegion([n("a", -50, 20), n("b", 300, -10)])).toEqual({ x: 1400, y: -10 });
	});
});
