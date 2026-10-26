import ELK from "elkjs/lib/elk.bundled.js";
import { describe, expect, it } from "vitest";
import fixture from "../../../test-fixtures/adpkd-outline.md?raw";
import type { CanvasFileData, CanvasNodeData } from "../../data/json-canvas";
import type { ElkLike } from "../auto-layout/layout";
import { applyNote, type ApplyOptions } from "./apply";
import { exportNote, splitNote } from "./note";
import { writeOutline, type OutlineItem } from "./outline";
import { buildStructure } from "./structure";

const elk = new ELK() as unknown as ElkLike;


function options(over: Partial<ApplyOptions> = {}): ApplyOptions {
	let n = 0;
	return {
		layout: "right",
		rtl: false,
		spacing: 30,
		levelSpacing: 80,
		newId: () => `new${String(n++).padStart(4, "0")}`,
		resolveFile: (link) => (link === "pic.png" || link === "docs/pic.png" ? "docs/pic.png" : null),
		textWidth: 320,
		fileSize: { width: 400, height: 300 },
		...over,
	};
}

const exportOpts = { canvasPath: "Maps/ADPKD.canvas", rtl: false, freeLabel: "Free cards", indent: "    " };

function overlap(nodes: CanvasNodeData[]): boolean {
	const cards = nodes.filter((n) => n.type !== "group");
	for (let i = 0; i < cards.length; i++)
		for (let j = i + 1; j < cards.length; j++) {
			const a = cards[i]!;
			const b = cards[j]!;
			if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) return true;
		}
	return false;
}

const text = (id: string, t: string, x: number, y: number, extra: Partial<CanvasNodeData> = {}): CanvasNodeData => ({ id, type: "text", text: t, x, y, width: 200, height: 60, ...extra });

/** A board with most things a canvas can hold. */
function sampleCanvas(): CanvasFileData {
	return {
		nodes: [
			{ id: "grp00001", type: "group", label: "Section A", x: -100, y: -100, width: 1400, height: 700, color: "2" },
			text("root0001", "ADPKD", 0, 200, { color: "4", "x-opc": { shape: "terminal" } }),
			text("kid00001", "Gen\nsecond line\n\n- not a child", 300, 0),
			text("kid00002", "[[Nefro.pdf#page=4|p.4]] Terapia ^mark-1", 300, 300, { "x-opc": { kind: "sticky" }, color: "#ffd43b" }),
			text("gkid0001", "שלום — right-to-left", 600, 300),
			{ id: "file0001", type: "file", file: "docs/pic.png", subpath: "#x", x: 600, y: 0, width: 200, height: 150 },
			text("loose001", "loose in group", 1000, 400),
			text("map20001", "Second map", 0, 900),
			{ id: "link0001", type: "link", url: "https://example.org/a", x: 300, y: 900, width: 300, height: 200 },
			text("free0001", "a free idea", 0, 1300),
			text("ink00001", "✏️", 900, 1300, { "x-opc": { kind: "ink", strokes: [{ id: "s", tool: "pen", color: "#000", size: 4, pts: [0, 0, 0.5, 10, 10, 0.5] }] } }),
		],
		edges: [
			{ id: "e1", fromNode: "root0001", fromSide: "right", toNode: "kid00001", toSide: "left", color: "4" },
			{ id: "e2", fromNode: "root0001", fromSide: "right", toNode: "kid00002", toSide: "left", label: "therapy" },
			{ id: "e3", fromNode: "kid00002", fromSide: "right", toNode: "gkid0001", toSide: "left", "x-opc": { path: "dotted" } },
			{ id: "e4", fromNode: "kid00001", fromSide: "right", toNode: "file0001", toSide: "left" },
			{ id: "e5", fromNode: "gkid0001", fromSide: "top", toNode: "kid00001", toSide: "bottom" }, // cross edge (cycle)
			{ id: "e6", fromNode: "map20001", fromSide: "right", toNode: "link0001", toSide: "left" },
			{ id: "e7", fromNode: "link0001", fromSide: "bottom", toNode: "free0001", toSide: "top", fromEnd: "arrow" }, // makes free0001 part of map 2
		],
		"x-opc": { v: 1, dir: "ltr", frontmatter: { tags: ["med"] } },
		metadata: { other: "plugin data" },
	};
}

/** Canonical form for comparison: nodes and edges by id. */
function canon(d: CanvasFileData) {
	const byId = <T extends { id: string }>(list: T[] | undefined) => Object.fromEntries((list ?? []).map((x) => [x.id, x]));
	const { nodes, edges, ...root } = d;
	return { root, nodes: byId(nodes), edges: byId(edges) };
}

