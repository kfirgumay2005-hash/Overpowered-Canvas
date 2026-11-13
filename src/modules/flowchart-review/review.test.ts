import { describe, expect, it } from "vitest";
import type { CanvasFileData } from "../../data/json-canvas";
import { canvasTags, defaultName, findFlowcharts, plainCardText } from "./find";
import { AGAIN_DELAY, intervalDays, preview, retrievability, review, span } from "./fsrs";
import { grade, normalizeAnswer } from "./grade";
import { dropPath, emptyData, entryFor, movePath, parseNote, resetChanged, setEntry, writeNote } from "./store";

const n = (id: string, text: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({ id, type: "text", text, x, y, width: 100, height: 50, ...extra });
const e = (id: string, from: string, to: string, label?: string) => ({ id, fromNode: from, toNode: to, ...(label ? { label } : {}) });
const opts = { groupName: "toreview", tag: "toreview" };

const board = (): CanvasFileData => ({
	nodes: [
		{ id: "g", type: "group", label: "ToReview", x: 0, y: 0, width: 1000, height: 1000 },
		n("a", "Start the day early", 100, 100),
		n("b", "Drink coffee?", 100, 300, { "x-opc": { shape: "decision" } }),
		n("c", "Work", 100, 500),
		n("lone", "Alone", 500, 100),
		n("out1", "Outside", 2000, 0),
		n("out2", "Outside 2", 2000, 200),
		n("ink", "", 120, 120, { "x-opc": { kind: "ink" } }),
	],
	edges: [e("e1", "a", "b"), e("e2", "b", "c", "yes"), e("e3", "out1", "out2"), e("e4", "ink", "a")],
});

describe("findFlowcharts", () => {
	it("finds connected cards inside a review group, first card first", () => {
		const charts = findFlowcharts("x.canvas", board(), opts);
		expect(charts).toHaveLength(1);
		const c = charts[0]!;
		expect(c.key).toBe("x.canvas::a");
		expect(c.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
		expect(c.nodes.find((n) => n.id === "b")?.shape).toBe("decision");
		expect(c.edges.map((e) => e.label ?? "")).toEqual(["", "yes"]);
	});
	it("a tagged canvas reviews all of its charts", () => {
		const data = { ...board(), "x-opc": { frontmatter: { tags: ["#ToReview"] } } };
		expect(findFlowcharts("x.canvas", data, opts).map((c) => c.firstId)).toEqual(["out1", "a"]);
		expect(canvasTags({ nodes: [n("t", "notes #toreview here", 0, 0)] })).toEqual(["toreview"]);
	});
	it("moving cards keeps the hash, editing text changes it", () => {
		const h = findFlowcharts("x.canvas", board(), opts)[0]!.hash;
		const moved = board();
		moved.nodes![1]!.x += 5;
		expect(findFlowcharts("x.canvas", moved, opts)[0]!.hash).toBe(h);
		const edited = board();
		edited.nodes![3]!.text = "Rest";
		expect(findFlowcharts("x.canvas", edited, opts)[0]!.hash).not.toBe(h);
	});
	it("names a chart by the first words of its first card", () => {
		const c = findFlowcharts("x.canvas", board(), opts)[0]!;
		expect(defaultName(c, 2)).toBe("Start the…");
		expect(defaultName(c, 4)).toBe("Start the day early");
		expect(plainCardText("## **Bold** [[Note|alias]] ==mark==")).toBe("Bold alias mark");
	});
});

describe("fsrs", () => {
	const now = Date.UTC(2026, 0, 1);
	it("orders the intervals of a new chart", () => {
		const p = preview(null, now);
		expect(p[1].due - now).toBe(AGAIN_DELAY);
		const days = [2, 3, 4].map((g) => (p[g as 2 | 3 | 4].due - now) / 86_400_000);
		expect(days[0]).toBeLessThan(days[1]!);
		expect(days[1]).toBeLessThan(days[2]!);
		expect(p[3].reps).toBe(1);
	});
	it("good reviews grow the interval; again counts a lapse", () => {
		const first = preview(null, now)[3];
		const t2 = first.due;
		const second = preview(first, t2)[3];
		expect(second.due - t2).toBeGreaterThan(first.due - now);
		const lapse = review(second, 1, second.due);
		expect(lapse.lapses).toBe(1);
		expect(lapse.stability).toBeLessThan(second.stability);
	});
	it("retrievability is 90 % after the stability", () => {
		expect(retrievability(10, 10)).toBeCloseTo(0.9, 5);
		expect(intervalDays(10)).toBe(10);
		expect(span(90 * 60_000)).toEqual({ unit: "h", n: 2 });
		expect(span(3 * 86_400_000)).toEqual({ unit: "d", n: 3 });
	});
});

describe("grade", () => {
	it("ignores case, punctuation and marks", () => {
		expect(normalizeAnswer("**Drink** coffee?")).toBe("drink coffee");
		expect(grade("drink COFFEE", "Drink coffee?")).toBe("correct");
		expect(grade("drink cofee", "Drink coffee?")).toBe("correct");
		expect(grade("coffee", "Drink some coffee now")).toBe("wrong");
		expect(grade("send home", "Send home with advice")).toBe("close");
		expect(grade("drink some coffee", "Drink some coffee now")).toBe("close");
		expect(grade("", "x")).toBe("wrong");
		expect(grade("tea", "Drink coffee")).toBe("wrong");
	});
});

describe("store", () => {
	const state = { stability: 3, difficulty: 5, reps: 1, lapses: 0, last: 1, due: 2 };
	it("round-trips through the note and keeps text before the block", () => {
		const data = setEntry(emptyData(), "a.canvas::x", { hash: "h", name: "Mine", state });
		const text = writeNote("", data, "Intro");
		expect(text.startsWith("Intro")).toBe(true);
		expect(parseNote(text)).toEqual(data);
		const again = writeNote("My own words\n\n" + text.slice(text.indexOf("```")), emptyData(), "Intro");
		expect(again.startsWith("My own words")).toBe(true);
		expect(parseNote("```json\nnot json\n```")).toEqual(emptyData());
	});
	it("a changed chart starts over but keeps its name", () => {
		const data = setEntry(emptyData(), "k", { hash: "h1", name: "Mine", state });
		expect(entryFor(data, "k", "h1").state).toEqual(state);
		expect(entryFor(data, "k", "h2")).toEqual({ hash: "h2", name: "Mine" });
		expect(resetChanged(data, [{ key: "k", hash: "h2" }])?.charts.k).toEqual({ hash: "h2", name: "Mine" });
		expect(resetChanged(data, [{ key: "k", hash: "h1" }])).toBeNull();
	});
	it("follows renamed and deleted canvases", () => {
		const data = setEntry(emptyData(), "a.canvas::x", { hash: "h", state });
		expect(Object.keys(movePath(data, "a.canvas", "b/a.canvas")!.charts)).toEqual(["b/a.canvas::x"]);
		expect(dropPath(data, "a.canvas")!.charts).toEqual({});
		expect(dropPath(data, "z.canvas")).toBeNull();
	});
});