describe("phase 1+2: outline → mind map → outline", () => {
	it("the ADPKD note survives with identical text and nesting", async () => {
		const { items } = splitNote(fixture);
		const result = await applyNote(items, null, null, elk, options());
		expect(result.data.nodes).toHaveLength(158);
		expect(result.data.edges).toHaveLength(157);
		expect(overlap(result.data.nodes!)).toBe(false);
		const back = buildStructure(result.data, { rtl: false, freeLabel: "Free cards" });
		expect(writeOutline(back.items, { indent: "    ", ids: false })).toBe(fixture);
	});

	for (const layout of ["down", "left", "up", "balanced"] as const)
		it(`keeps sibling order with the ${layout} layout`, async () => {
			const { items } = splitNote(fixture);
			const result = await applyNote(items, null, null, elk, options({ layout }));
			const back = buildStructure(result.data, { rtl: false, freeLabel: "Free cards" });
			expect(writeOutline(back.items, { indent: "    ", ids: false })).toBe(fixture);
		});

	it("keeps text and nesting with ELK layouts (sibling order may change)", async () => {
		const sorted = (items: OutlineItem[]): unknown[] => items.map((i) => [i.text, sorted(i.children)]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
		const { items } = splitNote(fixture);
		for (const layout of ["layered-right", "radial"] as const) {
			const result = await applyNote(items, null, null, elk, options({ layout }));
			const back = buildStructure(result.data, { rtl: false, freeLabel: "Free cards" });
			expect(sorted(back.items)).toEqual(sorted(items));
		}
	});

	for (const layout of ["down", "balanced"] as const)
		it(`keeps sibling order in right-to-left canvases (${layout})`, async () => {
		const { items } = splitNote(fixture);
		const result = await applyNote(items, null, null, elk, options({ rtl: true, layout }));
		const back = buildStructure(result.data, { rtl: true, freeLabel: "Free cards" });
		expect(writeOutline(back.items, { indent: "    ", ids: false })).toBe(fixture);
	});

	it("records the layout of new maps and turns embeds and URLs into file and link cards", async () => {
		const { items } = splitNote("# Map\n- ![[pic.png]]\n- https://example.org\n- ![[missing.png]]\n");
		const result = await applyNote(items, null, null, elk, options());
		const [root, file, link, missing] = result.data.nodes!;
		expect(file).toMatchObject({ type: "file", file: "docs/pic.png" });
		expect(link).toMatchObject({ type: "link", url: "https://example.org" });
		expect(missing).toMatchObject({ type: "text", text: "![[missing.png]]" });
		expect(result.data["x-opc"]).toEqual({ v: 1, mapLayouts: { [root!.id]: "right" } });
	});

	it("places several maps and free cards without overlaps", async () => {
		const md = "Loose paragraph\n\n# A\n- a1\n- a2\n# B\n- b1\n    - b2\n";
		const result = await applyNote(splitNote(md).items, null, null, elk, options());
		expect(result.data.nodes).toHaveLength(7);
		expect(overlap(result.data.nodes!)).toBe(false);
	});
});

describe("phase 3: canvas → note → canvas", () => {
	it("writes a readable outline with hidden ids and a data block", () => {
		const md = exportNote(sampleCanvas(), exportOpts);
		expect(md.startsWith("# Section A %%g:grp0%%\n")).toBe(true);
		expect(md).toContain("- loose in group %%n:loos%%");
		expect(md).toContain("## ADPKD %%n:root%%");
		expect(md).toContain("- Gen %%n:kid00001%%\n  second line\n\n  \\- not a child\n");
		expect(md).toContain("- ![[docs/pic.png#x]] %%n:file%%");
		expect(md).toContain("# Second map %%n:map2%%\n- https://example.org/a %%n:link%%\n    - a free idea %%n:free%%\n");
		expect(md.slice(0, md.indexOf("%%\n## canvas-data"))).not.toContain("✏️");
		expect(md).toMatch(/\n%%\n## canvas-data\n```json\n\{\n\t"version": 1,/);
		expect(md.endsWith("```\n%%\n")).toBe(true);
	});

	it("an untouched note rebuilds the canvas exactly, from the canvas or from the data block alone", async () => {
		const canvas = sampleCanvas();
		const { items, data } = splitNote(exportNote(canvas, exportOpts));
		const fromCanvas = await applyNote(items, data, canvas, elk, options());
		expect(canon(fromCanvas.data)).toEqual(canon(canvas));
		expect(fromCanvas.data.nodes!.map((n) => n.id)).toEqual(canvas.nodes!.map((n) => n.id));
		expect(fromCanvas).toMatchObject({ added: 0, removed: 0, updated: 0 });
		const fromData = await applyNote(items, data, null, elk, options());
		expect(canon(fromData.data)).toEqual(canon(canvas));
		expect(fromData.data.nodes!.map((n) => n.id)).toEqual(canvas.nodes!.map((n) => n.id));
	});

	it("export → import → export is stable", async () => {
		const canvas = sampleCanvas();
		const md = exportNote(canvas, exportOpts);
		const { items, data } = splitNote(md);
		const again = await applyNote(items, data, null, elk, options());
		expect(exportNote(again.data, exportOpts)).toBe(md);
	});

	it("keeps front matter of the note", () => {
		const md = exportNote(sampleCanvas(), { ...exportOpts, frontmatter: "---\ntags: [x]\n---\n" });
		expect(md.startsWith("---\ntags: [x]\n---\n# Section A")).toBe(true);
		expect(splitNote(md).frontmatter).toBe("---\ntags: [x]\n---\n");
	});

	it("applies edits made to the text: new lines, deleted lines, moved lines, changed text", async () => {
		const canvas = sampleCanvas();
		let md = exportNote(canvas, exportOpts);
		md = md
			// Changed text (the PDF link stays as written).
			.replace("Terapia ^mark-1 %%n:kid00002%%", "Terapia aggiornata ^mark-1 %%n:kid00002%%")
			// New line written by an assistant, no id.
			.replace("    - שלום — right-to-left %%n:gkid%%\n", "    - שלום — right-to-left %%n:gkid%%\n    - Nuova terapia 2026\n        - dettaglio\n")
			// Deleted line.
			.replace("    - ![[docs/pic.png#x]] %%n:file%%\n", "")
			// Moved line: the free idea now sits under the second map's root.
			.replace("    - a free idea %%n:free%%\n", "- a free idea %%n:free%%\n");
		const { items, data } = splitNote(md);
		const result = await applyNote(items, data, canvas, elk, options());
		expect(result).toMatchObject({ added: 2, removed: 1, updated: 1 });
		const nodes = new Map(result.data.nodes!.map((n) => [n.id, n]));
		expect(nodes.has("file0001")).toBe(false);
		expect(nodes.get("kid00002")).toMatchObject({ text: "[[Nefro.pdf#page=4|p.4]] Terapia aggiornata ^mark-1", color: "#ffd43b", x: 300, y: 300, "x-opc": { kind: "sticky" } });
		// Untouched cards keep everything.
		expect(nodes.get("root0001")).toEqual(canvas.nodes![1]);
		// The new card sits beside its parent, after the existing child, and is linked to it.
		const [n1, n2] = result.created.map((id) => nodes.get(id)!);
		expect(n1).toMatchObject({ type: "text", text: "Nuova terapia 2026" });
		expect(n1!.x).toBeGreaterThan(300 + 200);
		expect(n2!.x).toBeGreaterThan(n1!.x + n1!.width);
		const edges = result.data.edges!;
		expect(edges.some((e) => e.fromNode === "kid00002" && e.toNode === n1!.id)).toBe(true);
		expect(edges.some((e) => e.fromNode === n1!.id && e.toNode === n2!.id)).toBe(true);
		// The file card's edge went with it; the moved card got a new edge, the old one is gone.
		expect(edges.find((e) => e.id === "e4")).toBeUndefined();
		expect(edges.find((e) => e.id === "e7")).toBeUndefined();
		expect(edges.some((e) => e.fromNode === "map20001" && e.toNode === "free0001")).toBe(true);
		// Edge styles and labels of kept edges survive; the cross edge too.
		expect(edges.find((e) => e.id === "e2")).toEqual(canvas.edges![1]);
		expect(edges.find((e) => e.id === "e5")).toEqual(canvas.edges![4]);
		// Drawings and foreign root data stay.
		expect(nodes.get("ink00001")).toEqual(canvas.nodes![10]);
		expect(result.data.metadata).toEqual({ other: "plugin data" });
	});

	it("re-arranges a map that uses an auto layout when its structure changes", async () => {
		const canvas = sampleCanvas();
		canvas["x-opc"] = { v: 1, mapLayouts: { map20001: "down" } };
		const md = exportNote(canvas, exportOpts).replace("- https://example.org/a %%n:link%%\n", "- https://example.org/a %%n:link%%\n- added sibling\n");
		expect(md).toContain('"map2": {"layout":"down"}');
		const { items, data } = splitNote(md);
		const result = await applyNote(items, data, canvas, elk, options());
		const nodes = new Map(result.data.nodes!.map((n) => [n.id, n]));
		const root = nodes.get("map20001")!;
		expect(root).toMatchObject({ x: 0, y: 900 });
		// Down layout: children below the root.
		expect(nodes.get("link0001")!.y).toBeGreaterThan(root.y + root.height);
		expect(nodes.get(result.created[0]!)!.y).toBeGreaterThan(root.y + root.height);
		// The other map is untouched.
		expect(nodes.get("kid00001")).toEqual(canvas.nodes![2]);
		expect(result.data["x-opc"]).toEqual({ v: 1, mapLayouts: { map20001: "down" } });
	});

	it("a layout written in the data block by hand is applied", async () => {
		const canvas = sampleCanvas();
		const md = exportNote(canvas, exportOpts).replace('"map2": {"layout":"free"}', '"map2": {"layout":"down"}').replace("- https://example.org/a %%n:link%%\n", "- https://example.org/a %%n:link%%\n- added\n");
		const { items, data } = splitNote(md);
		const result = await applyNote(items, data, canvas, elk, options());
		expect(result.data["x-opc"]).toMatchObject({ mapLayouts: { map20001: "down" } });
	});

	it("new cards under a group heading go inside the group, which grows", async () => {
		const canvas = sampleCanvas();
		const md = exportNote(canvas, exportOpts).replace("- loose in group %%n:loos%%\n", "- loose in group %%n:loos%%\n- another loose card\n");
		const { items, data } = splitNote(md);
		const result = await applyNote(items, data, canvas, elk, options());
		const nodes = new Map(result.data.nodes!.map((n) => [n.id, n]));
		const group = nodes.get("grp00001")!;
		const card = nodes.get(result.created[0]!)!;
		expect(card.x).toBeGreaterThanOrEqual(group.x);
		expect(card.y + card.height).toBeLessThanOrEqual(group.y + group.height);
		expect(group.height).toBeGreaterThan(700);
	});

	it("a renamed group heading renames the group; a deleted group heading deletes only the group", async () => {
		const canvas = sampleCanvas();
		const renamed = exportNote(canvas, exportOpts).replace("# Section A %%g:grp0%%", "# Sezione A %%g:grp0%%");
		let r = await applyNote(splitNote(renamed).items, splitNote(renamed).data, canvas, elk, options());
		expect(r.data.nodes!.find((n) => n.id === "grp00001")!.label).toBe("Sezione A");
		const dropped = exportNote(canvas, exportOpts).replace("# Section A %%g:grp0%%\n", "");
		r = await applyNote(splitNote(dropped).items, splitNote(dropped).data, canvas, elk, options());
		expect(r.data.nodes!.find((n) => n.id === "grp00001")).toBeUndefined();
		expect(r.data.nodes!.find((n) => n.id === "root0001")).toBeDefined();
		expect(r.removed).toBe(1);
	});

	it("keeps cards added on the canvas after the export", async () => {
		const canvas = sampleCanvas();
		const md = exportNote(canvas, exportOpts);
		canvas.nodes!.push(text("later001", "added later", 2000, 2000));
		canvas.edges!.push({ id: "eL", fromNode: "root0001", toNode: "later001" });
		const { items, data } = splitNote(md);
		const result = await applyNote(items, data, canvas, elk, options());
		expect(result.data.nodes!.find((n) => n.id === "later001")).toBeDefined();
		expect(result.data.edges!.find((e) => e.id === "eL")).toBeDefined();
	});

	it("a duplicated id becomes a new card instead of stealing the first one", async () => {
		const canvas = sampleCanvas();
		const md = exportNote(canvas, exportOpts).replace("- loose in group %%n:loos%%\n", "- loose in group %%n:loos%%\n- copy %%n:loos%%\n");
		const result = await applyNote(splitNote(md).items, splitNote(md).data, canvas, elk, options());
		expect(result.added).toBe(1);
		expect(result.data.nodes!.find((n) => n.id === "loose001")!.text).toBe("loose in group");
	});

	it("whitespace differences don't rewrite card text", async () => {
		const canvas = sampleCanvas();
		canvas.nodes![6] = { ...canvas.nodes![6]!, text: "loose in group  \n" };
		const md = exportNote(canvas, exportOpts);
		const result = await applyNote(splitNote(md).items, splitNote(md).data, canvas, elk, options());
		expect(result.updated).toBe(0);
		expect(result.data.nodes!.find((n) => n.id === "loose001")!.text).toBe("loose in group  \n");
	});

	it("a missing or broken data block falls back to the outline alone", async () => {
		const md = exportNote(sampleCanvas(), exportOpts);
		const broken = md.replace('"version": 1,', '"version": 1,,');
		const split = splitNote(broken);
		expect(split.dataError).toBe(true);
		expect(split.data).toBeNull();
		const result = await applyNote(split.items, null, null, elk, options());
		// 9 text cards (drawings are only in the data block).
		expect(result.data.nodes!.filter((n) => n.type !== "group")).toHaveLength(9);
		expect(overlap(result.data.nodes!)).toBe(false);
		const stripped = splitNote(md.slice(0, md.indexOf("%%\n## canvas-data")));
		expect(stripped.data).toBeNull();
		expect(stripped.dataError).toBe(false);
	});
});
