/**
 * The tutorials. Each builds a small demo board and walks through a feature with tasks that are
 * checked on the live board; "Show me" does the task for the user, on the same board.
 */
import type { CanvasFileData, CanvasNodeData } from "../data/json-canvas";
import { SCHEMA_KEY, type LayerInfo, type OpcRoot } from "../data/schema";
import { builtinTemplate } from "../modules/board-templates/builtins";
import { reid, translate as shiftData } from "../modules/board-templates/logic";
import { STICKY_COLORS } from "../modules/sticky-notes/logic";
import { relayoutMap } from "../modules/auto-layout/arrange";
import { recordChild } from "../modules/mindmap/order-store";
import { parseFontSize } from "../modules/note-font-size/logic";
import { BARS_TUTORIAL } from "./runner";
import { added, addedEdges, arrow, card, count, edge, edgesOf, ellipsePoints, extraOf, findNode, group, ink, kindOf, nodesOf, practicePdf, randomId, shape, sticky, strokeCount, title } from "./board";
import type { Translate } from "../i18n";
import type { TutorialDefinition, TutorialRuntime } from "./types";

// ---------- shared helpers ----------

const isSticky = (n: CanvasNodeData) => kindOf(n) === "sticky";
const isShape = (n: CanvasNodeData) => kindOf(n) === "shape";
const isPlainCard = (n: CanvasNodeData) => n.type === "text" && !kindOf(n);
const isGroup = (n: CanvasNodeData) => n.type === "group";

const grew = (rt: TutorialRuntime, test: (n: CanvasNodeData) => boolean) => count(rt.now(), test) > count(rt.before, test);

/** Some node that existed when the step started now differs in `read`. */
const changedAny = (rt: TutorialRuntime, read: (n: CanvasNodeData) => unknown, test: (n: CanvasNodeData) => boolean = () => true) => {
	const before = new Map(nodesOf(rt.before).map((n) => [n.id, JSON.stringify(read(n) ?? null)]));
	return nodesOf(rt.now()).some((n) => test(n) && before.has(n.id) && before.get(n.id) !== JSON.stringify(read(n) ?? null));
};

const rootOf = (data: CanvasFileData): Partial<OpcRoot> => extraOf(data);
const layerOf = (data: CanvasFileData, id: string): LayerInfo | undefined => rootOf(data).layers?.find((l) => l.id === id);

const moved = (rt: TutorialRuntime, id: string, by = 30) => {
	const a = findNode(rt.before, id);
	const b = findNode(rt.now(), id);
	return !!a && !!b && Math.hypot(a.x - b.x, a.y - b.y) > by;
};

/** Animated drag of a node, so "Show me" looks like a hand moving it. */
async function glide(rt: TutorialRuntime, id: string, dx: number, dy: number): Promise<void> {
	const node = rt.node(id);
	if (!node) return;
	const x0 = node.x;
	const y0 = node.y;
	const frames = 24;
	for (let i = 1; i <= frames; i++) {
		const k = 1 - Math.pow(1 - i / frames, 3);
		node.moveTo({ x: Math.round(x0 + dx * k), y: Math.round(y0 + dy * k) });
		node.render();
		await rt.wait(16);
	}
	rt.change(() => node.moveTo({ x: Math.round(x0 + dx), y: Math.round(y0 + dy) }));
}

function setExtra(rt: TutorialRuntime, id: string, patch: Record<string, unknown>): void {
	const node = rt.node(id);
	if (!node) return;
	rt.change(() => rt.data.node(node).set(patch));
	rt.canvas.menu.render(true);
}

function setEdgeExtra(rt: TutorialRuntime, id: string, patch: Record<string, unknown>, history = true): void {
	const e = rt.canvas.edges.get(id);
	if (!e) return;
	if (history) rt.change(() => rt.data.edge(e).set(patch));
	else rt.data.edge(e).set(patch, { history: false });
	// The path is only recomputed for dirty edges.
	rt.canvas.markDirty(e);
	rt.canvas.menu.render(true);
}

function setLayer(rt: TutorialRuntime, id: string, patch: Partial<LayerInfo>): void {
	const layers = (rt.root().layers ?? []).map((l) => {
		if (l.id !== id) return l;
		const next: LayerInfo = { ...l, ...patch };
		if (!next.hidden) delete next.hidden;
		if (!next.locked) delete next.locked;
		return next;
	});
	rt.change(() => rt.data.root(rt.canvas).set({ layers }));
}

/** Viewport center inside the node's box (with some slack). */
function viewingNode(rt: TutorialRuntime, id: string, slack = 200): boolean {
	const node = rt.node(id);
	if (!node) return false;
	const v = rt.canvas.getViewportBBox();
	const cx = (v.minX + v.maxX) / 2;
	const cy = (v.minY + v.maxY) / 2;
	const b = node.getBBox();
	return cx > b.minX - slack && cx < b.maxX + slack && cy > b.minY - slack && cy < b.maxY + slack;
}

const lastSelectedSticky = (rt: TutorialRuntime) => {
	const id = rt.selected().find((s) => {
		const n = rt.node(s);
		return n && rt.data.node(n).get().kind === "sticky";
	});
	return id ? rt.node(id) : undefined;
};

// ---------- 1. First steps ----------

const basics: TutorialDefinition = {
	id: "basics",
	icon: "mouse-pointer-click",
	title: "tut.basics.title",
	summary: "tut.basics.summary",
	modules: ["sticky-notes", "node-shapes", "lock-items"],
	board: (t) => ({
		nodes: [
			title("b-title", t("tut.basics.board.title"), 0, -170),
			card("b-a", t("tut.basics.board.a"), 0, 0, 220, 100),
			card("b-b", t("tut.basics.board.b"), 300, 0, 220, 100),
			card("b-c", t("tut.basics.board.c"), 600, 0, 220, 100),
		],
		edges: [edge("b-e1", "b-a", "right", "b-b", "left"), edge("b-e2", "b-b", "right", "b-c", "left")],
	}),
	steps: [
		{ title: "tut.basics.s1.title", body: "tut.basics.s1.body" },
		{
			title: "tut.basics.s2.title",
			body: "tut.basics.s2.body",
			task: "tut.basics.s2.task",
			check: (rt) => grew(rt, isPlainCard),
			demo: (rt) => {
				const [node] = rt.add([card(randomId(), rt.t("tut.basics.board.hello"), 300, 200, 220, 90)]);
				if (node) rt.select([node.id]);
			},
		},
		{
			title: "tut.basics.s3.title",
			body: "tut.basics.s3.body",
			task: "tut.basics.s3.task",
			focus: ["b-a", "b-b", "b-c"],
			check: (rt) => moved(rt, "b-c"),
			demo: (rt) => glide(rt, "b-c", 40, 260),
		},
		{
			title: "tut.basics.s4.title",
			body: "tut.basics.s4.body",
			task: "tut.basics.s4.task",
			target: ".opc-card-sticky",
			check: (rt) => grew(rt, isSticky),
			demo: (rt) => void rt.command("sticky-notes:add-sticky"),
		},
		{
			title: "tut.basics.s5.title",
			body: "tut.basics.s5.body",
			task: "tut.basics.s5.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["b-b"]),
			check: (rt) => !!rt.extra("b-b").shape,
			demo: (rt) => {
				rt.select(["b-b"]);
				setExtra(rt, "b-b", { shape: "ellipse" });
			},
		},
		{
			title: "tut.basics.s6.title",
			body: "tut.basics.s6.body",
			task: "tut.basics.s6.task",
			target: ".canvas-menu",
			check: (rt) => changedAny(rt, (n) => n.color),
			demo: (rt) => {
				const node = rt.node("b-a");
				if (!node) return;
				rt.select(["b-a"]);
				rt.change(() => node.setColor("4"));
			},
		},
		{
			title: "tut.basics.s7.title",
			body: "tut.basics.s7.body",
			task: "tut.basics.s7.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["b-a"]),
			check: (rt) => !!rt.extra("b-a").locked,
			demo: (rt) => {
				rt.select(["b-a"]);
				rt.command("lock-items:toggle-lock");
			},
		},
		{
			title: "tut.basics.s8.title",
			body: "tut.basics.s8.body",
			task: "tut.basics.s8.task",
			touch: "tut.basics.s8.touch",
			check: (rt) => rt.seen("undo"),
			demo: (rt) => rt.canvas.undo(),
		},
	],
};

// ---------- 2. Sticky notes and text ----------

/** Emoji in the text cards of a board. */
const emojiCount = (nodes: CanvasNodeData[]) => nodes.reduce((sum, n) => sum + (typeof n.text === "string" ? (n.text.match(/\p{Extended_Pictographic}/gu) ?? []).length : 0), 0);

const notes: TutorialDefinition = {
	id: "notes",
	icon: "sticky-note",
	title: "tut.notes.title",
	summary: "tut.notes.summary",
	modules: ["sticky-notes", "floating-text", "text-align", "auto-resize", "emoji-picker"],
	board: (t) => ({
		nodes: [
			title("n-title", t("tut.notes.board.title"), 0, -170),
			group("n-g", t("tut.notes.board.group"), -40, -50, 760, 560),
			sticky("n-s1", t("tut.notes.board.s1"), 0, 0, "yellow"),
			sticky("n-s2", t("tut.notes.board.s2"), 240, 0, "pink"),
			card("n-long", t("tut.notes.board.long"), 0, 560, 320, 80),
		],
		edges: [],
	}),
	steps: [
		{
			title: "tut.notes.s1.title",
			body: "tut.notes.s1.body",
			task: "tut.notes.s1.task",
			touch: "tut.notes.s1.touch",
			focus: ["n-g", "n-long"],
			enter: (rt) => rt.select(["n-s2"]),
			check: (rt) => grew(rt, isSticky),
			demo: (rt) => {
				const from = lastSelectedSticky(rt) ?? rt.node("n-s2");
				if (!from) return;
				const [node] = rt.add([{ ...sticky(randomId(), "", from.x + 240, from.y), color: from.color }]);
				if (node) rt.select([node.id]);
			},
		},
		{
			title: "tut.notes.s2.title",
			body: "tut.notes.s2.body",
			task: "tut.notes.s2.task",
			touch: "tut.notes.s2.touch",
			enter: (rt) => {
				if (!lastSelectedSticky(rt)) rt.select(["n-s1"]);
			},
			check: (rt) => grew(rt, isSticky),
			demo: (rt) => {
				const from = lastSelectedSticky(rt) ?? rt.node("n-s1");
				if (!from) return;
				const [node] = rt.add([{ ...sticky(randomId(), "", from.x, from.y + 240), color: from.color }]);
				if (node) rt.select([node.id]);
			},
		},
		{
			title: "tut.notes.s3.title",
			body: "tut.notes.s3.body",
			task: "tut.notes.s3.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["n-s1"]),
			check: (rt) => changedAny(rt, (n) => n.color, isSticky),
			demo: (rt) => {
				const node = rt.node("n-s1");
				if (!node) return;
				rt.select(["n-s1"]);
				rt.change(() => node.setColor(STICKY_COLORS.green));
			},
		},
		{
			title: "tut.notes.s4.title",
			body: "tut.notes.s4.body",
			task: "tut.notes.s4.task",
			target: ".opc-card-floating-text",
			check: (rt) => added(rt.before, rt.now()).some((n) => kindOf(n) === "text"),
			demo: (rt) => {
				rt.add([title(randomId(), rt.t("tut.notes.board.floating"), 400, 580, 300, 50, 0)]);
			},
		},
		{
			title: "tut.notes.s5.title",
			body: "tut.notes.s5.body",
			task: "tut.notes.s5.task",
			target: ".canvas-menu",
			focus: ["n-g", "n-long"],
			enter: (rt) => rt.select(["n-long"]),
			check: (rt) => changedAny(rt, (n) => [extraOf(n).align, extraOf(n).valign]),
			demo: (rt) => {
				rt.select(["n-long"]);
				setExtra(rt, "n-long", { align: "center" });
			},
		},
		{
			title: "tut.notes.size.title",
			body: "tut.notes.size.body",
			task: "tut.notes.size.task",
			target: ".canvas-menu .opc-menu-font-size",
			focus: ["n-g", "n-long"],
			enter: (rt) => rt.select(["n-long"]),
			check: (rt) => changedAny(rt, (n) => extraOf(n).fontSize),
			demo: (rt) => {
				rt.select(["n-long"]);
				setExtra(rt, "n-long", { fontSize: 24 });
			},
		},
		{
			title: "tut.notes.emoji.title",
			body: "tut.notes.emoji.body",
			task: "tut.notes.emoji.task",
			touch: "tut.notes.emoji.touch",
			target: ".opc-card-emoji",
			focus: ["n-g", "n-long"],
			enter: (rt) => rt.select(["n-long"]),
			// An emoji more than before, in any card (the long one, or a new one).
			check: (rt) => emojiCount(nodesOf(rt.now())) > emojiCount(nodesOf(rt.before)),
			demo: async (rt) => {
				rt.select(["n-long"]);
				await rt.wait(300);
				rt.canvas.cardMenuEl.querySelector<HTMLElement>(".opc-card-emoji")?.click();
				await rt.wait(900);
				const search = activeDocument.querySelector<HTMLInputElement>(".opc-emoji input");
				if (search) {
					search.value = "party";
					search.dispatchEvent(new Event("input"));
				}
				await rt.wait(700);
				activeDocument.querySelector<HTMLElement>(".opc-emoji-results .opc-emoji-item")?.click();
				await rt.wait(900);
				closeDialog(".opc-emoji");
			},
		},
		{
			title: "tut.notes.s6.title",
			body: "tut.notes.s6.body",
			task: "tut.notes.s6.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["n-long"]),
			check: (rt) => nodesOf(rt.now()).some((n) => n.id === "n-long" && (extraOf(n).autoResize === true || extraOf(n).autoWidth === true || extraOf(n).autoFit === true)),
			demo: async (rt) => {
				rt.select(["n-long"]);
				setExtra(rt, "n-long", { autoFit: true });
				const node = rt.node("n-long");
				if (!node) return;
				const words = rt.t("tut.notes.board.more").split(" ");
				let text = node.getData().text ?? "";
				for (const w of words) {
					text += ` ${w}`;
					node.setData({ ...node.getData(), text });
					await rt.wait(60);
				}
				rt.change(() => node.setData({ ...node.getData(), text }));
			},
		},
	],
};

// ---------- 3. Shapes and dividers ----------

const shapes: TutorialDefinition = {
	id: "shapes",
	icon: "shapes",
	title: "tut.shapes.title",
	summary: "tut.shapes.summary",
	modules: ["shapes", "node-shapes", "infinite-lines"],
	board: (t) => ({
		nodes: [
			title("h-title", t("tut.shapes.board.title"), 0, -170),
			shape("h-r", "rounded-rectangle", 0, 0, 200, 140, { color: "5" }),
			shape("h-e", "ellipse", 260, -10, 160, 160, { color: "4", text: t("tut.shapes.board.hi") }),
			shape("h-st", "star", 480, -10, 160, 160, { color: "3" }),
			card("h-c", t("tut.shapes.board.decision"), 0, 240, 220, 120),
		],
		edges: [],
	}),
	steps: [
		{
			title: "tut.shapes.s1.title",
			body: "tut.shapes.s1.body",
			task: "tut.shapes.s1.task",
			target: ".opc-card-shape",
			check: (rt) => grew(rt, isShape),
			demo: (rt) => {
				const [node] = rt.add([shape(randomId(), "cloud", 700, -10, 200, 160, { color: "6" })]);
				if (node) rt.select([node.id]);
			},
		},
		{
			title: "tut.shapes.s2.title",
			body: "tut.shapes.s2.body",
			task: "tut.shapes.s2.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["h-e"]),
			check: (rt) => changedAny(rt, (n) => [extraOf(n).fill, extraOf(n).opacity, extraOf(n).rotation, extraOf(n).strokeWidth], isShape),
			demo: async (rt) => {
				rt.select(["h-st"]);
				setExtra(rt, "h-st", { fill: "solid" });
				await rt.wait(400);
				setExtra(rt, "h-st", { rotation: 15 });
			},
		},
		{
			title: "tut.shapes.s3.title",
			body: "tut.shapes.s3.body",
			task: "tut.shapes.s3.task",
			check: (rt) => changedAny(rt, (n) => n.text, isShape),
			demo: (rt) => {
				const node = rt.node("h-r");
				if (!node) return;
				rt.change(() => node.setData({ ...node.getData(), text: rt.t("tut.shapes.board.inside") }));
			},
		},
		{
			title: "tut.shapes.s4.title",
			body: "tut.shapes.s4.body",
			task: "tut.shapes.s4.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["h-c"]),
			check: (rt) => !!rt.extra("h-c").shape,
			demo: (rt) => {
				rt.select(["h-c"]);
				setExtra(rt, "h-c", { shape: "decision" });
			},
		},
		{
			title: "tut.shapes.s5.title",
			body: "tut.shapes.s5.body",
			task: "tut.shapes.s5.task",
			target: ".opc-card-infinite-line",
			check: (rt) => grew(rt, (n) => kindOf(n) === "guide"),
			demo: (rt) => void rt.command("infinite-lines:add-h"),
		},
		{
			title: "tut.shapes.s6.title",
			body: "tut.shapes.s6.body",
			task: "tut.shapes.s6.task",
			target: ".canvas-menu",
			enter: (rt) => {
				const guide = nodesOf(rt.now()).find((n) => kindOf(n) === "guide");
				if (guide) rt.select([guide.id]);
			},
			check: (rt) => changedAny(rt, (n) => (extraOf(n).guide as { angle?: number; axis?: string } | undefined)?.angle ?? (extraOf(n).guide as { axis?: string } | undefined)?.axis, (n) => kindOf(n) === "guide"),
			demo: async (rt) => {
				const guide = nodesOf(rt.now()).find((n) => kindOf(n) === "guide");
				if (!guide) {
					rt.command("infinite-lines:add-h");
					return;
				}
				rt.select([guide.id]);
				const current = (extraOf(guide).guide ?? { axis: "h", width: 4 }) as Record<string, unknown>;
				for (const angle of [10, 20, 30]) {
					setExtra(rt, guide.id, { guide: { ...current, axis: "h", angle } });
					await rt.wait(180);
				}
			},
		},
	],
};

// ---------- 4. Arrows between cards ----------

const edges: TutorialDefinition = {
	id: "edges",
	icon: "move-up-right",
	title: "tut.edges.title",
	summary: "tut.edges.summary",
	modules: ["edge-styles", "edge-routing", "edge-editing", "edge-tools", "node-shapes"],
	board: (t) => ({
		nodes: [
			title("e-title", t("tut.edges.board.title"), 0, -170),
			card("e-start", t("tut.edges.board.start"), 0, 0, 200, 80, { [SCHEMA_KEY]: { shape: "terminal" }, color: "4" }),
			card("e-step", t("tut.edges.board.step"), 0, 180, 200, 80, { [SCHEMA_KEY]: { shape: "process" } }),
			card("e-ask", t("tut.edges.board.ask"), 0, 360, 200, 120, { [SCHEMA_KEY]: { shape: "decision" }, color: "3" }),
			card("e-end", t("tut.edges.board.end"), 420, 470, 200, 80, { [SCHEMA_KEY]: { shape: "terminal" }, color: "1" }),
			card("e-lone", t("tut.edges.board.lone"), 420, 160, 200, 80, { color: "6" }),
		],
		edges: [
			edge("e-1", "e-start", "bottom", "e-step", "top"),
			edge("e-2", "e-step", "bottom", "e-ask", "top"),
			edge("e-3", "e-ask", "right", "e-end", "left", { label: t("tut.edges.board.yes") }),
		],
	}),
	steps: [
		{
			title: "tut.edges.s1.title",
			body: "tut.edges.s1.body",
			task: "tut.edges.s1.task",
			check: (rt) => addedEdges(rt.before, rt.now()).some((e) => e.fromNode === "e-lone" || e.toNode === "e-lone"),
			demo: (rt) => {
				rt.add([], [edge(randomId(), "e-lone", "bottom", "e-end", "top")]);
			},
		},
		{
			title: "tut.edges.s2.title",
			body: "tut.edges.s2.body",
			task: "tut.edges.s2.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["e-2"]),
			check: (rt) => edgesOf(rt.now()).some((e) => !!extraOf(e).path && extraOf(e).path !== "solid"),
			demo: (rt) => {
				rt.select(["e-2"]);
				setEdgeExtra(rt, "e-2", { path: "long-dashed" });
			},
		},
		{
			title: "tut.edges.s3.title",
			body: "tut.edges.s3.body",
			task: "tut.edges.s3.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["e-1"]),
			check: (rt) => edgesOf(rt.now()).some((e) => !!extraOf(e).arrows),
			demo: (rt) => {
				rt.select(["e-1"]);
				setEdgeExtra(rt, "e-1", { arrows: { to: "diamond" } });
			},
		},
		{
			title: "tut.edges.s4.title",
			body: "tut.edges.s4.body",
			task: "tut.edges.s4.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["e-3"]),
			check: (rt) => edgesOf(rt.now()).some((e) => !!extraOf(e).route && extraOf(e).route !== "bezier"),
			demo: (rt) => {
				rt.select(["e-3"]);
				setEdgeExtra(rt, "e-3", { route: "orthogonal" });
			},
		},
		{
			title: "tut.edges.s5.title",
			body: "tut.edges.s5.body",
			task: "tut.edges.s5.task",
			enter: (rt) => rt.select(["e-2"]),
			check: (rt) => edgesOf(rt.now()).some((e) => Array.isArray(extraOf(e).waypoints) && (extraOf(e).waypoints as unknown[]).length > 0),
			demo: async (rt) => {
				rt.select(["e-2"]);
				// Drag the middle of the arrow sideways, like a hand would.
				for (let i = 1; i <= 20; i++) {
					setEdgeExtra(rt, "e-2", { waypoints: [[Math.round(100 - 160 * (i / 20)), 310]] }, false);
					await rt.wait(16);
				}
				setEdgeExtra(rt, "e-2", { waypoints: [[-60, 310]] });
			},
		},
		{
			title: "tut.edges.s6.title",
			body: "tut.edges.s6.body",
			task: "tut.edges.s6.task",
			enter: (rt) => rt.select(["e-1"]),
			check: (rt) => {
				const before = new Map(edgesOf(rt.before).map((e) => [e.id, e.fromNode]));
				return edgesOf(rt.now()).some((e) => before.has(e.id) && before.get(e.id) !== e.fromNode);
			},
			demo: (rt) => {
				rt.select(["e-1"]);
				rt.command("edge-tools:flip-edges");
			},
		},
	],
};

// ---------- 5. Drawing ----------

const drawing: TutorialDefinition = {
	id: "drawing",
	icon: "pen-tool",
	title: "tut.drawing.title",
	summary: "tut.drawing.summary",
	modules: ["drawing", "free-lines", "shapes", "text-highlight"],
	board: (t) => ({
		nodes: [
			title("d-title", t("tut.drawing.board.title"), 0, -170),
			card("d-target", t("tut.drawing.board.target"), 60, 0, 220, 90, { color: "5" }),
			card("d-a", t("tut.drawing.board.a"), 0, 300, 200, 80, { color: "4" }),
			card("d-b", t("tut.drawing.board.b"), 460, 300, 200, 80, { color: "6" }),
		],
		edges: [],
	}),
	steps: [
		{
			title: "tut.drawing.s1.title",
			body: "tut.drawing.s1.body",
			task: "tut.drawing.s1.task",
			target: ".opc-card-drawing",
			check: (rt) => rt.seen("drawing-mode-changed", (_c, tool) => tool !== null),
			demo: (rt) => void rt.command("drawing:toggle-drawing"),
		},
		{
			title: "tut.drawing.s2.title",
			body: "tut.drawing.s2.body",
			task: "tut.drawing.s2.task",
			// Any tool counts: the bar remembers the last one, which may be the line tool.
			check: (rt) => rt.seen("stroke-added") || strokeCount(rt.now()) > strokeCount(rt.before) || grew(rt, (n) => kindOf(n) === "line"),
			demo: async (rt) => {
				const pts = ellipsePoints(170, 45, 170, 85);
				// Drawn a bit at a time, like a pen.
				let id = "";
				for (let n = 8; n <= pts.length; n += 8) {
					if (id) rt.canvas.removeNode(rt.node(id)!);
					id = randomId();
					rt.canvas.importData({ nodes: [ink(id, pts.slice(0, n))], edges: [] }, false);
					await rt.wait(40);
				}
				const last = rt.node(id);
				if (last) rt.canvas.removeNode(last);
				rt.add([ink(randomId(), pts)]);
			},
		},
		{
			title: "tut.drawing.s3.title",
			body: "tut.drawing.s3.body",
			task: "tut.drawing.s3.task",
			check: (rt) => grew(rt, (n) => kindOf(n) === "line"),
			demo: (rt) => {
				rt.add([arrow(randomId(), [{ x: 200, y: 340 }, { x: 460, y: 340 }], "d-a", "d-b")]);
			},
		},
		{
			title: "tut.drawing.s4.title",
			body: "tut.drawing.s4.body",
			task: "tut.drawing.s4.task",
			check: (rt) => rt.seen("strokes-erased") || strokeCount(rt.now()) < strokeCount(rt.before),
			demo: (rt) => {
				const carrier = nodesOf(rt.now()).find((n) => kindOf(n) === "ink");
				const node = carrier && rt.node(carrier.id);
				if (node) rt.change(() => rt.canvas.removeNode(node));
			},
		},
		{
			title: "tut.drawing.mark.title",
			body: "tut.drawing.mark.body",
			task: "tut.drawing.mark.task",
			focus: ["d-target"],
			check: (rt) => nodesOf(rt.now()).some((n) => kindOf(n) === "ink" && extraOf(n).anchor === "d-target"),
			demo: (rt) => {
				const data = ink(randomId(), [{ x: 95, y: 62 }, { x: 170, y: 64 }, { x: 245, y: 61 }]);
				(data[SCHEMA_KEY] as Record<string, unknown>).anchor = "d-target";
				rt.add([data]);
			},
		},
		{
			title: "tut.drawing.s5.title",
			body: "tut.drawing.s5.body",
			task: "tut.drawing.s5.task",
			check: (rt) => rt.seen("drawing-mode-changed", (_c, tool) => tool === null),
			demo: (rt) => void rt.command("drawing:toggle-drawing"),
		},
		{
			title: "tut.drawing.s6.title",
			body: "tut.drawing.s6.body",
			task: "tut.drawing.s6.task",
			focus: ["d-a", "d-b"],
			check: (rt) => moved(rt, "d-a") || moved(rt, "d-b"),
			demo: (rt) => glide(rt, "d-b", 0, 220),
		},
		{
			title: "tut.drawing.s7.title",
			body: "tut.drawing.s7.body",
			task: "tut.drawing.s7.task",
			focus: ["d-target"],
			check: (rt) => moved(rt, "d-target"),
			demo: (rt) => glide(rt, "d-target", 260, -40),
		},
		{
			title: "tut.drawing.hl.title",
			body: "tut.drawing.hl.body",
			task: "tut.drawing.hl.task",
			target: ".opc-card-text-highlight",
			focus: ["d-target"],
			check: (rt) => rt.seen("text-highlighted") || /==|<mark/.test(findNode(rt.now(), "d-target")?.text ?? ""),
			demo: (rt) => {
				const node = rt.node("d-target");
				if (!node) return;
				const text = node.getData().text ?? "";
				rt.change(() => node.setData({ ...node.getData(), text: `==${text}==` }));
			},
		},
		{
			title: "tut.drawing.color.title",
			body: "tut.drawing.color.body",
			task: "tut.drawing.color.task",
			touch: "tut.drawing.color.touch",
			target: ".opc-card-text-color",
			focus: ["d-target"],
			check: (rt) => rt.seen("text-colored") || /<span style="color:/.test(findNode(rt.now(), "d-target")?.text ?? ""),
			demo: (rt) => {
				rt.command("text-highlight:toggle-color");
				const node = rt.node("d-target");
				if (!node) return;
				const text = node.getData().text ?? "";
				rt.change(() => node.setData({ ...node.getData(), text: `<span style="color: #e03131;">${text}</span>` }));
			},
		},
	],
};

// ---------- 6. Layers ----------

const layers: TutorialDefinition = {
	id: "layers",
	icon: "layers",
	title: "tut.layers.title",
	summary: "tut.layers.summary",
	modules: ["layers", "shapes", "sticky-notes"],
	board: (t) => {
		const on = (layer: string, node: CanvasNodeData): CanvasNodeData => ({ ...node, [SCHEMA_KEY]: { ...extraOf(node), layer } });
		return {
			nodes: [
				on("bg", title("l-title", t("tut.layers.board.title"), 0, -170)),
				on("bg", shape("l-room", "rectangle", 0, 0, 900, 560, { color: "5" })),
				on("bg", shape("l-rug", "ellipse", 300, 180, 300, 200, { color: "2" })),
				on("furn", sticky("l-sofa", t("tut.layers.board.sofa"), 60, 60, "blue")),
				on("furn", sticky("l-table", t("tut.layers.board.table"), 350, 180, "orange")),
				on("furn", sticky("l-bed", t("tut.layers.board.bed"), 640, 60, "purple")),
				on("notes", sticky("l-note", t("tut.layers.board.note"), 660, 330, "pink")),
			],
			edges: [],
			root: {
				layers: [
					// Locked like a real background, so drags meant for a locked card can't move the room.
					{ id: "bg", name: t("tut.layers.board.bg"), locked: true },
					{ id: "furn", name: t("tut.layers.board.furn") },
					{ id: "notes", name: t("tut.layers.board.notes") },
				],
				activeLayer: "notes",
			},
		};
	},
	steps: [
		{
			title: "tut.layers.s1.title",
			body: "tut.layers.s1.body",
			task: "tut.layers.s1.task",
			target: ".opc-layers-control",
			check: (rt) => rt.viewOpen("opc-layers"),
			demo: (rt) => void rt.command("layers:open"),
		},
		{
			title: "tut.layers.s2.title",
			body: "tut.layers.s2.body",
			task: "tut.layers.s2.task",
			target: '.opc-layers-item[data-layer="bg"] .opc-layers-toggle',
			check: (rt) => !!layerOf(rt.now(), "bg")?.hidden,
			demo: (rt) => setLayer(rt, "bg", { hidden: true }),
		},
		{
			title: "tut.layers.s3.title",
			body: "tut.layers.s3.body",
			task: "tut.layers.s3.task",
			target: '.opc-layers-item[data-layer="bg"] .opc-layers-toggle',
			check: (rt) => !layerOf(rt.now(), "bg")?.hidden && (!!layerOf(rt.before, "bg")?.hidden || rt.seen("undo")),
			demo: (rt) => setLayer(rt, "bg", { hidden: false }),
		},
		{
			title: "tut.layers.s4.title",
			body: "tut.layers.s4.body",
			task: "tut.layers.s4.task",
			target: '.opc-layers-item[data-layer="furn"] .opc-layers-toggle:nth-of-type(2)',
			check: (rt) => !!layerOf(rt.now(), "furn")?.locked,
			demo: (rt) => setLayer(rt, "furn", { locked: true }),
		},
		{
			title: "tut.layers.s5.title",
			body: "tut.layers.s5.body",
			task: "tut.layers.s5.task",
			target: ".canvas-menu",
			enter: (rt) => rt.select(["l-note"]),
			check: (rt) => rt.extra("l-note").layer === "bg",
			demo: (rt) => {
				rt.select(["l-note"]);
				setExtra(rt, "l-note", { layer: "bg" });
			},
		},
		{
			title: "tut.layers.s6.title",
			body: "tut.layers.s6.body",
			task: "tut.layers.s6.task",
			target: ".opc-layers-header button",
			check: (rt) => (rootOf(rt.now()).layers?.length ?? 0) > (rootOf(rt.before).layers?.length ?? 0),
			demo: (rt) => void rt.command("layers:new"),
		},
	],
};

// ---------- 7. Presentations ----------

const SLIDE_W = 1200;
const SLIDE_H = 675;
const GAP = 240;

const present: TutorialDefinition = {
	id: "present",
	icon: "presentation",
	title: "tut.present.title",
	summary: "tut.present.summary",
	modules: ["presentation", "sticky-notes", "shapes"],
	board: (t) => {
		const slide = (id: string, n: number) => group(id, t("tut.present.board.slide", { n }), (n - 1) * (SLIDE_W + GAP), 0, SLIDE_W, SLIDE_H, { [SCHEMA_KEY]: { slide: true } });
		const x = (n: number) => (n - 1) * (SLIDE_W + GAP);
		return {
			nodes: [
				slide("p-s1", 1),
				slide("p-s2", 2),
				slide("p-s3", 3),
				title("p-t1", t("tut.present.board.t1"), x(1) + 100, 220, 1000, 90),
				card("p-c1", t("tut.present.board.c1"), x(1) + 100, 360, 560, 110, { color: "5" }),
				title("p-t2", t("tut.present.board.t2"), x(2) + 100, 80, 1000, 80),
				sticky("p-a", t("tut.present.board.a"), x(2) + 120, 260, "yellow"),
				sticky("p-b", t("tut.present.board.b"), x(2) + 500, 260, "green"),
				sticky("p-c", t("tut.present.board.c"), x(2) + 880, 260, "blue"),
				shape("p-star", "star", x(3) + 470, 120, 260, 260, { color: "3" }),
				title("p-t3", t("tut.present.board.t3"), x(3) + 300, 440, 700, 90),
			],
			edges: [edge("p-e1", "p-s1", "right", "p-s2", "left"), edge("p-e2", "p-s2", "right", "p-s3", "left")],
			root: { presentation: { start: "p-s1" } },
		};
	},
	steps: [
		{ title: "tut.present.s1.title", body: "tut.present.s1.body" },
		{
			title: "tut.present.s2.title",
			body: "tut.present.s2.body",
			task: "tut.present.s2.task",
			target: ".opc-card-add-slide",
			check: (rt) => grew(rt, (n) => extraOf(n).slide === true),
			demo: (rt) => {
				const n = count(rt.now(), (node) => extraOf(node).slide === true) + 1;
				rt.add([
					group(randomId(), rt.t("tut.present.board.slide", { n }), 3 * (SLIDE_W + GAP), 0, SLIDE_W, SLIDE_H, { [SCHEMA_KEY]: { slide: true } }),
					title(randomId(), rt.t("tut.present.board.t4"), 3 * (SLIDE_W + GAP) + 200, 280, 800, 90),
				]);
				rt.look();
			},
		},
		{
			title: "tut.present.s3.title",
			body: "tut.present.s3.body",
			task: "tut.present.s3.task",
			check: (rt) => addedEdges(rt.before, rt.now()).some((e) => e.fromNode === "p-s3" || e.toNode === "p-s3"),
			demo: (rt) => {
				const fresh = nodesOf(rt.now()).find((n) => extraOf(n).slide === true && !["p-s1", "p-s2", "p-s3"].includes(n.id));
				rt.add([], [edge(randomId(), "p-s3", "right", fresh?.id ?? "p-s1", fresh ? "left" : "bottom")]);
			},
		},
		{
			title: "tut.present.s4.title",
			body: "tut.present.s4.body",
			task: "tut.present.s4.task",
			check: (rt) => rt.seen("presentation-started"),
			demo: (rt) => void rt.command("presentation:start"),
		},
		{
			title: "tut.present.s5.title",
			body: "tut.present.s5.body",
			task: "tut.present.s5.task",
			touch: "tut.present.s5.touch",
			check: (rt) => rt.seen("presentation-slide-changed", (_c, _s, index) => typeof index === "number" && index >= 1),
			demo: (rt) => {
				if (!rt.command("presentation:next")) rt.command("presentation:start");
			},
		},
		{
			title: "tut.present.s6.title",
			body: "tut.present.s6.body",
			task: "tut.present.s6.task",
			touch: "tut.present.s6.touch",
			check: (rt) => rt.seen("presentation-ended"),
			demo: (rt) => void rt.command("presentation:end"),
		},
	],
};

/** Starts a walk from the top of the map, unless one is going on. */
function ensureWalk(rt: TutorialRuntime): void {
	if (rt.canvas.wrapperEl.hasClass("opc-walking")) return;
	rt.select(["m-root"]);
	rt.command("presentation:walk");
}

// ---------- 8. Mind maps ----------

const mindmap: TutorialDefinition = {
	id: "mindmap",
	icon: "network",
	title: "tut.mindmap.title",
	summary: "tut.mindmap.summary",
	modules: ["mindmap", "branch-collapse", "auto-layout", "note-blocks", "presentation"],
	restoreSettings: [
		{ module: "presentation", key: "walkTapZones" },
		{ module: "presentation", key: "walkHints" },
	],
	board: (t) => ({
		nodes: [
			card("m-root", t("tut.mindmap.board.root"), 0, 0, 240, 80, { color: "5" }),
			card("m-tokyo", t("tut.mindmap.board.tokyo"), 360, -120, 200, 60, { color: "4" }),
			card("m-kyoto", t("tut.mindmap.board.kyoto"), 360, 140, 200, 60, { color: "6" }),
			card("m-sushi", t("tut.mindmap.board.sushi"), 680, -190, 200, 60),
			card("m-tower", t("tut.mindmap.board.tower"), 680, -60, 200, 60),
		],
		edges: [
			edge("m-e1", "m-root", "right", "m-tokyo", "left"),
			edge("m-e2", "m-root", "right", "m-kyoto", "left"),
			edge("m-e3", "m-tokyo", "right", "m-sushi", "left"),
			edge("m-e4", "m-tokyo", "right", "m-tower", "left"),
		],
	}),
	steps: [
		{
			title: "tut.mindmap.s1.title",
			body: "tut.mindmap.s1.body",
			task: "tut.mindmap.s1.task",
			touch: "tut.mindmap.s1.touch",
			enter: (rt) => rt.select(["m-kyoto"]),
			check: (rt) => addedEdges(rt.before, rt.now()).some((e) => e.fromNode === "m-kyoto"),
			demo: async (rt) => {
				rt.select(["m-kyoto"]);
				rt.command("mindmap:add-child");
				await rt.wait(350);
				const child = added(rt.before, rt.now())[0];
				const node = child && rt.node(child.id);
				if (!node) return;
				rt.command("mindmap:stop-editing");
				rt.change(() => node.setData({ ...node.getData(), text: rt.t("tut.mindmap.board.temples") }));
				rt.select([node.id]);
			},
		},
		{
			title: "tut.mindmap.s2.title",
			body: "tut.mindmap.s2.body",
			task: "tut.mindmap.s2.task",
			touch: "tut.mindmap.s2.touch",
			enter: (rt) => {
				if (rt.selected().length !== 1) rt.select(["m-tower"]);
			},
			check: (rt) => added(rt.before, rt.now()).length > 0 && addedEdges(rt.before, rt.now()).length > 0,
			demo: async (rt) => {
				if (rt.selected().length !== 1) rt.select(["m-tower"]);
				rt.command("mindmap:add-sibling");
				await rt.wait(350);
				const sib = added(rt.before, rt.now())[0];
				const node = sib && rt.node(sib.id);
				if (!node) return;
				rt.command("mindmap:stop-editing");
				rt.change(() => node.setData({ ...node.getData(), text: rt.t("tut.mindmap.board.ramen") }));
			},
		},
		{
			title: "tut.mindmap.s3.title",
			body: "tut.mindmap.s3.body",
			task: "tut.mindmap.s3.task",
			target: (rt) => rt.node("m-tokyo")?.nodeEl.querySelector<HTMLElement>(".opc-branch-toggle"),
			check: (rt) => !!rt.extra("m-tokyo").collapsed,
			demo: (rt) => setExtra(rt, "m-tokyo", { collapsed: true }),
		},
		{
			title: "tut.mindmap.s4.title",
			body: "tut.mindmap.s4.body",
			task: "tut.mindmap.s4.task",
			target: (rt) => rt.node("m-tokyo")?.nodeEl.querySelector<HTMLElement>(".opc-branch-toggle"),
			check: (rt) => !rt.extra("m-tokyo").collapsed && (!!extraOf(findNode(rt.before, "m-tokyo")).collapsed || rt.seen("undo")),
			demo: (rt) => setExtra(rt, "m-tokyo", { collapsed: undefined }),
		},
		{
			title: "tut.mindmap.move.title",
			body: "tut.mindmap.move.body",
			task: "tut.mindmap.move.task",
			focus: ["m-tower", "m-kyoto"],
			check: (rt) => rt.seen("card-relinked") || edgesOf(rt.now()).some((e) => e.toNode === "m-tower" && e.fromNode !== "m-tokyo"),
			demo: async (rt) => {
				const tower = rt.node("m-tower");
				const kyoto = rt.node("m-kyoto");
				if (!tower || !kyoto) return;
				await glide(rt, "m-tower", kyoto.x + kyoto.width + 120 - tower.x, kyoto.y - tower.y);
				rt.change(() => {
					const old = rt.canvas.edges.get("m-e4");
					if (old) rt.canvas.removeEdge(old);
					rt.canvas.importData({ nodes: [], edges: [edge("m-e5", "m-kyoto", "right", "m-tower", "left")] }, false);
				});
			},
		},
		{
			title: "tut.mindmap.s5.title",
			body: "tut.mindmap.s5.body",
			task: "tut.mindmap.s5.task",
			touch: "tut.mindmap.s5.touch",
			enter: (rt) => rt.select(["m-root"]),
			check: (rt) => rt.seen("layout-applied"),
			demo: (rt) => {
				rt.select(["m-root"]);
				rt.command("auto-layout:layout-mindmap");
			},
		},
		{
			title: "tut.mindmap.order.title",
			body: "tut.mindmap.order.body",
			task: "tut.mindmap.order.task",
			touch: "tut.mindmap.order.touch",
			focus: ["m-tokyo", "m-kyoto"],
			// Tokyo comes after Kyoto in the map's order, and a layout ran since.
			check: (rt) => {
				const list = rt.data.root(rt.canvas).get().childOrder?.["m-root"] ?? [];
				return list.indexOf("m-kyoto") >= 0 && list.indexOf("m-kyoto") < list.indexOf("m-tokyo") && rt.seen("layout-applied");
			},
			demo: async (rt) => {
				const root = rt.node("m-root");
				const tokyo = rt.node("m-tokyo");
				const kyoto = rt.node("m-kyoto");
				if (!root || !tokyo || !kyoto) return;
				await glide(rt, "m-tokyo", kyoto.x - tokyo.x, kyoto.y + kyoto.height + 40 - tokyo.y);
				rt.change(() => recordChild({ data: rt.data }, rt.canvas, root, tokyo, "m-kyoto"));
				await rt.wait(300);
				rt.select(["m-root"]);
				rt.command("auto-layout:layout-mindmap");
			},
		},
		{
			title: "tut.mindmap.condensed.title",
			body: "tut.mindmap.condensed.body",
			task: "tut.mindmap.condensed.task",
			touch: "tut.mindmap.condensed.touch",
			enter: (rt) => rt.select(["m-root"]),
			check: (rt) => rt.seen("layout-applied", (_c, _n, algorithm) => algorithm === "mindmap/condensed"),
			demo: (rt) => {
				rt.select(["m-root"]);
				rt.command("auto-layout:layout-condensed");
			},
		},
		{
			title: "tut.mindmap.walk.title",
			body: "tut.mindmap.walk.body",
			task: "tut.mindmap.walk.task",
			target: ".opc-card-walk",
			enter: (rt) => rt.select(["m-root"]),
			// The walk has moved at least once after it started.
			check: (rt) => {
				let moves = 0;
				return rt.seen("map-walk-moved", () => ++moves >= 2);
			},
			demo: async (rt) => {
				if (!rt.canvas.wrapperEl.hasClass("opc-walking")) {
					rt.select(["m-root"]);
					rt.command("presentation:walk");
					await rt.wait(700);
				}
				for (const dir of ["right", "down"]) {
					rt.canvas.wrapperEl.querySelector<HTMLElement>(`.opc-walk-${dir}`)?.click();
					await rt.wait(700);
				}
			},
		},
		{
			title: "tut.mindmap.walkTouch.title",
			body: "tut.mindmap.walkTouch.body",
			task: "tut.mindmap.walkTouch.task",
			enter: (rt) => {
				rt.setSetting("presentation", "walkTapZones", true);
				rt.setSetting("presentation", "walkHints", true);
				ensureWalk(rt);
			},
			check: (rt) => rt.seen("map-walk-moved", (_c, _n, how) => how === "tap"),
			demo: async (rt) => {
				ensureWalk(rt);
				await rt.wait(600);
				rt.canvas.wrapperEl.querySelector<HTMLElement>(".opc-walk-hint")?.click();
			},
		},
		{
			title: "tut.mindmap.walkColumns.title",
			body: "tut.mindmap.walkColumns.body",
			task: "tut.mindmap.walkColumns.task",
			target: ".opc-walk-columns",
			enter: ensureWalk,
			// Turning the columns on counts as one move, so the second is the user's.
			check: (rt) => {
				if (!rt.canvas.wrapperEl.querySelector(".opc-columns")) return false;
				let moves = 0;
				return rt.seen("map-walk-moved", () => ++moves >= 2);
			},
			demo: async (rt) => {
				ensureWalk(rt);
				await rt.wait(400);
				const wrapper = rt.canvas.wrapperEl;
				if (!wrapper.querySelector(".opc-columns")) wrapper.querySelector<HTMLElement>(".opc-walk-columns")?.click();
				await rt.wait(1000);
				wrapper.querySelector<HTMLElement>(".opc-columns-card.is-child, .opc-columns-card:not(.is-current)")?.click();
			},
		},
	],
};

// ---------- 24. The column view ----------

/** The column view's root element on the practice board, if it is open. */
const columnsEl = (rt: TutorialRuntime) => rt.canvas.wrapperEl.querySelector<HTMLElement>(".opc-columns");
const columnCard = (rt: TutorialRuntime, id: string) => columnsEl(rt)?.querySelector<HTMLElement>(`.opc-columns-card[data-id="${id}"]`) ?? null;
const columnCurrent = (rt: TutorialRuntime) => columnsEl(rt)?.querySelector<HTMLElement>(".opc-columns-card.is-current")?.dataset.id ?? "";

/** Opens the column view on the garden map, unless it is open. */
async function ensureColumns(rt: TutorialRuntime, from = "c-root"): Promise<void> {
	if (columnsEl(rt)) return;
	rt.command("presentation:walk-end");
	rt.select([from]);
	rt.command("presentation:walk-columns");
	await rt.wait(900);
}

/** Taps a card of the column view, as a finger would. */
async function tapColumnCard(rt: TutorialRuntime, id: string): Promise<void> {
	const card = columnCard(rt, id);
	if (!card) return;
	card.click();
	await rt.wait(450);
}

/** Taps its way to a card from the top of the map (the first column always shows the top card). */
async function walkToColumn(rt: TutorialRuntime, ...ids: string[]): Promise<void> {
	for (const id of ids) if (columnCurrent(rt) !== id && columnCard(rt, id)) await tapColumnCard(rt, id);
}

/** A press-and-drag on a column, as a finger moving it by `dy` pixels (and `dx` sideways). */
async function dragColumn(rt: TutorialRuntime, card: HTMLElement, dy: number, dx = 0): Promise<void> {
	const r = card.getBoundingClientRect();
	let x = r.left + Math.min(r.width / 2, 60);
	let y = r.top + Math.min(r.height / 2, 40);
	const fire = (type: string) =>
		card.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
	fire("pointerdown");
	for (let i = 1; i <= 20; i++) {
		y += dy / 20;
		x += dx / 20;
		fire("pointermove");
		await rt.wait(16);
	}
	fire("pointerup");
	await rt.wait(200);
}

const columns: TutorialDefinition = {
	id: "columns",
	icon: "columns-3",
	title: "tut.columns.title",
	summary: "tut.columns.summary",
	modules: ["presentation", "drawing", "text-highlight"],
	restoreSettings: [
		{ module: "presentation", key: "columnActualSize" },
		{ module: "presentation", key: "columnFontSize" },
		{ module: "presentation", key: "columnWidth" },
	],
	board: (t) => {
		const weeks = Array.from({ length: 16 }, (_, i) => `- ${t("tut.columns.board.week", { n: i + 1 })}`).join("\n");
		return {
			nodes: [
				card("c-root", t("tut.columns.board.root"), 0, 300, 220, 70, { color: "5" }),
				card("c-veg", t("tut.columns.board.veg"), 340, 0, 220, 60, { color: "4" }),
				card("c-tom", t("tut.columns.board.tom"), 660, -100, 240, 90, { color: "1" }),
				ink("c-tom-ink", ellipsePoints(780, -55, 105, 32), "#e03131", 4),
				card("c-car", t("tut.columns.board.car"), 660, 40, 240, 60),
				card("c-cal", `## ${t("tut.columns.board.cal")}\n\n${weeks}`, 340, 160, 260, 900),
				group("c-herbs", t("tut.columns.board.herbs"), 340, 1150, 720, 600, { color: "4" }),
				card("c-basil", t("tut.columns.board.basil"), 380, 1210, 300, 70),
				card("c-mint", t("tut.columns.board.mint"), 380, 1300, 300, 60),
				group("c-pots", t("tut.columns.board.pots"), 380, 1400, 440, 300),
				card("c-chili", t("tut.columns.board.chili"), 420, 1470, 240, 60, { color: "2" }),
				card("c-tea", t("tut.columns.board.tea"), 1200, 1300, 240, 60, { color: "6" }),
			],
			edges: [
				edge("c-e1", "c-root", "right", "c-veg", "left"),
				edge("c-e2", "c-root", "right", "c-cal", "left"),
				edge("c-e3", "c-root", "right", "c-herbs", "left"),
				edge("c-e4", "c-veg", "right", "c-tom", "left"),
				edge("c-e5", "c-veg", "right", "c-car", "left"),
				edge("c-e6", "c-herbs", "right", "c-tea", "left"),
				// An arrow into a card inside a group: the column view shows the group there.
				edge("c-e7", "c-car", "bottom", "c-basil", "top"),
			],
		};
	},
	steps: [
		{
			title: "tut.columns.s1.title",
			body: "tut.columns.s1.body",
			task: "tut.columns.s1.task",
			target: ".opc-card-walk",
			enter: (rt) => {
				rt.setSetting("presentation", "columnActualSize", false);
				rt.select(["c-root"]);
			},
			check: (rt) => !!columnsEl(rt),
			demo: (rt) => ensureColumns(rt),
		},
		{
			title: "tut.columns.drag.title",
			body: "tut.columns.drag.body",
			task: "tut.columns.drag.task",
			touch: "tut.columns.drag.touch",
			enter: (rt) => void ensureColumns(rt),
			check: (rt) => !!columnsEl(rt)?.hasClass("is-moved"),
			demo: async (rt) => {
				await ensureColumns(rt);
				const cal = columnCard(rt, "c-cal");
				if (cal) await dragColumn(rt, cal, -Math.min(600, cal.getBoundingClientRect().height * 0.7));
			},
		},
		{
			title: "tut.columns.group.title",
			body: "tut.columns.group.body",
			task: "tut.columns.group.task",
			enter: (rt) => void ensureColumns(rt),
			check: (rt) => columnCurrent(rt) === "c-herbs",
			demo: async (rt) => {
				await ensureColumns(rt);
				if (columnCurrent(rt) !== "c-root" && columnCard(rt, "c-root")) await tapColumnCard(rt, "c-root");
				await tapColumnCard(rt, "c-herbs");
			},
		},
		{
			title: "tut.columns.nested.title",
			body: "tut.columns.nested.body",
			task: "tut.columns.nested.task",
			enter: (rt) => void ensureColumns(rt, "c-herbs"),
			check: (rt) => columnCurrent(rt) === "c-pots",
			demo: async (rt) => {
				await ensureColumns(rt, "c-herbs");
				if (!columnCard(rt, "c-pots")) await tapColumnCard(rt, "c-herbs");
				await tapColumnCard(rt, "c-pots");
			},
		},
		{
			title: "tut.columns.zoom.title",
			body: "tut.columns.zoom.body",
			task: "tut.columns.zoom.task",
			touch: "tut.columns.zoom.touch",
			target: ".opc-walk-zoom-in",
			enter: (rt) => void ensureColumns(rt, "c-pots"),
			check: (rt) => !!columnsEl(rt)?.hasClass("is-zoomed"),
			demo: async (rt) => {
				await ensureColumns(rt, "c-pots");
				rt.canvas.wrapperEl.querySelector<HTMLElement>(".opc-walk-zoom-in")?.click();
			},
		},
		{
			title: "tut.columns.edit.title",
			body: "tut.columns.edit.body",
			task: "tut.columns.edit.task",
			touch: "tut.columns.edit.touch",
			enter: (rt) => void ensureColumns(rt, "c-pots"),
			check: (rt) => changedAny(rt, (n) => n.text, isPlainCard),
			demo: async (rt) => {
				await ensureColumns(rt, "c-pots");
				await walkToColumn(rt, "c-root", "c-herbs", "c-pots");
				// Two taps: the first goes to the card, the second edits it.
				columnCard(rt, "c-chili")?.click();
				await rt.wait(120);
				columnCard(rt, "c-chili")?.click();
				await rt.wait(400);
				const input = columnsEl(rt)?.querySelector<HTMLTextAreaElement>("textarea.opc-columns-editor");
				if (!input) return;
				input.value = `${input.value} 🌶️`;
				input.dispatchEvent(new Event("input"));
				await rt.wait(600);
				input.blur();
				await rt.wait(400);
			},
		},
		{
			title: "tut.columns.add.title",
			body: "tut.columns.add.body",
			task: "tut.columns.add.task",
			touch: "tut.columns.add.touch",
			enter: (rt) => void ensureColumns(rt, "c-pots"),
			check: (rt) => rt.seen("column-card-added"),
			demo: async (rt) => {
				await ensureColumns(rt, "c-pots");
				columnsEl(rt)?.querySelector<HTMLElement>(".opc-columns-card.is-current .opc-columns-add.is-child")?.click();
				await rt.wait(500);
				const input = columnsEl(rt)?.querySelector<HTMLTextAreaElement>("textarea.opc-columns-editor");
				if (!input) return;
				input.value = "🌿";
				input.dispatchEvent(new Event("input"));
				await rt.wait(500);
				input.blur();
				await rt.wait(400);
			},
		},
		{
			title: "tut.columns.into.title",
			body: "tut.columns.into.body",
			task: "tut.columns.into.task",
			enter: (rt) => void ensureColumns(rt, "c-veg"),
			check: (rt) => columnCurrent(rt) === "c-car" && !!columnCard(rt, "c-herbs"),
			demo: async (rt) => {
				await ensureColumns(rt, "c-veg");
				await walkToColumn(rt, "c-root", "c-veg", "c-car");
			},
		},
		{
			title: "tut.columns.actual.title",
			body: "tut.columns.actual.body",
			task: "tut.columns.actual.task",
			enter: (rt) => void ensureColumns(rt, "c-veg"),
			check: (rt) => rt.setting("presentation", "columnActualSize") === true && !!columnsEl(rt)?.hasClass("is-actual-size"),
			demo: async (rt) => {
				await ensureColumns(rt, "c-veg");
				if (rt.setting("presentation", "columnActualSize") !== true) rt.command("presentation:columns-actual-size");
				await rt.wait(600);
				await walkToColumn(rt, "c-root", "c-veg");
			},
		},
		{
			title: "tut.columns.resize.title",
			body: "tut.columns.resize.body",
			task: "tut.columns.resize.task",
			touch: "tut.columns.resize.touch",
			target: (rt) => columnsEl(rt)?.querySelector<HTMLElement>(".opc-columns-card.is-current .opc-columns-resize") ?? null,
			enter: (rt) => {
				if (rt.setting("presentation", "columnActualSize") !== true) rt.setSetting("presentation", "columnActualSize", true);
				void ensureColumns(rt, "c-veg");
			},
			check: (rt) => rt.seen("column-card-resized"),
			demo: async (rt) => {
				await ensureColumns(rt, "c-veg");
				if (rt.setting("presentation", "columnActualSize") !== true) rt.command("presentation:columns-actual-size");
				await rt.wait(500);
				await walkToColumn(rt, "c-root", "c-veg");
				const handle = columnsEl(rt)?.querySelector<HTMLElement>(".opc-columns-card.is-current .opc-columns-resize");
				if (!handle) return;
				// A finger dragging the handle down and to the right.
				const r = handle.getBoundingClientRect();
				let x = r.left + r.width / 2;
				let y = r.top + r.height / 2;
				const fire = (type: string) =>
					handle.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
				fire("pointerdown");
				for (let i = 1; i <= 20; i++) {
					x += 6;
					y += 4;
					fire("pointermove");
					await rt.wait(16);
				}
				fire("pointerup");
				await rt.wait(500);
			},
		},
		{
			title: "tut.columns.ink.title",
			body: "tut.columns.ink.body",
			task: "tut.columns.ink.task",
			touch: "tut.columns.ink.touch",
			target: (rt) => columnsEl(rt)?.querySelector<HTMLElement>('.opc-columns-tool[data-tool="ink"]') ?? null,
			enter: (rt) => void ensureColumns(rt, "c-veg"),
			check: (rt) => !!columnsEl(rt) && strokeCount(rt.now()) > strokeCount(rt.before),
			demo: async (rt) => {
				await ensureColumns(rt, "c-veg");
				const pen = columnsEl(rt)?.querySelector<HTMLElement>('.opc-columns-tool[data-tool="ink"]');
				if (pen && !pen.hasClass("is-active")) pen.click();
				await rt.wait(500);
				// A tick under the words of Tomatoes, as a pen would write it there.
				const tick = ink(randomId(), [{ x: 690, y: -30 }, { x: 760, y: -25 }, { x: 860, y: -32 }], "#1971c2", 4);
				(tick[SCHEMA_KEY] as Record<string, unknown>).anchor = "c-tom";
				rt.add([tick]);
				await rt.wait(400);
			},
		},
		{
			title: "tut.columns.mark.title",
			body: "tut.columns.mark.body",
			task: "tut.columns.mark.task",
			touch: "tut.columns.mark.touch",
			target: (rt) => columnsEl(rt)?.querySelector<HTMLElement>('.opc-columns-tool[data-tool="highlight"]') ?? null,
			enter: (rt) => void ensureColumns(rt, "c-veg"),
			check: (rt) => rt.seen("text-highlighted") || rt.seen("text-colored") || /==|<mark|<span style="color:/.test(findNode(rt.now(), "c-car")?.text ?? ""),
			demo: async (rt) => {
				await ensureColumns(rt, "c-veg");
				const tool = columnsEl(rt)?.querySelector<HTMLElement>('.opc-columns-tool[data-tool="highlight"]');
				if (tool && !tool.hasClass("is-active")) tool.click();
				await rt.wait(500);
				const node = rt.node("c-car");
				if (!node) return;
				const text = node.getData().text ?? "";
				rt.change(() => node.setData({ ...node.getData(), text: `==${text}==` }));
				await rt.wait(400);
			},
		},
		{ title: "tut.columns.end.title", body: "tut.columns.end.body" },
	],
};

// ---------- 25. The column view, top to bottom ----------

const columnsDown: TutorialDefinition = {
	id: "columns-down",
	icon: "rows-3",
	title: "tut.columnsDown.title",
	summary: "tut.columnsDown.summary",
	modules: ["presentation"],
	restoreSettings: [
		{ module: "presentation", key: "columnVertical" },
		{ module: "presentation", key: "columnActualSize" },
	],
	board: (t, folder) => columns.board(t, folder),
	steps: [
		{
			title: "tut.columnsDown.open.title",
			body: "tut.columnsDown.open.body",
			task: "tut.columnsDown.open.task",
			target: ".opc-columns-control",
			enter: (rt) => {
				rt.setSetting("presentation", "columnVertical", false);
				rt.setSetting("presentation", "columnActualSize", false);
				rt.select(["c-root"]);
			},
			check: (rt) => !!columnsEl(rt),
			demo: (rt) => ensureColumns(rt),
		},
		{
			title: "tut.columnsDown.flip.title",
			body: "tut.columnsDown.flip.body",
			task: "tut.columnsDown.flip.task",
			touch: "tut.columnsDown.flip.touch",
			target: (rt) => columnsEl(rt)?.querySelector<HTMLElement>(".opc-columns-flip") ?? null,
			enter: (rt) => void ensureColumns(rt),
			check: (rt) => rt.setting("presentation", "columnVertical") === true && !!columnsEl(rt)?.hasClass("is-vertical"),
			demo: async (rt) => {
				await ensureColumns(rt);
				if (rt.setting("presentation", "columnVertical") !== true) columnsEl(rt)?.querySelector<HTMLElement>(".opc-columns-flip")?.click();
				await rt.wait(700);
			},
		},
		{
			title: "tut.columnsDown.down.title",
			body: "tut.columnsDown.down.body",
			task: "tut.columnsDown.down.task",
			touch: "tut.columnsDown.down.touch",
			target: ".opc-walk-down",
			enter: (rt) => void ensureColumns(rt),
			check: (rt) => !!columnsEl(rt)?.hasClass("is-vertical") && ["c-veg", "c-cal", "c-herbs"].includes(columnCurrent(rt)),
			demo: async (rt) => {
				await ensureColumns(rt);
				await walkToColumn(rt, "c-root");
				rt.canvas.wrapperEl.querySelector<HTMLElement>(".opc-walk-down")?.click();
				await rt.wait(500);
			},
		},
		{
			title: "tut.columnsDown.row.title",
			body: "tut.columnsDown.row.body",
			task: "tut.columnsDown.row.task",
			touch: "tut.columnsDown.row.touch",
			enter: (rt) => void ensureColumns(rt),
			check: (rt) => !!columnsEl(rt)?.hasClass("is-vertical") && !!columnsEl(rt)?.hasClass("is-moved"),
			demo: async (rt) => {
				await ensureColumns(rt);
				const card = columnsEl(rt)?.querySelector<HTMLElement>(".opc-columns-card.is-current");
				if (card) await dragColumn(rt, card, 0, -240);
			},
		},
		{ title: "tut.columnsDown.end.title", body: "tut.columnsDown.end.body" },
	],
};

// ---------- 26. The table of contents ----------

const tocEl = (rt: TutorialRuntime) => rt.canvas.wrapperEl.querySelector<HTMLElement>(".opc-toc");
const tocCell = (rt: TutorialRuntime, id: string) => tocEl(rt)?.querySelector<HTMLElement>(`.opc-toc-cell[data-id="${id}"]`) ?? null;
/** The stored arrangement of a level, as text (to see that it changed). */
const tocStored = (rt: TutorialRuntime, parent: string) => JSON.stringify((rt.now()[SCHEMA_KEY] as { tocLayouts?: Record<string, unknown> } | undefined)?.tocLayouts?.[parent] ?? null);
let tocBefore = "";
/** The back step went into a cell first (so seeing the top level again means "back" worked). */
let tocWentIn = false;

/** Opens the table of contents on `from`'s children, unless it is open. */
async function ensureToc(rt: TutorialRuntime, from = "t-root"): Promise<void> {
	if (tocEl(rt)) return;
	rt.command("presentation:walk-end");
	rt.select([from]);
	rt.command("presentation:toc");
	await rt.wait(900);
}

/** Into a cell's own grid, by its arrow. */
async function tocEnter(rt: TutorialRuntime, id: string): Promise<void> {
	tocEl(rt)?.querySelector<HTMLElement>(`.opc-toc-open[data-id="${id}"]`)?.click();
	await rt.wait(500);
}

/** A finger dragging `el` from its middle to (x, y). */
async function tocDragTo(rt: TutorialRuntime, el: HTMLElement, x: number, y: number): Promise<void> {
	const r = el.getBoundingClientRect();
	const sx = r.left + Math.min(r.width / 2, 20);
	const sy = r.top + Math.min(r.height / 2, 12);
	const fire = (type: string, px: number, py: number) =>
		el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: "touch", isPrimary: true, clientX: px, clientY: py, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
	fire("pointerdown", sx, sy);
	for (let i = 1; i <= 16; i++) {
		fire("pointermove", sx + ((x - sx) * i) / 16, sy + ((y - sy) * i) / 16);
		await rt.wait(20);
	}
	fire("pointerup", x, y);
	await rt.wait(500);
}

const toc: TutorialDefinition = {
	id: "toc",
	icon: "layout-grid",
	title: "tut.toc.title",
	summary: "tut.toc.summary",
	modules: ["presentation"],
	restoreSettings: [
		{ module: "presentation", key: "tocMode" },
		{ module: "presentation", key: "tocPerRow" },
		{ module: "presentation", key: "tocActualSize" },
	],
	board: (t) => ({
		nodes: [
			card("t-root", t("tut.toc.board.root"), 0, 300, 220, 70, { color: "6" }),
			card("t-cells", t("tut.toc.board.cells"), 340, 60, 200, 60, { color: "1" }),
			card("t-gen", t("tut.toc.board.genetics"), 340, 300, 200, 60, { color: "3" }),
			card("t-eco", t("tut.toc.board.ecology"), 340, 420, 200, 60, { color: "4" }),
			card("t-evo", t("tut.toc.board.evolution"), 340, 540, 200, 60, { color: "5" }),
			card("t-nuc", t("tut.toc.board.nucleus"), 660, -200, 300, 160),
			card("t-mem", t("tut.toc.board.membrane"), 660, 0, 200, 60),
			card("t-mit", t("tut.toc.board.mito"), 660, 100, 200, 60),
			card("t-rib", t("tut.toc.board.ribosomes"), 660, 200, 200, 60),
			card("t-cyc", t("tut.toc.board.cycle"), 660, 300, 220, 140),
		],
		edges: [
			edge("t-e1", "t-root", "right", "t-cells", "left"),
			edge("t-e2", "t-root", "right", "t-gen", "left"),
			edge("t-e3", "t-root", "right", "t-eco", "left"),
			edge("t-e4", "t-root", "right", "t-evo", "left"),
			edge("t-e5", "t-cells", "right", "t-nuc", "left"),
			edge("t-e6", "t-cells", "right", "t-mem", "left"),
			edge("t-e7", "t-cells", "right", "t-mit", "left"),
			edge("t-e8", "t-cells", "right", "t-rib", "left"),
			edge("t-e9", "t-cells", "right", "t-cyc", "left"),
		],
	}),
	steps: [
		{
			title: "tut.toc.open.title",
			body: "tut.toc.open.body",
			task: "tut.toc.open.task",
			target: ".opc-toc-control",
			enter: (rt) => {
				rt.setSetting("presentation", "tocMode", "free");
				rt.setSetting("presentation", "tocPerRow", 3);
				rt.setSetting("presentation", "tocActualSize", false);
				rt.select(["t-root"]);
			},
			check: (rt) => !!tocEl(rt),
			demo: (rt) => ensureToc(rt),
		},
		{
			title: "tut.toc.enter.title",
			body: "tut.toc.enter.body",
			task: "tut.toc.enter.task",
			touch: "tut.toc.enter.touch",
			target: (rt) => tocEl(rt)?.querySelector<HTMLElement>('.opc-toc-open[data-id="t-cells"]') ?? null,
			enter: (rt) => void ensureToc(rt),
			check: (rt) => rt.seen("toc-shown", (_c, parent) => parent === "t-cells"),
			demo: async (rt) => {
				await ensureToc(rt);
				await tocEnter(rt, "t-cells");
			},
		},
		{
			title: "tut.toc.back.title",
			body: "tut.toc.back.body",
			task: "tut.toc.back.task",
			touch: "tut.toc.back.touch",
			target: (rt) => tocEl(rt)?.querySelector<HTMLElement>(".opc-toc-back.is-fixed") ?? null,
			enter: (rt) => {
				tocWentIn = false;
				void (async () => {
					await ensureToc(rt);
					if (!tocCell(rt, "t-nuc")) await tocEnter(rt, "t-cells");
					tocWentIn = !!tocCell(rt, "t-nuc");
				})();
			},
			check: (rt) => tocWentIn && !!tocEl(rt) && !!tocCell(rt, "t-cells"),
			demo: async (rt) => {
				tocEl(rt)?.querySelector<HTMLElement>(".opc-toc-back.is-fixed")?.click();
				await rt.wait(500);
			},
		},
		{
			title: "tut.toc.simple.title",
			body: "tut.toc.simple.body",
			task: "tut.toc.simple.task",
			touch: "tut.toc.simple.touch",
			target: (rt) => tocEl(rt)?.querySelector<HTMLElement>(".opc-toc-mode") ?? null,
			enter: (rt) => void ensureToc(rt),
			check: (rt) => rt.setting("presentation", "tocMode") === "simple",
			demo: async (rt) => {
				await ensureToc(rt);
				if (rt.setting("presentation", "tocMode") !== "simple") tocEl(rt)?.querySelector<HTMLElement>(".opc-toc-mode")?.click();
				await rt.wait(500);
			},
		},
		{
			title: "tut.toc.group.title",
			body: "tut.toc.group.body",
			task: "tut.toc.group.task",
			touch: "tut.toc.group.touch",
			enter: (rt) => {
				rt.setSetting("presentation", "tocMode", "free");
				void (async () => {
					await ensureToc(rt);
					if (!tocCell(rt, "t-nuc")) await tocEnter(rt, "t-cells");
				})();
			},
			check: (rt) => /"dir"/.test(tocStored(rt, "t-cells")),
			demo: async (rt) => {
				await ensureToc(rt);
				if (!tocCell(rt, "t-nuc")) await tocEnter(rt, "t-cells");
				const mem = tocCell(rt, "t-mem");
				const nuc = tocCell(rt, "t-nuc")?.getBoundingClientRect();
				if (mem && nuc) await tocDragTo(rt, mem, nuc.right - 4, nuc.top + nuc.height / 2);
			},
		},
		{
			title: "tut.toc.color.title",
			body: "tut.toc.color.body",
			task: "tut.toc.color.task",
			touch: "tut.toc.color.touch",
			target: (rt) => tocEl(rt)?.querySelector<HTMLElement>(".opc-toc-grip") ?? null,
			enter: (rt) => {
				tocBefore = tocStored(rt, "t-cells");
			},
			check: (rt) => tocStored(rt, "t-cells") !== tocBefore && /"color"/.test(tocStored(rt, "t-cells")),
			demo: async (rt) => {
				const grip = tocEl(rt)?.querySelector<HTMLElement>(".opc-toc-grip");
				if (!grip) return;
				const r = grip.getBoundingClientRect();
				const fire = (type: string) => grip.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 12, pointerType: "touch", isPrimary: true, clientX: r.left + 6, clientY: r.top + 6, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
				fire("pointerdown");
				fire("pointerup");
				await rt.wait(400);
				const items = Array.from(rt.canvas.wrapperEl.doc.querySelectorAll<HTMLElement>(".menu .menu-item"));
				(items.find((i) => !i.querySelector(".menu-item-icon .lucide-check") && !i.hasClass("is-disabled")) ?? items[0])?.click();
				await rt.wait(400);
			},
		},
		{
			title: "tut.toc.move.title",
			body: "tut.toc.move.body",
			task: "tut.toc.move.task",
			touch: "tut.toc.move.touch",
			enter: (rt) => {
				tocBefore = tocStored(rt, "t-cells");
			},
			check: (rt) => tocStored(rt, "t-cells") !== tocBefore,
			demo: async (rt) => {
				const cyc = tocCell(rt, "t-cyc");
				const grid = tocEl(rt)?.querySelector<HTMLElement>(".opc-toc-grid")?.getBoundingClientRect();
				if (cyc && grid) await tocDragTo(rt, cyc, grid.left + 30, grid.bottom - 2);
			},
		},
		{
			title: "tut.toc.actual.title",
			body: "tut.toc.actual.body",
			task: "tut.toc.actual.task",
			touch: "tut.toc.actual.touch",
			target: (rt) => tocEl(rt)?.querySelector<HTMLElement>(".opc-toc-actual") ?? null,
			enter: (rt) => void ensureToc(rt),
			check: (rt) => rt.setting("presentation", "tocActualSize") === true && !!tocEl(rt)?.hasClass("is-actual-size"),
			demo: async (rt) => {
				await ensureToc(rt);
				if (rt.setting("presentation", "tocActualSize") !== true) tocEl(rt)?.querySelector<HTMLElement>(".opc-toc-actual")?.click();
				await rt.wait(500);
			},
		},
		{ title: "tut.toc.end.title", body: "tut.toc.end.body" },
	],
};

// ---------- 27. Automatic headers ----------

/** The note of the practice board, as text ("" when it is not open). */
const noteText = (rt: TutorialRuntime) => noteTab(rt)?.view.editor?.getValue() ?? "";

const autoHeaders: TutorialDefinition = {
	id: "auto-headers",
	icon: "heading",
	title: "tut.autoHeaders.title",
	summary: "tut.autoHeaders.summary",
	modules: ["canvas-markdown"],
	restoreSettings: [
		{ module: "canvas-markdown", key: "autoHeaders" },
		{ module: "canvas-markdown", key: "autoHeaderChildren" },
		{ module: "canvas-markdown", key: "autoHeaderDepth" },
	],
	board: (t) => ({
		nodes: [
			card("ah-root", t("tut.toc.board.root"), 0, 300, 220, 70, { color: "6" }),
			card("ah-cells", t("tut.toc.board.cells"), 340, 60, 200, 60, { color: "1" }),
			card("ah-gen", t("tut.toc.board.genetics"), 340, 360, 200, 60, { color: "3" }),
			card("ah-eco", t("tut.toc.board.ecology"), 340, 520, 200, 60, { color: "4" }),
			card("ah-nuc", t("tut.toc.board.nucleus"), 660, -120, 300, 80),
			card("ah-mem", t("tut.toc.board.membrane"), 660, 0, 200, 60),
			card("ah-mit", t("tut.toc.board.mito"), 660, 100, 200, 60),
			card("ah-rib", t("tut.toc.board.ribosomes"), 660, 200, 200, 60),
			card("ah-dna", t("tut.autoHeaders.board.dna"), 660, 360, 200, 60),
		],
		edges: [
			edge("ah-e1", "ah-root", "right", "ah-cells", "left"),
			edge("ah-e2", "ah-root", "right", "ah-gen", "left"),
			edge("ah-e3", "ah-root", "right", "ah-eco", "left"),
			edge("ah-e4", "ah-cells", "right", "ah-nuc", "left"),
			edge("ah-e5", "ah-cells", "right", "ah-mem", "left"),
			edge("ah-e6", "ah-cells", "right", "ah-mit", "left"),
			edge("ah-e7", "ah-cells", "right", "ah-rib", "left"),
			edge("ah-e8", "ah-gen", "right", "ah-dna", "left"),
		],
	}),
	steps: [
		{
			title: "tut.autoHeaders.children.title",
			body: "tut.autoHeaders.children.body",
			task: "tut.autoHeaders.children.task",
			enter: (rt) => {
				rt.setSetting("canvas-markdown", "autoHeaders", "off");
				rt.setSetting("canvas-markdown", "autoHeaderChildren", 3);
				rt.setSetting("canvas-markdown", "autoHeaderDepth", 3);
			},
			check: (rt) => rt.setting("canvas-markdown", "autoHeaders") === "children",
			demo: (rt) => rt.setSetting("canvas-markdown", "autoHeaders", "children"),
		},
		{
			title: "tut.autoHeaders.see.title",
			body: "tut.autoHeaders.see.body",
			task: "tut.autoHeaders.see.task",
			target: (rt) => canvasSwitch(rt),
			check: (rt) => noteText(rt).includes(`## ${rt.t("tut.toc.board.cells")}`),
			demo: (rt) => pressSwitch(rt, canvasSwitch(rt), false),
		},
		{
			title: "tut.autoHeaders.depth.title",
			body: "tut.autoHeaders.depth.body",
			task: "tut.autoHeaders.depth.task",
			target: (rt) => canvasSwitch(rt),
			check: (rt) => rt.setting("canvas-markdown", "autoHeaders") === "depth" && noteText(rt).includes(`### ${rt.t("tut.autoHeaders.board.dna")}`),
			demo: async (rt) => {
				rt.setSetting("canvas-markdown", "autoHeaders", "depth");
				await rt.wait(300);
				await pressSwitch(rt, canvasSwitch(rt), false);
			},
		},
		{
			title: "tut.autoHeaders.own.title",
			body: "tut.autoHeaders.own.body",
			task: "tut.autoHeaders.own.task",
			touch: "tut.autoHeaders.own.touch",
			enter: (rt) => {
				const leaf = (rt.canvas.view as unknown as { leaf?: unknown }).leaf;
				if (leaf) (rt.app.workspace as unknown as { setActiveLeaf(l: unknown, o?: object): void }).setActiveLeaf(leaf, { focus: true });
				rt.select(["ah-gen"]);
			},
			target: () => document.querySelector<HTMLElement>(".canvas-menu .opc-menu-header"),
			check: (rt) => rt.extra("ah-gen").header === -1,
			demo: (rt) => {
				const node = rt.node("ah-gen");
				if (node) rt.change(() => rt.data.node(node).set({ header: -1 }));
			},
		},
		{ title: "tut.autoHeaders.end.title", body: "tut.autoHeaders.end.body" },
	],
};

// ---------- 28. Handwriting tools ----------

const handwriting: TutorialDefinition = {
	id: "handwriting",
	icon: "signature",
	title: "tut.hand.title",
	summary: "tut.hand.summary",
	modules: ["drawing", "text-align"],
	board: (t) => {
		const mark = ink("h-ink", [{ x: 30, y: 78 }, { x: 120, y: 82 }, { x: 260, y: 76 }], "#e03131", 4);
		(mark[SCHEMA_KEY] as Record<string, unknown>).anchor = "h-card";
		return {
			nodes: [card("h-card", t("tut.hand.board.card"), 0, 0, 300, 100, { color: "4" }), mark],
			edges: [],
		};
	},
	steps: [
		{
			title: "tut.hand.write.title",
			body: "tut.hand.write.body",
			task: "tut.hand.write.task",
			touch: "tut.hand.write.touch",
			target: (rt) => Array.from(rt.canvas.wrapperEl.querySelectorAll<HTMLElement>(".opc-ink-toolbar .opc-ink-button")).find((b) => b.querySelector(".lucide-text-cursor-input")) ?? null,
			check: (rt) => rt.seen("handwriting-to-text"),
			demo: async (rt) => {
				rt.command("drawing:handwrite-text");
				await rt.wait(500);
				const area = rt.canvas.wrapperEl.doc.querySelector<HTMLTextAreaElement>(".opc-handwrite-area");
				if (!area) return;
				area.value = rt.t("tut.hand.demoText");
				await rt.wait(400);
				rt.canvas.wrapperEl.doc.querySelector<HTMLElement>(".opc-handwrite-modal .mod-cta")?.click();
				await rt.wait(400);
			},
		},
		{
			title: "tut.hand.font.title",
			body: "tut.hand.font.body",
			task: "tut.hand.font.task",
			touch: "tut.hand.font.touch",
			enter: (rt) => {
				if (rt.canvas.wrapperEl.querySelector(".opc-ink-overlay")) rt.command("drawing:toggle-drawing");
				rt.select(["h-card"]);
			},
			target: () => document.querySelector<HTMLElement>(".canvas-menu .opc-menu-font-size"),
			check: (rt) => rt.extra("h-card").font === "hand",
			demo: (rt) => {
				const node = rt.node("h-card");
				if (node) rt.change(() => rt.data.node(node).set({ font: "hand" }));
			},
		},
		{
			title: "tut.hand.embed.title",
			body: "tut.hand.embed.body",
			task: "tut.hand.embed.task",
			touch: "tut.hand.embed.touch",
			enter: (rt) => rt.select(["h-card"]),
			check: (rt) => rt.seen("drawing-embedded"),
			demo: async (rt) => {
				rt.select(["h-card"]);
				rt.command("drawing:embed-drawing");
				await rt.wait(1200);
			},
		},
		{ title: "tut.hand.end.title", body: "tut.hand.end.body" },
	],
};

// ---------- 9. Finding your way ----------

const CAMP = { w: 900, h: 560 };

const navigate: TutorialDefinition = {
	id: "navigate",
	icon: "compass",
	title: "tut.navigate.title",
	summary: "tut.navigate.summary",
	modules: ["minimap", "grid", "frames", "canvas-search", "focus-mode"],
	restoreSettings: [
		{ module: "minimap", key: "visible" },
		{ module: "grid", key: "visible" },
	],
	board: (t) => {
		const camp = (id: string, key: "north" | "south" | "east" | "west", x: number, y: number, color: string) => group(id, t(`tut.navigate.board.${key}`), x, y, CAMP.w, CAMP.h, { color });
		return {
			nodes: [
				card("v-here", t("tut.navigate.board.here"), -150, -60, 300, 120, { color: "5" }),
				camp("v-n", "north", -450, -2200, "4"),
				camp("v-s", "south", -450, 1700, "2"),
				camp("v-e", "east", 2400, -280, "6"),
				camp("v-w", "west", -3300, -280, "3"),
				sticky("v-n1", t("tut.navigate.board.tent"), -380, -2100, "green"),
				sticky("v-s1", t("tut.navigate.board.fire"), -380, 1800, "orange"),
				sticky("v-w1", t("tut.navigate.board.map"), -3220, -180, "yellow"),
				card("v-treasure", t("tut.navigate.board.treasure"), 2700, -40, 320, 120, { color: "3" }),
			],
			edges: [],
		};
	},
	steps: [
		{
			title: "tut.navigate.s1.title",
			body: "tut.navigate.s1.body",
			task: "tut.navigate.s1.task",
			target: ".opc-minimap-control",
			focus: ["v-here"],
			check: (rt) => rt.setting("minimap", "visible") === true,
			demo: (rt) => void rt.command("minimap:toggle"),
		},
		{
			title: "tut.navigate.s2.title",
			body: "tut.navigate.s2.body",
			task: "tut.navigate.s2.task",
			target: ".opc-minimap",
			check: (rt) => viewingNode(rt, "v-s"),
			demo: (rt) => rt.look(["v-s"], 200),
		},
		{
			title: "tut.navigate.s3.title",
			body: "tut.navigate.s3.body",
			task: "tut.navigate.s3.task",
			check: (rt) => viewingNode(rt, "v-treasure", 300),
			demo: async (rt) => {
				rt.command("canvas-search:search-canvas");
				await rt.wait(200);
				const input = rt.canvas.wrapperEl.querySelector<HTMLInputElement>(".opc-search-bar input");
				if (input) {
					const word = rt.t("tut.navigate.board.word");
					for (let i = 1; i <= word.length; i++) {
						input.value = word.slice(0, i);
						input.dispatchEvent(new Event("input", { bubbles: true }));
						await rt.wait(70);
					}
					input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
				}
				await rt.wait(500);
				if (!viewingNode(rt, "v-treasure", 300)) rt.look(["v-treasure"], 300);
			},
		},
		{
			title: "tut.navigate.s4.title",
			body: "tut.navigate.s4.body",
			task: "tut.navigate.s4.task",
			target: ".opc-frames-control",
			check: (rt) => (rt.seen("frame-focused") || rt.selected().includes("v-e")) && viewingNode(rt, "v-e", 400),
			demo: async (rt) => {
				rt.command("frames:open");
				await rt.wait(500);
				const name = rt.t("tut.navigate.board.east");
				const item = [...activeDocument.querySelectorAll<HTMLElement>(".opc-frames-item")].find((el) => el.textContent?.includes(name));
				if (item) item.click();
				else rt.look(["v-e"], 200);
			},
		},
		{
			title: "tut.navigate.s5.title",
			body: "tut.navigate.s5.body",
			task: "tut.navigate.s5.task",
			enter: (rt) => rt.select(["v-treasure"]),
			check: (rt) => rt.seen("focus-mode-changed", (_c, on) => on === true),
			demo: (rt) => {
				if (rt.selected().length === 0) rt.select(["v-treasure"]);
				rt.command("focus-mode:toggle-focus-mode");
			},
		},
		{
			title: "tut.navigate.s6.title",
			body: "tut.navigate.s6.body",
			task: "tut.navigate.s6.task",
			target: ".opc-grid-control",
			check: (rt) => rt.setting("grid", "visible") === true,
			demo: (rt) => void rt.command("grid:toggle"),
		},
		{ title: "tut.navigate.memory.title", body: "tut.navigate.memory.body" },
	],
};

// ---------- 10. Groups and templates ----------

const organize: TutorialDefinition = {
	id: "organize",
	icon: "layout-grid",
	title: "tut.organize.title",
	summary: "tut.organize.summary",
	modules: ["collapsible-groups", "create-group", "board-templates", "canvas-commands", "sticky-notes"],
	board: (t) => ({
		nodes: [
			title("o-title", t("tut.organize.board.title"), 0, -170),
			group("o-todo", t("tut.organize.board.todo"), 0, 0, 520, 300, { color: "1" }),
			group("o-done", t("tut.organize.board.done"), 600, 0, 520, 300, { color: "4" }),
			sticky("o-1", t("tut.organize.board.n1"), 40, 60, "pink"),
			sticky("o-2", t("tut.organize.board.n2"), 280, 60, "orange"),
			sticky("o-3", t("tut.organize.board.n3"), 640, 60, "green"),
			card("o-a", t("tut.organize.board.a"), 0, 400, 240, 90),
			card("o-b", t("tut.organize.board.b"), 280, 400, 240, 90),
		],
		edges: [],
	}),
	steps: [
		{
			title: "tut.organize.s1.title",
			body: "tut.organize.s1.body",
			task: "tut.organize.s1.task",
			target: (rt) => rt.node("o-done")?.nodeEl.querySelector<HTMLElement>(".opc-collapse-toggle"),
			check: (rt) => count(rt.now(), (n) => isGroup(n) && extraOf(n).collapsed === true) > count(rt.before, (n) => isGroup(n) && extraOf(n).collapsed === true),
			demo: (rt) => setExtra(rt, "o-done", { collapsed: true }),
		},
		{
			title: "tut.organize.s2.title",
			body: "tut.organize.s2.body",
			task: "tut.organize.s2.task",
			target: ".canvas-node.opc-collapsed .opc-collapse-toggle",
			check: (rt) => count(rt.now(), (n) => isGroup(n) && extraOf(n).collapsed === true) < count(rt.before, (n) => isGroup(n) && extraOf(n).collapsed === true),
			demo: (rt) => {
				for (const n of nodesOf(rt.now())) if (isGroup(n) && extraOf(n).collapsed === true) setExtra(rt, n.id, { collapsed: undefined });
			},
		},
		{
			title: "tut.organize.s3.title",
			body: "tut.organize.s3.body",
			task: "tut.organize.s3.task",
			enter: (rt) => rt.select(["o-a", "o-b"]),
			check: (rt) => {
				const a = findNode(rt.now(), "o-a");
				const b = findNode(rt.now(), "o-b");
				if (!a || !b) return false;
				const inside = (g: CanvasNodeData, n: CanvasNodeData) => n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height;
				return added(rt.before, rt.now()).some((g) => isGroup(g) && inside(g, a) && inside(g, b));
			},
			demo: (rt) => {
				rt.select(["o-a", "o-b"]);
				rt.command("canvas-commands:group-selection");
			},
		},
		{
			title: "tut.organize.s4.title",
			body: "tut.organize.s4.body",
			task: "tut.organize.s4.task",
			target: ".opc-card-create-group",
			check: (rt) => grew(rt, isGroup),
			demo: (rt) => {
				rt.add([group(randomId(), rt.t("tut.organize.board.new"), 600, 380, 520, 260)]);
			},
		},
		{
			title: "tut.organize.s5.title",
			body: "tut.organize.s5.body",
			task: "tut.organize.s5.task",
			target: ".opc-card-insert-template",
			check: (rt) => rt.seen("board-template-applied") || added(rt.before, rt.now()).length >= 4,
			demo: (rt) => {
				const data = shiftData(reid(builtinTemplate("swot", rt.t, false), () => randomId()), 1300, 0);
				rt.add(data.nodes ?? [], data.edges ?? []);
				rt.look();
			},
		},
	],
};

// ---------- 11. Canvas ⇄ Markdown ----------

/** The header switch button of the Canvas ⇄ Markdown module. */
const SWITCH_BUTTON = ".opc-markdown-switch";

/** The parts of a note tab the tutorial reads and types into (no Obsidian import: tests load this file). */
interface NoteTab {
	file?: { path: string } | null;
	containerEl: HTMLElement;
	editor?: { getValue(): string; getLine(line: number): string; lineCount(): number; replaceRange(text: string, from: { line: number; ch: number }): void; setCursor(line: number, ch?: number): void };
}

/** The tab showing the note written from the practice board. */
const noteTab = (rt: TutorialRuntime) => {
	const path = rt.canvas.view.file?.path.replace(/\.canvas$/, ".md");
	const leaf = rt.app.workspace.getLeavesOfType("markdown").find((l) => (l.view as unknown as NoteTab).file?.path === path);
	return leaf ? { leaf, view: leaf.view as unknown as NoteTab } : null;
};

/** Bullets with text in the note's outline. */
function bulletCount(text: string): number {
	const end = text.indexOf("\n%%\n## canvas-data");
	const outline = end >= 0 ? text.slice(0, end) : text;
	return outline.split("\n").filter((l) => /^\s*(?:[-+*]|\d{1,9}[.)])\s+\S/.test(l)).length;
}

/** Bullets in the note when the editing step began (the user is to add one). */
let bulletsBefore = Infinity;

/** Clicks a header switch button, or runs the command when the buttons are hidden. */
async function pressSwitch(rt: TutorialRuntime, button: HTMLElement | null | undefined, inNote: boolean): Promise<void> {
	if (button) button.click();
	else if (!inNote) rt.command("canvas-markdown:toggle-view");
	else {
		const tab = noteTab(rt);
		if (!tab) return;
		rt.app.workspace.setActiveLeaf(tab.leaf, { focus: true });
		const commands = (rt.app as unknown as { commands: { commands: Record<string, unknown>; executeCommandById(id: string): boolean } }).commands;
		const id = Object.keys(commands.commands).find((k) => k.endsWith(":canvas-markdown:toggle-view"));
		if (id) commands.executeCommandById(id);
	}
	await rt.wait(1500);
}

/**
 * Frames the whole board clear of the coach panel, measured on screen: beside it or below it,
 * whichever shows the board bigger (narrow canvases leave little room beside it).
 */
function frameClearOfPanel(rt: TutorialRuntime, pad = 60): void {
	const panel = rt.canvas.wrapperEl.querySelector<HTMLElement>(".opc-tutorial");
	const boxes = [...rt.canvas.nodes.values()].map((n) => n.getBBox());
	if (!panel || boxes.length === 0) return rt.look();
	const minX = Math.min(...boxes.map((b) => b.minX)) - pad;
	const minY = Math.min(...boxes.map((b) => b.minY)) - pad;
	const maxX = Math.max(...boxes.map((b) => b.maxX)) + pad;
	const maxY = Math.max(...boxes.map((b) => b.maxY)) + pad;
	const w = rt.canvas.wrapperEl.getBoundingClientRect();
	const p = panel.getBoundingClientRect();
	// Shares of the view taken by the panel (beside / above the board) and by the bottom card bar.
	const fx = Math.min(0.7, (p.width + 24) / w.width);
	const fy = Math.min(0.6, (p.bottom - w.top + 24) / w.height);
	const bar = rt.canvas.cardMenuEl.getBoundingClientRect();
	const fb = bar.height > 0 ? Math.min(0.3, (w.bottom - bar.top + 12) / w.height) : 0;
	const bw = maxX - minX;
	const bh = maxY - minY;
	const beside = Math.min((w.width * (1 - fx)) / bw, (w.height * (1 - fb)) / bh);
	const below = Math.min(w.width / bw, (w.height * (1 - fy - fb)) / bh);
	if (beside >= below) {
		const extra = (bw * fx) / (1 - fx);
		const right = panel.hasClass("is-right");
		rt.canvas.zoomToBbox({ minX: right ? minX : minX - extra, minY, maxX: right ? maxX + extra : maxX, maxY: maxY + (bh * fb) / (1 - fb) });
	} else rt.canvas.zoomToBbox({ minX, minY: minY - (bh * fy) / (1 - fy - fb), maxX, maxY: maxY + (bh * fb) / (1 - fy - fb) });
}

const canvasSwitch = (rt: TutorialRuntime) => rt.canvas.view.containerEl.querySelector<HTMLElement>(SWITCH_BUTTON);
const noteSwitch = (rt: TutorialRuntime) => noteTab(rt)?.view.containerEl.querySelector<HTMLElement>(SWITCH_BUTTON);

const markdown: TutorialDefinition = {
	id: "markdown",
	icon: "arrow-left-right",
	title: "tut.markdown.title",
	summary: "tut.markdown.summary",
	modules: ["canvas-markdown"],
	restoreSettings: [{ module: "canvas-markdown", key: "plainFirst" }],
	board: (t) => ({
		nodes: [
			card("md-root", t("tut.markdown.board.root"), 0, 0, 240, 80, { color: "5" }),
			card("md-rocky", t("tut.markdown.board.rocky"), 340, -120, 220, 60, { color: "2" }),
			card("md-giants", t("tut.markdown.board.giants"), 340, 140, 220, 60, { color: "6" }),
			card("md-earth", t("tut.markdown.board.earth"), 660, -190, 200, 60),
			card("md-mars", t("tut.markdown.board.mars"), 660, -60, 200, 60),
			card("md-jupiter", t("tut.markdown.board.jupiter"), 660, 140, 200, 60),
		],
		edges: [
			edge("md-e1", "md-root", "right", "md-rocky", "left"),
			edge("md-e2", "md-root", "right", "md-giants", "left"),
			edge("md-e3", "md-rocky", "right", "md-earth", "left"),
			edge("md-e4", "md-rocky", "right", "md-mars", "left"),
			edge("md-e5", "md-giants", "right", "md-jupiter", "left"),
		],
	}),
	steps: [
		{ title: "tut.markdown.s1.title", body: "tut.markdown.s1.body" },
		{
			title: "tut.markdown.s2.title",
			body: "tut.markdown.s2.body",
			task: "tut.markdown.s2.task",
			enter: (rt) => {
				rt.select(["md-root"]);
				// The card to right-click is on the panel's side of the map; measure the panel once
				// this step's text is in it.
				void rt.wait(60).then(() => frameClearOfPanel(rt));
			},
			check: (rt) => rt.seen("outline-copied"),
			demo: (rt) => {
				rt.select(["md-root"]);
				rt.command("canvas-markdown:copy-outline");
			},
		},
		{
			title: "tut.markdown.s3.title",
			body: "tut.markdown.s3.body",
			task: "tut.markdown.s3.task",
			touch: "tut.markdown.s3.touch",
			check: (rt) => rt.seen("outline-inserted") || (added(rt.before, rt.now()).length >= 3 && addedEdges(rt.before, rt.now()).length >= 2),
			demo: async (rt) => {
				rt.select(["md-root"]);
				rt.command("canvas-markdown:copy-outline");
				await rt.wait(400);
				rt.canvas.deselectAll();
				// Paste lands in the middle of the view: look at the empty space below the map first.
				rt.canvas.panTo(330, 600);
				await rt.wait(300);
				rt.command("canvas-markdown:paste-outline");
				await rt.wait(900);
				frameClearOfPanel(rt);
			},
		},
		{
			title: "tut.markdown.header.title",
			body: "tut.markdown.header.body",
			task: "tut.markdown.header.task",
			touch: "tut.markdown.header.touch",
			enter: (rt) => rt.select(["md-rocky"]),
			target: () => document.querySelector<HTMLElement>(".canvas-menu .opc-menu-header"),
			check: (rt) => rt.extra("md-rocky").header !== undefined,
			demo: (rt) => {
				const node = rt.node("md-rocky");
				if (node) rt.change(() => rt.data.node(node).set({ header: 0 }));
			},
		},
		{
			title: "tut.markdown.s4.title",
			body: "tut.markdown.s4.body",
			task: "tut.markdown.s4.task",
			target: canvasSwitch,
			check: (rt) => !!noteTab(rt),
			demo: (rt) => pressSwitch(rt, canvasSwitch(rt), false),
		},
		{
			title: "tut.markdown.s5.title",
			body: "tut.markdown.s5.body",
			task: "tut.markdown.s5.task",
			enter: (rt) => {
				const text = noteTab(rt)?.view.editor?.getValue();
				bulletsBefore = text === undefined ? Infinity : bulletCount(text);
			},
			check: (rt) => {
				const text = noteTab(rt)?.view.editor?.getValue();
				if (text === undefined) return false;
				// The note may have opened only now (a step skipped back and forth).
				if (bulletsBefore === Infinity) bulletsBefore = bulletCount(text);
				return bulletCount(text) > bulletsBefore;
			},
			demo: async (rt) => {
				if (!noteTab(rt)) await pressSwitch(rt, canvasSwitch(rt), false);
				const editor = noteTab(rt)?.view.editor;
				if (!editor) return;
				const label = rt.t("tut.markdown.board.giants");
				let line = -1;
				for (let i = 0; i < editor.lineCount(); i++)
					if (editor.getLine(i).includes(label)) {
						line = i;
						break;
					}
				if (line < 0) return;
				const indent = /^\s*/.exec(editor.getLine(line))![0];
				const text = `${indent}\t- ${rt.t("tut.markdown.board.saturn")}\n`;
				editor.replaceRange(text, { line: line + 1, ch: 0 });
				editor.setCursor(line + 1, text.length - 1);
			},
		},
		{
			title: "tut.markdown.s6.title",
			body: "tut.markdown.s6.body",
			task: "tut.markdown.s6.task",
			target: noteSwitch,
			check: (rt) => rt.seen("canvas-updated-from-note"),
			demo: async (rt) => {
				await pressSwitch(rt, noteSwitch(rt), true);
				frameClearOfPanel(rt);
			},
		},
		{
			title: "tut.markdown.plain.title",
			body: "tut.markdown.plain.body",
			task: "tut.markdown.plain.task",
			target: canvasSwitch,
			// On for this practice board only: your own setting comes back when the tutorial ends.
			enter: (rt) => rt.setSetting("canvas-markdown", "plainFirst", true),
			check: (rt) => {
				const text = noteTab(rt)?.view.editor?.getValue();
				const giants = rt.t("tut.markdown.board.giants");
				return !!text && text.split("\n").some((l) => l.startsWith(giants));
			},
			demo: (rt) => pressSwitch(rt, canvasSwitch(rt), false),
		},
		{ title: "tut.markdown.s7.title", body: "tut.markdown.s7.body" },
	],
};

// ---------- 12. Lasso, cut and paste ----------

const select: TutorialDefinition = {
	id: "select",
	icon: "lasso-select",
	title: "tut.select.title",
	summary: "tut.select.summary",
	modules: ["lasso", "clipboard", "edge-tools"],
	board: (t) => ({
		nodes: [
			card("sel-root", t("tut.select.board.root"), 0, 0, 240, 80, { color: "5" }),
			card("sel-a", t("tut.select.board.a"), 340, -110, 220, 60),
			card("sel-b", t("tut.select.board.b"), 340, 40, 220, 60),
			card("sel-c", t("tut.select.board.c"), 340, 190, 220, 60),
			ink("sel-ink", ellipsePoints(450, -80, 140, 55), "#e03131", 4),
			group("sel-later", t("tut.select.board.later"), 760, -140, 460, 420, { color: "4" }),
		],
		edges: [edge("sel-e1", "sel-root", "right", "sel-a", "left"), edge("sel-e2", "sel-root", "right", "sel-b", "left"), edge("sel-e3", "sel-root", "right", "sel-c", "left")],
	}),
	steps: [
		{ title: "tut.select.s1.title", body: "tut.select.s1.body" },
		{
			title: "tut.select.s2.title",
			body: "tut.select.s2.body",
			task: "tut.select.s2.task",
			target: ".opc-card-lasso",
			enter: (rt) => rt.canvas.deselectAll(),
			check: (rt) => rt.seen("lasso-selected", (_c, items) => Array.isArray(items) && items.length >= 2) || rt.selected().filter((id) => id.startsWith("sel-")).length >= 3,
			demo: async (rt) => {
				rt.command("lasso:lasso");
				await rt.wait(700);
				rt.command("lasso:lasso");
				rt.select(["sel-root", "sel-a", "sel-b", "sel-e1", "sel-e2", "sel-ink"]);
			},
		},
		{
			title: "tut.select.move.title",
			body: "tut.select.move.body",
			task: "tut.select.move.task",
			check: (rt) => moved(rt, "sel-a") || moved(rt, "sel-b") || moved(rt, "sel-root"),
			demo: async (rt) => {
				if (rt.selected().length === 0) rt.select(["sel-root", "sel-a", "sel-b", "sel-e1", "sel-e2", "sel-ink"]);
				await Promise.all(["sel-root", "sel-a", "sel-b", "sel-ink"].map((id) => glide(rt, id, 0, 60)));
			},
		},
		{
			title: "tut.select.s3.title",
			body: "tut.select.s3.body",
			task: "tut.select.s3.task",
			check: (rt) => {
				const before = new Map(edgesOf(rt.before).map((e) => [e.id, e.color ?? ""]));
				return edgesOf(rt.now()).some((e) => before.has(e.id) && before.get(e.id) !== (e.color ?? ""));
			},
			demo: (rt) => {
				rt.change(() => {
					for (const id of ["sel-root", "sel-a", "sel-b"]) rt.node(id)?.setColor("6");
					for (const id of ["sel-e1", "sel-e2"]) rt.canvas.edges.get(id)?.setColor("6");
				});
			},
		},
		{
			title: "tut.select.s4.title",
			body: "tut.select.s4.body",
			task: "tut.select.s4.task",
			check: (rt) => rt.seen("selection-cut"),
			demo: (rt) => {
				if (rt.selected().length === 0) rt.select(["sel-a", "sel-b"]);
				rt.command("clipboard:cut");
			},
		},
		{
			title: "tut.select.s5.title",
			body: "tut.select.s5.body",
			task: "tut.select.s5.task",
			focus: ["sel-later"],
			check: (rt) => added(rt.before, rt.now()).length >= 1,
			demo: (rt) => {
				const later = rt.node("sel-later");
				if (later) rt.canvas.panTo(later.x + later.width / 2, later.y + later.height / 2);
				rt.command("clipboard:paste-here");
			},
		},
		{ title: "tut.select.s6.title", body: "tut.select.s6.body" },
	],
};

// ---------- 13. Notes to the board ----------

/** Opens the practice note beside the board (written on first use; deleted with the board). */
async function openPracticeNote(rt: TutorialRuntime): Promise<void> {
	if (noteTab(rt)) return;
	const file = rt.canvas.view.file;
	if (!file) return;
	const path = file.path.replace(/\.canvas$/, ".md");
	const vault = rt.app.vault;
	const body = ["# " + rt.t("tut.blocks.note.title"), "", rt.t("tut.blocks.note.para"), "", "- " + rt.t("tut.blocks.note.b1"), "\t- " + rt.t("tut.blocks.note.b1a"), "\t- " + rt.t("tut.blocks.note.b1b"), "- " + rt.t("tut.blocks.note.b2"), "- " + rt.t("tut.blocks.note.b3"), ""].join("\n");
	const existing = vault.getAbstractFileByPath(path);
	const note = existing ?? (await vault.create(path, body));
	const boardLeaf = rt.app.workspace.getLeavesOfType("canvas").find((l) => (l.view as unknown as { canvas?: unknown }).canvas === rt.canvas);
	if (!boardLeaf) return;
	const leaf = rt.app.workspace.createLeafBySplit(boardLeaf, "vertical");
	await leaf.openFile(note as Parameters<typeof leaf.openFile>[0], { active: false });
	await rt.wait(400);
	frameClearOfPanel(rt);
}

/** Texts a dragged block from the practice note can have. */
const practiceTexts = (rt: TutorialRuntime) => ["b1", "b1a", "b1b", "b2", "b3"].map((k) => rt.t(`tut.blocks.note.${k}` as Parameters<TutorialRuntime["t"]>[0])).concat(rt.t("tut.blocks.note.para"));
const fromNote = (rt: TutorialRuntime, n: CanvasNodeData) => n.type === "text" && practiceTexts(rt).some((p) => (n.text ?? "").includes(p));

const blocks: TutorialDefinition = {
	id: "blocks",
	icon: "grip-vertical",
	title: "tut.blocks.title",
	summary: "tut.blocks.summary",
	modules: ["note-blocks"],
	board: (t) => ({
		nodes: [
			card("bl-root", t("tut.blocks.board.root"), 0, 0, 240, 80, { color: "5" }),
			card("bl-ideas", t("tut.blocks.board.ideas"), 340, 0, 220, 70, { color: "2" }),
			group("bl-inbox", t("tut.blocks.board.inbox"), 0, 220, 560, 260, { color: "3" }),
		],
		edges: [edge("bl-e1", "bl-root", "right", "bl-ideas", "left")],
	}),
	steps: [
		{
			title: "tut.blocks.s1.title",
			body: "tut.blocks.s1.body",
			enter: (rt) => void openPracticeNote(rt),
		},
		{
			title: "tut.blocks.s2.title",
			body: "tut.blocks.s2.body",
			task: "tut.blocks.s2.task",
			touch: "tut.blocks.s2.touch",
			enter: (rt) => void openPracticeNote(rt),
			check: (rt) => rt.seen("note-block-dropped") || added(rt.before, rt.now()).some((n) => fromNote(rt, n)),
			demo: (rt) => {
				rt.add([card(randomId(), rt.t("tut.blocks.note.b2"), 0, -180, 200, 60)]);
			},
		},
		{
			title: "tut.blocks.s3.title",
			body: "tut.blocks.s3.body",
			task: "tut.blocks.s3.task",
			focus: ["bl-ideas"],
			check: (rt) => addedEdges(rt.before, rt.now()).some((e) => e.fromNode === "bl-ideas" || e.toNode === "bl-ideas" || e.fromNode === "bl-root"),
			demo: (rt) => {
				const id = randomId();
				rt.add([card(id, rt.t("tut.blocks.note.b3"), 660, 0, 200, 60)], [edge(randomId(), "bl-ideas", "right", id, "left")]);
			},
		},
		{
			title: "tut.blocks.s4.title",
			body: "tut.blocks.s4.body",
			task: "tut.blocks.s4.task",
			focus: ["bl-inbox"],
			check: (rt) => {
				const g = findNode(rt.now(), "bl-inbox");
				return !!g && added(rt.before, rt.now()).some((n) => n.type !== "group" && n.x >= g.x && n.y >= g.y && n.x + n.width <= g.x + g.width && n.y + n.height <= g.y + g.height);
			},
			demo: (rt) => {
				rt.add([card(randomId(), rt.t("tut.blocks.note.para"), 20, 240, 300, 80)]);
			},
		},
		{ title: "tut.blocks.s5.title", body: "tut.blocks.s5.body" },
	],
};

/** Every tutorial, in the order they are offered. */
// ---------- 14. Notes as cards ----------

/** A card showing a note or canvas. */
const fileCard = (id: string, file: string, x: number, y: number, width = 260, height = 110): CanvasNodeData => ({ id, type: "file", file, x, y, width, height });
/** File names can't have these. */
const fileSafe = (name: string) => name.replace(/[\\/:*?"<>|#^[\]]/g, "");

/** Practice note names, translated (they are the notes' file names). */
const VAULT_NOTES = { tickets: "tut.vault.note.tickets", passport: "tut.vault.note.passport", hotel: "tut.vault.note.hotel", sunscreen: "tut.vault.note.sunscreen", camera: "tut.vault.note.camera" } as const;
type VaultNote = keyof typeof VAULT_NOTES;
const noteName = (t: TutorialRuntime["t"], which: VaultNote) => fileSafe(t(VAULT_NOTES[which]));
const notePath = (t: TutorialRuntime["t"], folder: string, which: VaultNote) => `${folder}/${noteName(t, which)}.md`;
/** A tag without spaces. */
const packingTag = (t: TutorialRuntime["t"]) => t("tut.vault.tag").replace(/[\s#]+/g, "-");

const COL_W = 320;
const COL_GAP = 40;
const colX = (i: number) => i * (COL_W + COL_GAP);

/** Edits a practice note's properties the way the properties panel would. */
async function setProperty(rt: TutorialRuntime, which: VaultNote, key: string, value: unknown): Promise<void> {
	const file = rt.app.vault.getFileByPath(notePath(rt.t, rt.folder, which));
	if (file)
		await rt.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
			fm[key] = value;
		});
}

const planText = (data: CanvasFileData) => findNode(data, "al-plan")?.text ?? "";
/** The button that writes the links, once the scan has found them. */
const createButton = () => activeDocument.querySelector<HTMLButtonElement>(".opc-autolink-modal .mod-cta:not(:disabled)");

const vault: TutorialDefinition = {
	id: "vault",
	icon: "file-stack",
	title: "tut.vault.title",
	summary: "tut.vault.summary",
	modules: ["kanban", "query-groups", "auto-edges", "auto-link"],
	restoreSettings: [
		{ module: "auto-link", key: "scope" },
		{ module: "auto-link", key: "notes" },
		{ module: "auto-link", key: "excludedTitles" },
	],
	files: (t) => {
		const body = t("tut.vault.note.body");
		const status = (which: VaultNote, value: string) => ({ path: `${noteName(t, which)}.md`, content: `---\nstatus: ${value}\n---\n${body}\n` });
		const tagged = (which: VaultNote) => ({ path: `${noteName(t, which)}.md`, content: `---\ntags:\n  - ${JSON.stringify(packingTag(t))}\n---\n${body}\n` });
		return [status("tickets", "todo"), status("passport", "todo"), status("hotel", "doing"), tagged("sunscreen"), tagged("camera")];
	},
	board: (t, folder) => ({
		nodes: [
			group("k-todo", t("tut.vault.board.todo"), colX(0), 0, COL_W, 520, { [SCHEMA_KEY]: { kanban: { key: "status", value: "todo" } } }),
			group("k-doing", t("tut.vault.board.doing"), colX(1), 0, COL_W, 520, { [SCHEMA_KEY]: { kanban: { key: "status", value: "doing" } } }),
			group("k-done", t("tut.vault.board.done"), colX(2), 0, COL_W, 520),
			fileCard("k-tickets", notePath(t, folder, "tickets"), colX(0) + 30, 40),
			fileCard("k-pass", notePath(t, folder, "passport"), colX(0) + 30, 180),
			fileCard("k-hotel", notePath(t, folder, "hotel"), colX(1) + 30, 40),
			group("q-pack", t("tut.vault.board.packing"), colX(3) + 80, 0, 620, 300),
			card("al-plan", t("tut.vault.board.plan", { hotel: noteName(t, "hotel").toLowerCase(), tickets: noteName(t, "tickets").toLowerCase() }), colX(3) + 80, 340, 620, 90, { color: "5" }),
		],
		edges: [],
	}),
	steps: [
		{ title: "tut.vault.s1.title", body: "tut.vault.s1.body" },
		{
			title: "tut.vault.s2.title",
			body: "tut.vault.s2.body",
			task: "tut.vault.s2.task",
			focus: ["k-todo", "k-doing", "k-done"],
			check: (rt) => rt.seen("kanban-moved", (_c, _n, _f, value) => value === "doing"),
			demo: async (rt) => {
				const card = rt.node("k-tickets");
				const doing = rt.node("k-doing");
				if (card && doing) await glide(rt, "k-tickets", doing.x + 30 - card.x, doing.y + 200 - card.y);
			},
		},
		{
			title: "tut.vault.s3.title",
			body: "tut.vault.s3.body",
			task: "tut.vault.s3.task",
			target: (rt) => rt.node("k-done")?.labelEl,
			check: (rt) => !!rt.extra("k-done").kanban,
			demo: (rt) => setExtra(rt, "k-done", { kanban: { key: "status", value: "done" } }),
		},
		{
			title: "tut.vault.s4.title",
			body: "tut.vault.s4.body",
			task: "tut.vault.s4.task",
			check: (rt) => rt.seen("kanban-moved", (_c, node) => (node as { id?: string } | undefined)?.id === "k-pass"),
			demo: async (rt) => {
				if (!rt.extra("k-done").kanban) setExtra(rt, "k-done", { kanban: { key: "status", value: "done" } });
				await setProperty(rt, "passport", "status", "done");
			},
		},
		{
			title: "tut.vault.s5.title",
			body: "tut.vault.s5.body",
			task: "tut.vault.s5.task",
			focus: ["q-pack"],
			target: (rt) => rt.node("q-pack")?.labelEl,
			check: (rt) => !!rt.extra("q-pack").query && nodesOf(rt.now()).some((n) => n.type === "file" && !findNode(rt.before, n.id)),
			demo: async (rt) => {
				// The folder keeps notes with the same tag elsewhere in the vault off the practice board.
				setExtra(rt, "q-pack", { query: { tags: [packingTag(rt.t)], folder: rt.folder } });
				await rt.wait(200);
				rt.command("query-groups:refresh-all");
			},
		},
		{
			title: "tut.vault.s6.title",
			body: "tut.vault.s6.body",
			task: "tut.vault.s6.task",
			focus: ["k-tickets", "k-hotel"],
			check: (rt) => edgesOf(rt.now()).some((e) => extraOf(e).auto === true),
			demo: async (rt) => {
				const property = rt.setting("auto-edges", "property");
				const key = typeof property === "string" && property.trim() ? property.trim() : "canvas-edges";
				await setProperty(rt, "hotel", key, [`[[${noteName(rt.t, "tickets")}]]`]);
			},
		},
		{
			title: "tut.vault.autolink.title",
			body: "tut.vault.autolink.body",
			task: "tut.vault.autolink.task",
			focus: ["al-plan"],
			check: (rt) => planText(rt.now()).includes("[["),
			demo: async (rt) => {
				rt.command("auto-link:scan");
				for (let i = 0; i < 40 && !createButton(); i++) await rt.wait(100);
				await rt.wait(1200);
				createButton()?.click();
				await rt.wait(400);
			},
		},
		{
			title: "tut.vault.autolinkUndo.title",
			body: "tut.vault.autolinkUndo.body",
			task: "tut.vault.autolinkUndo.task",
			focus: ["al-plan"],
			check: (rt) => planText(rt.before).includes("[[") && !planText(rt.now()).includes("[["),
			demo: (rt) => {
				rt.command("auto-link:undo");
			},
		},
	],
};

// ---------- 15. Style and reuse ----------

let templatesAtStart = 0;
const templateCount = (rt: TutorialRuntime) => (rt.setting("node-templates", "templates") as unknown[] | undefined)?.length ?? 0;
const lastTemplateButton = (rt: TutorialRuntime) => [...rt.canvas.cardMenuEl.querySelectorAll<HTMLElement>("[class*='opc-card-template-']")].pop();

/** Practice colors, as a theme or a snippet would define them. Numbers few themes use. */
const FIRST_PRACTICE_COLOR = 30;
const PRACTICE_COLORS = ["#00aaa0", "#e65096", "#826ef0"];
const practiceColorName = (i: number) => `--canvas-color-${FIRST_PRACTICE_COLOR + i}`;

/** Puts the practice colors in the color menu until the tutorial ends; nothing is written anywhere. */
function addPracticeColors(rt: TutorialRuntime): void {
	const body = activeDocument.body;
	if (body.style.getPropertyValue(practiceColorName(0))) return;
	PRACTICE_COLORS.forEach((color, i) => body.style.setProperty(practiceColorName(i), color));
	rt.app.workspace.trigger("css-change");
	rt.onEnd(() => {
		PRACTICE_COLORS.forEach((_, i) => body.style.removeProperty(practiceColorName(i)));
		rt.app.workspace.trigger("css-change");
	});
}

const paletteButton = (rt: TutorialRuntime) => rt.canvas.menu.menuEl.querySelector<HTMLElement>("button:has(svg.lucide-palette)");

const style: TutorialDefinition = {
	id: "style",
	icon: "palette",
	title: "tut.style.title",
	summary: "tut.style.summary",
	modules: ["node-borders", "node-templates", "floating-edges", "custom-colors", "variable-breakpoints"],
	// Templates saved while practicing are not kept.
	restoreSettings: [{ module: "node-templates", key: "templates" }],
	board: (t) => ({
		nodes: [
			card("s-idea", t("tut.style.board.idea"), 0, 0, 240, 90, { color: "5" }),
			card("s-plan", t("tut.style.board.plan"), 420, 0, 240, 90, { color: "4" }),
			card("s-task", t("tut.style.board.task"), -420, 0, 300, 110, { color: "3", [SCHEMA_KEY]: { border: "dashed" } }),
		],
		edges: [edge("s-e1", "s-idea", "right", "s-plan", "left")],
	}),
	steps: [
		{
			title: "tut.style.s1.title",
			body: "tut.style.s1.body",
			task: "tut.style.s1.task",
			target: ".opc-menu-border",
			enter: (rt) => rt.select(["s-idea"]),
			check: (rt) => changedAny(rt, (n) => extraOf(n).border),
			demo: (rt) => {
				rt.select(["s-idea"]);
				setExtra(rt, "s-idea", { border: "dotted" });
			},
		},
		{
			title: "tut.style.s2.title",
			body: "tut.style.s2.body",
			task: "tut.style.s2.task",
			enter: (rt) => {
				templatesAtStart = templateCount(rt);
				rt.select(["s-task"]);
			},
			check: (rt) => templateCount(rt) > templatesAtStart,
			demo: async (rt) => {
				rt.select(["s-task"]);
				rt.command("node-templates:save-node-as-template");
				await rt.wait(400);
				activeDocument.querySelector<HTMLElement>(".modal .mod-cta")?.click();
			},
		},
		{
			title: "tut.style.s3.title",
			body: "tut.style.s3.body",
			task: "tut.style.s3.task",
			target: lastTemplateButton,
			check: (rt) => grew(rt, (n) => n.type === "text" && n.text === rt.t("tut.style.board.task")),
			demo: (rt) => lastTemplateButton(rt)?.click(),
		},
		{
			title: "tut.style.s4.title",
			body: "tut.style.s4.body",
			task: "tut.style.s4.task",
			focus: ["s-idea", "s-plan"],
			check: (rt) =>
				edgesOf(rt.now()).some((e) => {
					const f = extraOf(e).floating as { from?: boolean; to?: boolean } | undefined;
					return !!f?.from || !!f?.to;
				}),
			demo: async (rt) => {
				setEdgeExtra(rt, "s-e1", { floating: { to: true } });
				await rt.wait(400);
				// Move the card below: the arrow now ends on its top side.
				const idea = rt.node("s-idea");
				const plan = rt.node("s-plan");
				if (idea && plan) await glide(rt, "s-plan", idea.x - plan.x, idea.y + 300 - plan.y);
			},
		},
		{
			title: "tut.style.s5.title",
			body: "tut.style.s5.body",
			task: "tut.style.s5.task",
			target: paletteButton,
			focus: ["s-idea", "s-plan", "s-task"],
			enter: (rt) => {
				addPracticeColors(rt);
				rt.select(["s-task"]);
			},
			check: (rt) => changedAny(rt, (n) => n.color, (n) => Number(n.color) >= FIRST_PRACTICE_COLOR),
			demo: (rt) => {
				addPracticeColors(rt);
				rt.select(["s-task"]);
				rt.change(() => rt.node("s-task")?.setColor(String(FIRST_PRACTICE_COLOR)));
			},
		},
		{
			title: "tut.style.s6.title",
			body: "tut.style.s6.body",
			task: "tut.style.s6.task",
			focus: ["s-idea"],
			enter: (rt) => rt.select(["s-idea"]),
			check: (rt) => changedAny(rt, (n) => extraOf(n).breakpoint),
			demo: (rt) => {
				rt.select(["s-idea"]);
				setExtra(rt, "s-idea", { breakpoint: 0 });
				rt.canvas.rerenderViewport();
			},
		},
		{ title: "tut.style.s7.title", body: "tut.style.s7.body" },
	],
};

// ---------- 16. Big boards ----------

const detailsName = (t: TutorialRuntime["t"]) => fileSafe(t("tut.big.detailsName"));

const big: TutorialDefinition = {
	id: "big",
	icon: "door-open",
	title: "tut.big.title",
	summary: "tut.big.summary",
	modules: ["portals", "encapsulate", "node-links"],
	files: (t) => [
		{
			path: `${detailsName(t)}.canvas`,
			content: JSON.stringify(
				{
					nodes: [card("d-1", t("tut.big.board.d1"), 0, 0, 240, 80, { color: "4" }), card("d-2", t("tut.big.board.d2"), 320, 0, 240, 80), card("d-3", t("tut.big.board.d3"), 320, 120, 240, 80)],
					edges: [edge("d-e1", "d-1", "right", "d-2", "left"), edge("d-e2", "d-1", "right", "d-3", "left")],
				},
				null,
				"\t",
			),
		},
	],
	board: (t, folder) => ({
		nodes: [
			title("b-title", t("tut.big.board.title"), 0, -140, 700, 80),
			fileCard("b-portal", `${folder}/${detailsName(t)}.canvas`, 0, 0, 420, 260),
			card("b-1", t("tut.big.board.c1"), 760, 0, 240, 80, { color: "6" }),
			card("b-2", t("tut.big.board.c2"), 760, 110, 240, 80, { color: "6" }),
			card("b-3", t("tut.big.board.c3"), 760, 220, 240, 80, { color: "6" }),
		],
		edges: [edge("b-e1", "b-1", "bottom", "b-2", "top"), edge("b-e2", "b-2", "bottom", "b-3", "top")],
	}),
	steps: [
		{
			title: "tut.big.s1.title",
			body: "tut.big.s1.body",
			task: "tut.big.s1.task",
			target: ".opc-menu-portal",
			enter: (rt) => rt.select(["b-portal"]),
			check: (rt) => !!rt.extra("b-portal").portal?.open,
			demo: (rt) => {
				rt.select(["b-portal"]);
				rt.command("portals:toggle-portal");
			},
		},
		{
			title: "tut.big.s2.title",
			body: "tut.big.s2.body",
			task: "tut.big.s2.task",
			focus: ["b-1", "b-2", "b-3"],
			check: (rt) => rt.seen("selection-encapsulated"),
			demo: async (rt) => {
				rt.select(["b-1", "b-2", "b-3"]);
				rt.command("encapsulate:encapsulate-selection");
				await rt.wait(400);
				activeDocument.querySelector<HTMLElement>(".modal .mod-cta")?.click();
			},
		},
		{ title: "tut.big.s3.title", body: "tut.big.s3.body" },
	],
};

// ---------- 17. Right-to-left ----------

const direction: TutorialDefinition = {
	id: "direction",
	icon: "languages",
	title: "tut.dir.title",
	summary: "tut.dir.summary",
	modules: ["direction", "mindmap"],
	board: (t) => ({
		nodes: [
			title("d-title", t("tut.dir.board.title"), 0, -160, 700, 80),
			card("d-mixed", `${t("tut.dir.board.ltrLine")}\n\n${t("tut.dir.board.rtlLine")}`, 0, 0, 320, 140, { color: "5" }),
			card("d-fixed", t("tut.dir.board.fixed"), 380, 0, 320, 140, { color: "4" }),
			card("d-root", t("tut.dir.board.root"), 190, 300, 320, 80, { color: "6" }),
		],
		edges: [],
	}),
	steps: [
		{ title: "tut.dir.s1.title", body: "tut.dir.s1.body", focus: ["d-mixed", "d-fixed"] },
		{
			title: "tut.dir.s2.title",
			body: "tut.dir.s2.body",
			task: "tut.dir.s2.task",
			target: ".opc-menu-text-direction",
			enter: (rt) => rt.select(["d-fixed"]),
			check: (rt) => changedAny(rt, (n) => extraOf(n).dir),
			demo: (rt) => {
				rt.select(["d-fixed"]);
				setExtra(rt, "d-fixed", { dir: "rtl" });
			},
		},
		{
			title: "tut.dir.s3.title",
			body: "tut.dir.s3.body",
			task: "tut.dir.s3.task",
			check: (rt) => rt.root().dir === "rtl",
			demo: (rt) => void rt.command("direction:canvas-rtl"),
		},
		{
			title: "tut.dir.s4.title",
			body: "tut.dir.s4.body",
			task: "tut.dir.s4.task",
			touch: "tut.dir.s4.touch",
			enter: (rt) => rt.select(["d-root"]),
			check: (rt) => {
				const root = findNode(rt.now(), "d-root");
				return addedEdges(rt.before, rt.now()).some((e) => {
					const child = e.fromNode === "d-root" ? findNode(rt.now(), e.toNode) : undefined;
					return !!root && !!child && child.x + child.width <= root.x;
				});
			},
			demo: async (rt) => {
				rt.select(["d-root"]);
				rt.command("mindmap:add-child");
				await rt.wait(350);
				const child = added(rt.before, rt.now())[0];
				const node = child && rt.node(child.id);
				if (!node) return;
				rt.command("mindmap:stop-editing");
				rt.change(() => node.setData({ ...node.getData(), text: rt.t("tut.dir.board.child") }));
			},
		},
		{ title: "tut.dir.s5.title", body: "tut.dir.s5.body" },
	],
};

// ---------- 18. PDF pages ----------

const pdfName = (t: TutorialRuntime["t"]) => `${fileSafe(t("tut.pdf.fileName"))}.pdf`;
const isPinnedPage = (n: CanvasNodeData) => n.type === "file" && !!(extraOf(n).pdf as { pinned?: boolean } | undefined)?.pinned;

/** Page 1: a title bar, lines of "text" and a figure; page 2: a bar chart. Shapes only, so it fits every language. */
const PDF_PAGES = [
	[
		"0.27 0.35 0.85 rg 50 730 495 60 re f",
		"0.75 g",
		...[650, 625, 600, 575, 550].map((y, i) => `60 ${y} ${470 - (i % 2) * 90} 12 re f`),
		"0.95 0.6 0.2 RG 3 w 70 300 m 70 500 l 300 500 l 300 300 l h S",
		"0.95 0.6 0.2 rg 185 455 m 215.4 455 240 430.4 240 400 c 240 369.6 215.4 345 185 345 c 154.6 345 130 369.6 130 400 c 130 430.4 154.6 455 185 455 c f",
		"0.75 g",
		...[480, 455, 430, 405, 380, 355, 330].map((y) => `330 ${y} 200 10 re f`),
	].join("\n"),
	[
		"0 g 1.5 w 70 150 m 70 650 l S 70 150 m 530 150 l S",
		"0.27 0.35 0.85 rg 100 150 60 220 re f",
		"0.2 0.7 0.5 rg 190 150 60 380 re f",
		"0.95 0.6 0.2 rg 280 150 60 160 re f",
		"0.85 0.3 0.4 rg 370 150 60 300 re f",
		"0.5 0.4 0.8 rg 460 150 60 450 re f",
	].join("\n"),
];

const pdf: TutorialDefinition = {
	id: "pdf",
	icon: "file-text",
	title: "tut.pdf.title",
	summary: "tut.pdf.summary",
	modules: ["pdf-annotation", "drawing"],
	files: (t) => [{ path: pdfName(t), content: practicePdf(PDF_PAGES) }],
	board: (t, folder) => ({
		nodes: [title("p-title", t("tut.pdf.board.title"), 0, -140, 700, 80), fileCard("p-pdf", `${folder}/${pdfName(t)}`, 0, 0, 440, 623)],
		edges: [],
	}),
	steps: [
		{
			title: "tut.pdf.s1.title",
			body: "tut.pdf.s1.body",
			task: "tut.pdf.s1.task",
			enter: (rt) => rt.select(["p-pdf"]),
			check: (rt) => isPinnedPage(findNode(rt.now(), "p-pdf") ?? ({} as CanvasNodeData)),
			demo: (rt) => {
				rt.select(["p-pdf"]);
				rt.command("pdf-annotation:pin-pdf-page");
			},
		},
		{
			title: "tut.pdf.s2.title",
			body: "tut.pdf.s2.body",
			task: "tut.pdf.s2.task",
			check: (rt) => count(rt.now(), isPinnedPage) > count(rt.before, isPinnedPage),
			demo: async (rt) => {
				rt.canvas.deselectAll();
				// The pages are inserted in the middle of the view: make room beside the first card.
				const first = rt.node("p-pdf");
				if (first) rt.canvas.panTo(first.x + first.width + 500, first.y + 300);
				rt.command("pdf-annotation:insert-pdf");
				await rt.wait(400);
				const input = activeDocument.querySelector<HTMLInputElement>(".prompt .prompt-input");
				if (!input) return;
				input.value = pdfName(rt.t).replace(/\.pdf$/, "");
				input.dispatchEvent(new Event("input"));
				await rt.wait(300);
				input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
			},
		},
		{
			title: "tut.pdf.s3.title",
			body: "tut.pdf.s3.body",
			task: "tut.pdf.s3.task",
			check: (rt) => strokeCount(rt.now()) > strokeCount(rt.before),
			demo: (rt) => {
				const pages = nodesOf(rt.now()).filter(isPinnedPage);
				const page = pages.find((n) => n.id !== "p-pdf") ?? pages[0];
				if (!page) return;
				// Circle the figure in the top half of the page.
				rt.add([ink(randomId(), ellipsePoints(page.x + page.width * 0.31, page.y + page.height * 0.52, page.width * 0.25, page.height * 0.15))]);
			},
		},
		{ title: "tut.pdf.s4.title", body: "tut.pdf.s4.body" },
	],
};

// ---------- 19. Big maps in pages ----------

const PAGES_VIEW = "opc-pages";
const pagesOfRoot = (rt: TutorialRuntime) => rt.root().pages ?? [];
const TEXT_VIEW = "opc-text-pages";
const textLeaf = (rt: TutorialRuntime) => rt.app.workspace.getLeavesOfType(TEXT_VIEW).find((l) => (l.view as unknown as { file?: unknown }).file === rt.canvas.view.file);
const textView = (rt: TutorialRuntime) => textLeaf(rt)?.view as unknown as { containerEl: HTMLElement; contentEl: HTMLElement; getState(): { page?: string } } | undefined;
const showText = (rt: TutorialRuntime) => {
	if (!textView(rt)) rt.command("text-pages:toggle");
};
const pageOfCard = (rt: TutorialRuntime, id: string) => rt.extra(id).page ?? "";

/** The pages bar of the note made from the practice board, if it is open. */
const noteBar = (rt: TutorialRuntime) => noteTab(rt)?.view.containerEl.querySelector<HTMLElement>(".opc-md-pages-bar") ?? null;
/** Crumbs of a pages bar: more than one means a page other than the main page is shown. */
const crumbs = (bar: HTMLElement | null | undefined) => bar?.querySelectorAll(".opc-pages-crumb").length ?? 0;
const TEMPLATES_FOLDER = "Templates";

/**
 * A template that has pages: a drug card whose dose and side effects have pages of their own,
 * linked both ways, as "Move branch to a new page" leaves them.
 */
function pagedTemplate(t: Translate): CanvasFileData {
	const link = (id: string) => `

[[Template.canvas#${id}|${t("pages.link")}]]`;
	const page = (p: string) => ({ [SCHEMA_KEY]: { v: 1, page: p } });
	return {
		[SCHEMA_KEY]: {
			v: 1,
			pages: [
				{ id: "tp-p1", anchor: "tp-dose", root: "tp-dose-r" },
				{ id: "tp-p2", anchor: "tp-side", root: "tp-side-r" },
			],
		},
		nodes: [
			card("tp-root", t("tut.pages.tpl.root"), 0, 100, 220, 70, { color: "5" }),
			card("tp-dose", `${t("tut.pages.tpl.dose")}${link("tp-dose-r")}`, 320, 0, 220, 100, { color: "4" }),
			card("tp-side", `${t("tut.pages.tpl.side")}${link("tp-side-r")}`, 320, 200, 220, 100, { color: "1" }),
			card("tp-dose-r", `${t("tut.pages.tpl.dose")}${link("tp-dose")}`, 2000, 0, 220, 100, { color: "4", ...page("tp-p1") }),
			card("tp-dose-a", t("tut.pages.tpl.adults"), 2320, -60, 200, 60, page("tp-p1")),
			card("tp-dose-k", t("tut.pages.tpl.children"), 2320, 60, 200, 60, page("tp-p1")),
			card("tp-side-r", `${t("tut.pages.tpl.side")}${link("tp-side")}`, 4000, 0, 220, 100, { color: "1", ...page("tp-p2") }),
			card("tp-side-c", t("tut.pages.tpl.common"), 4320, -60, 200, 60, page("tp-p2")),
			card("tp-side-x", t("tut.pages.tpl.rare"), 4320, 60, 200, 60, page("tp-p2")),
		],
		edges: [
			edge("tp-e1", "tp-root", "right", "tp-dose", "left"),
			edge("tp-e2", "tp-root", "right", "tp-side", "left"),
			edge("tp-e3", "tp-dose-r", "right", "tp-dose-a", "left"),
			edge("tp-e4", "tp-dose-r", "right", "tp-dose-k", "left"),
			edge("tp-e5", "tp-side-r", "right", "tp-side-c", "left"),
			edge("tp-e6", "tp-side-r", "right", "tp-side-x", "left"),
		],
	};
}

/** Picks a template in the open template list by its name. */
async function pickTemplate(rt: TutorialRuntime, name: string): Promise<void> {
	const input = activeDocument.querySelector<HTMLInputElement>(".prompt-input");
	if (!input) return;
	input.value = name;
	input.dispatchEvent(new Event("input"));
	await rt.wait(400);
	activeDocument.querySelector<HTMLElement>(".suggestion-item.is-selected")?.click();
	await rt.wait(900);
}

const pages: TutorialDefinition = {
	id: "pages",
	icon: "file-stack",
	title: "tut.pages.title",
	summary: "tut.pages.summary",
	modules: ["pages", "text-pages", "auto-layout", "presentation", "node-links", "canvas-markdown", "board-templates", "view-memory"],
	restoreSettings: [
		{ module: "canvas-markdown", key: "pages" },
		{ module: "board-templates", key: "folder" },
	],
	files: (t) => [{ path: `${TEMPLATES_FOLDER}/${t("tut.pages.tpl.name")}.canvas`, content: JSON.stringify(pagedTemplate(t), null, "	") }],
	board: (t) => ({
		nodes: [
			card("pg-root", t("tut.pages.board.root"), 0, 120, 240, 80, { color: "5" }),
			card("pg-diag", t("tut.pages.board.diag"), 360, -40, 220, 60),
			card("pg-treat", t("tut.pages.board.treat"), 360, 280, 220, 60, { color: "4" }),
			card("pg-bb", t("tut.pages.board.bb"), 700, 180, 220, 60, { color: "6" }),
			card("pg-ace", t("tut.pages.board.ace"), 700, 400, 220, 60),
			card("pg-bb1", t("tut.pages.board.bb1"), 1040, 80, 220, 60),
			card("pg-bb2", t("tut.pages.board.bb2"), 1040, 170, 220, 60),
			card("pg-bb3", t("tut.pages.board.bb3"), 1040, 260, 220, 60),
			card("pg-bb3a", t("tut.pages.board.bb3a"), 1380, 260, 220, 60),
			card("pg-ace1", t("tut.pages.board.ace1"), 1040, 400, 220, 60),
		],
		edges: [
			edge("pg-e1", "pg-root", "right", "pg-diag", "left"),
			edge("pg-e2", "pg-root", "right", "pg-treat", "left"),
			edge("pg-e3", "pg-treat", "right", "pg-bb", "left"),
			edge("pg-e4", "pg-treat", "right", "pg-ace", "left"),
			edge("pg-e5", "pg-bb", "right", "pg-bb1", "left"),
			edge("pg-e6", "pg-bb", "right", "pg-bb2", "left"),
			edge("pg-e7", "pg-bb", "right", "pg-bb3", "left"),
			edge("pg-e8", "pg-bb3", "right", "pg-bb3a", "left"),
			edge("pg-e9", "pg-ace", "right", "pg-ace1", "left"),
		],
		root: { mapLayouts: { "pg-root": "right" } },
	}),
	steps: [
		{
			title: "tut.pages.s1.title",
			body: "tut.pages.s1.body",
			task: "tut.pages.s1.task",
			enter: (rt) => rt.select(["pg-bb"]),
			check: (rt) => pagesOfRoot(rt).some((p) => p.anchor === "pg-bb"),
			demo: (rt) => {
				rt.select(["pg-bb"]);
				rt.command("pages:move-branch");
			},
		},
		{
			title: "tut.pages.s2.title",
			body: "tut.pages.s2.body",
			task: "tut.pages.s2.task",
			target: ".opc-pages-bar",
			check: (rt) => rt.seen("page-shown", (_c, page) => page === ""),
			demo: (rt) => {
				const root = pagesOfRoot(rt).find((p) => p.anchor === "pg-bb")?.root;
				if (root) rt.select([root]);
				rt.command("pages:follow-link");
			},
		},
		{
			title: "tut.pages.s3.title",
			body: "tut.pages.s3.body",
			task: "tut.pages.s3.task",
			target: ".opc-pages-index",
			check: (rt) => rt.viewOpen(PAGES_VIEW),
			demo: (rt) => {
				rt.command("pages:open-index");
			},
		},
		{
			title: "tut.pages.s4.title",
			body: "tut.pages.s4.body",
			task: "tut.pages.s4.task",
			touch: "tut.pages.s4.touch",
			enter: (rt) => {
				rt.command("pages:main-page");
				rt.select(["pg-bb"]);
			},
			check: (rt) => rt.seen("map-walk-moved") && rt.seen("page-shown", (_c, page) => page !== ""),
			demo: async (rt) => {
				if (!rt.canvas.wrapperEl.hasClass("opc-walking")) {
					rt.command("pages:main-page");
					rt.select(["pg-bb"]);
					rt.command("presentation:walk");
					await rt.wait(700);
				}
				rt.canvas.wrapperEl.querySelector<HTMLElement>(".opc-walk-right")?.click();
				await rt.wait(700);
				rt.canvas.wrapperEl.querySelector<HTMLElement>(".opc-walk-right")?.click();
			},
		},
		{
			title: "tut.pages.cols.title",
			body: "tut.pages.cols.body",
			task: "tut.pages.cols.task",
			enter: (rt) => {
				rt.command("presentation:walk-end");
				rt.command("pages:main-page");
				rt.select(["pg-bb"]);
			},
			check: (rt) => !!rt.canvas.wrapperEl.querySelector(".opc-columns") && rt.seen("page-shown", (_c, page) => page !== ""),
			demo: async (rt) => {
				if (!rt.canvas.wrapperEl.querySelector(".opc-columns")) {
					rt.command("presentation:walk-end");
					rt.command("pages:main-page");
					rt.select(["pg-bb"]);
					rt.command("presentation:walk-columns");
					await rt.wait(900);
				}
				rt.canvas.wrapperEl.querySelector<HTMLElement>('.opc-columns-card.is-current a.internal-link')?.click();
				await rt.wait(700);
			},
		},
		{
			title: "tut.pages.s5.title",
			body: "tut.pages.s5.body",
			task: "tut.pages.s5.task",
			enter: (rt) => {
				rt.command("presentation:walk-end");
				rt.command("pages:main-page");
				rt.select(["pg-ace"]);
			},
			check: (rt) => rt.seen("branch-moved", (_c, _a, _r, page) => page === null),
			demo: async (rt) => {
				rt.command("pages:main-page");
				rt.select(["pg-ace"]);
				rt.command("pages:place-branch");
				await rt.wait(600);
				const ace = rt.node("pg-ace");
				if (ace) {
					rt.canvas.tx = ace.x + 200;
					rt.canvas.ty = ace.y + 520;
					rt.canvas.markViewportChanged();
				}
				await rt.wait(900);
				rt.command("pages:put-branch-here");
			},
		},
		{
			title: "tut.pages.text.title",
			body: "tut.pages.text.body",
			task: "tut.pages.text.task",
			target: (rt) => rt.canvas.wrapperEl.closest(".workspace-leaf-content")?.querySelector<HTMLElement>(".opc-text-pages-switch"),
			enter: (rt) => {
				rt.command("presentation:walk-end");
				rt.command("pages:main-page");
			},
			check: (rt) => !!textView(rt),
			demo: showText,
		},
		{
			title: "tut.pages.textLinks.title",
			body: "tut.pages.textLinks.body",
			task: "tut.pages.textLinks.task",
			target: (rt) => textView(rt)?.contentEl.querySelector<HTMLElement>(".opc-text-pagelink"),
			enter: showText,
			check: (rt) => !!textView(rt)?.getState().page,
			demo: async (rt) => {
				showText(rt);
				await rt.wait(700);
				textView(rt)?.contentEl.querySelector<HTMLElement>(".opc-text-pagelink")?.click();
			},
		},
		{
			title: "tut.pages.textEdit.title",
			body: "tut.pages.textEdit.body",
			task: "tut.pages.textEdit.task",
			target: (rt) => textView(rt)?.containerEl.querySelector<HTMLElement>(".opc-text-edit-button"),
			enter: showText,
			check: (rt) => changedAny(rt, (n) => n.text, isPlainCard),
			demo: async (rt) => {
				showText(rt);
				await rt.wait(700);
				const view = textView(rt);
				const pencil = view?.containerEl.querySelector<HTMLElement>(".opc-text-edit-button");
				if (!view || !pencil) return;
				if (!pencil.hasClass("is-active")) pencil.click();
				await rt.wait(500);
				const cards = view.contentEl.querySelectorAll<HTMLElement>(".opc-text-block.is-editable .opc-text-body");
				cards[cards.length - 1]?.click();
				await rt.wait(600);
				const input = view.contentEl.querySelector<HTMLTextAreaElement>("textarea.opc-text-editor");
				if (!input) return;
				input.value = `${input.value} ✓`;
				input.dispatchEvent(new Event("input"));
				await rt.wait(700);
				input.blur();
				await rt.wait(400);
			},
		},
		{
			title: "tut.pages.note.title",
			body: "tut.pages.note.body",
			task: "tut.pages.note.task",
			target: canvasSwitch,
			enter: (rt) => {
				textLeaf(rt)?.detach();
				rt.setSetting("canvas-markdown", "pages", "paged");
				rt.command("pages:main-page");
			},
			check: (rt) => !!noteBar(rt),
			demo: (rt) => pressSwitch(rt, canvasSwitch(rt), false),
		},
		{
			title: "tut.pages.noteLinks.title",
			body: "tut.pages.noteLinks.body",
			task: "tut.pages.noteLinks.task",
			target: (rt) => noteBar(rt),
			check: (rt) => crumbs(noteBar(rt)) > 1,
			demo: async (rt) => {
				if (!noteBar(rt)) await pressSwitch(rt, canvasSwitch(rt), false);
				// The next page, from the bar's arrows.
				const tools = noteBar(rt)?.querySelectorAll<HTMLElement>(".opc-md-pages-tools .clickable-icon");
				tools?.[1]?.click();
				await rt.wait(500);
			},
		},
		{
			title: "tut.pages.noteBack.title",
			body: "tut.pages.noteBack.body",
			task: "tut.pages.noteBack.task",
			target: noteSwitch,
			check: (rt) => rt.seen("canvas-updated-from-note") && crumbs(rt.canvas.wrapperEl.querySelector(".opc-pages-bar")) > 1,
			demo: async (rt) => {
				if (crumbs(noteBar(rt)) < 2) noteBar(rt)?.querySelectorAll<HTMLElement>(".opc-md-pages-tools .clickable-icon")[1]?.click();
				await rt.wait(400);
				await pressSwitch(rt, noteSwitch(rt), true);
			},
		},
		{
			title: "tut.pages.s6.title",
			body: "tut.pages.s6.body",
			task: "tut.pages.s6.task",
			// Back on the board, with the page still to be merged.
			enter: (rt) => {
				textLeaf(rt)?.detach();
				noteTab(rt)?.leaf.detach();
				rt.command("pages:main-page");
			},
			check: (rt) => rt.seen("page-merged"),
			demo: async (rt) => {
				if (pageOfCard(rt, "pg-bb") === "" && !rt.node("pg-bb")?.nodeEl.hasClass("opc-page-hidden")) {
					rt.select(["pg-bb"]);
					rt.command("pages:follow-link");
					await rt.wait(700);
				}
				rt.command("pages:merge-page");
			},
		},
		{
			title: "tut.pages.template.title",
			body: "tut.pages.template.body",
			task: "tut.pages.template.task",
			target: ".opc-card-insert-template",
			enter: (rt) => {
				rt.setSetting("board-templates", "folder", `${rt.folder}/${TEMPLATES_FOLDER}`);
				rt.command("pages:main-page");
			},
			check: (rt) => pagesOfRoot(rt).length >= (extraOf(rt.before).pages as unknown[] | undefined ?? []).length + 2,
			demo: async (rt) => {
				rt.command("board-templates:insert-template");
				await rt.wait(600);
				await pickTemplate(rt, rt.t("tut.pages.tpl.name"));
			},
		},
		{ title: "tut.pages.s7.title", body: "tut.pages.s7.body" },
	],
};

// ---------- 20. Tidy arrows ----------

const arrows: TutorialDefinition = {
	id: "arrows",
	icon: "waypoints",
	title: "tut.arrows.title",
	summary: "tut.arrows.summary",
	modules: ["auto-layout", "note-blocks", "presentation", "edge-routing"],
	board: (t) => ({
		nodes: [
			group("ar-g", t("tut.arrows.board.group"), 380, 230, 700, 230),
			card("ar-root", t("tut.arrows.board.root"), 0, 300, 240, 80, { color: "5" }),
			card("ar-a", t("tut.arrows.board.a"), 420, 0, 220, 60, { color: "4" }),
			card("ar-a1", t("tut.arrows.board.a1"), 800, -80, 220, 60),
			card("ar-a2", t("tut.arrows.board.a2"), 800, 40, 220, 60),
			card("ar-b", t("tut.arrows.board.b"), 420, 300, 220, 60, { color: "6" }),
			card("ar-b1", t("tut.arrows.board.b1"), 800, 260, 220, 60),
			card("ar-b2", t("tut.arrows.board.b2"), 800, 370, 220, 60),
			card("ar-c", t("tut.arrows.board.c"), 420, 620, 220, 60, { color: "2" }),
			card("ar-c1", t("tut.arrows.board.c1"), 800, 620, 220, 60),
			card("ar-new", t("tut.arrows.board.new"), 0, 900, 220, 60, { color: "3" }),
		],
		// Sides left over from an older arrangement: several arrows run under cards.
		edges: [
			edge("ar-e1", "ar-root", "bottom", "ar-a", "bottom"),
			edge("ar-e2", "ar-root", "right", "ar-b", "left"),
			edge("ar-e3", "ar-root", "top", "ar-c", "top"),
			edge("ar-e4", "ar-a", "bottom", "ar-a1", "left"),
			edge("ar-e5", "ar-a", "right", "ar-a2", "left"),
			edge("ar-e6", "ar-b", "right", "ar-b1", "left"),
			edge("ar-e7", "ar-b", "right", "ar-b2", "left"),
			edge("ar-e8", "ar-c", "top", "ar-c1", "top"),
		],
		root: { mapLayouts: { "ar-root": "right" } },
	}),
	steps: [
		{
			title: "tut.arrows.s1.title",
			body: "tut.arrows.s1.body",
			task: "tut.arrows.s1.task",
			enter: (rt) => rt.select(["ar-root"]),
			check: (rt) => rt.seen("layout-applied"),
			demo: (rt) => {
				rt.select(["ar-root"]);
				rt.command("auto-layout:layout-mindmap");
			},
		},
		{
			title: "tut.arrows.s2.title",
			body: "tut.arrows.s2.body",
			task: "tut.arrows.s2.task",
			focus: ["ar-new", "ar-g"],
			check: (rt) => edgesOf(rt.now()).some((e) => e.fromNode === "ar-b" && e.toNode === "ar-new"),
			demo: async (rt) => {
				const b = rt.node("ar-b");
				const fresh = rt.node("ar-new");
				if (!b || !fresh) return;
				await glide(rt, "ar-new", b.x + b.width + 60 - fresh.x, b.y - fresh.y);
				rt.change(() => rt.canvas.importData({ nodes: [], edges: [edge("ar-e9", "ar-b", "right", "ar-new", "left")] }, false));
				const moved = rt.node("ar-new");
				if (moved) await relayoutMap({ data: rt.data }, rt.canvas, moved);
			},
		},
		{
			title: "tut.arrows.s3.title",
			body: "tut.arrows.s3.body",
			task: "tut.arrows.s3.task",
			touch: "tut.arrows.s3.touch",
			target: ".opc-card-walk",
			enter: (rt) => rt.select(["ar-root"]),
			check: (rt) => {
				let moves = 0;
				return rt.seen("map-walk-moved", () => ++moves >= 4);
			},
			demo: async (rt) => {
				if (!rt.canvas.wrapperEl.hasClass("opc-walking")) {
					rt.select(["ar-root"]);
					rt.command("presentation:walk");
					await rt.wait(700);
				}
				for (const dir of ["right", "down", "right", "left"]) {
					rt.canvas.wrapperEl.querySelector<HTMLElement>(`.opc-walk-${dir}`)?.click();
					await rt.wait(700);
				}
			},
		},
		{ title: "tut.arrows.s4.title", body: "tut.arrows.s4.body", enter: (rt) => void rt.command("presentation:walk-end") },
	],
};

// ---------- shared by the next tutorials ----------

const dialogOpen = (selector: string) => !!activeDocument.querySelector(selector);

/** Closes one of the plugin's dialogs with Esc, which works whatever the app's dialogs look like. */
const closeDialog = (selector: string) => {
	if (dialogOpen(selector)) activeDocument.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
};

/**
 * For tasks in a dialog, which covers the coach panel: done once it was opened and closed again,
 * so the next step isn't shown behind it.
 */
function visitedDialog(selector: string): { reset(): void; check(): boolean } {
	let seen = false;
	return {
		reset: () => void (seen = false),
		check: () => {
			const open = dialogOpen(selector);
			seen ||= open;
			return seen && !open;
		},
	};
}

/** The side bar's settings button: a click opens the plugin's settings, a right-click or long press the canvas options. */
const settingsButton = (rt: TutorialRuntime) => rt.canvas.canvasControlsEl.querySelector("svg.lucide-settings")?.closest<HTMLElement>(".canvas-control-item");

// ---------- 21. Your own bars ----------

const BARS_DIALOG = ".opc-bars-modal";
const barsVisit = visitedDialog(BARS_DIALOG);
const hiddenButtons = (rt: TutorialRuntime) => (rt.setting("bar-buttons", "hidden") as string[] | undefined) ?? [];
const customButtons = (rt: TutorialRuntime) => (rt.setting("bar-buttons", "custom") as { bar?: string }[] | undefined) ?? [];
let hiddenAtStart = 0;
let customAtStart = 0;
let orderAtStart = "";
const MENU_STYLE_KEYS = ["fontSize", "itemPadding", "itemIndent", "width", "radius", "iconSize", "iconGap", "shadow", "light", "dark"] as const;
let menuStyleAtStart = "";
let menuHiddenAtStart = 0;
const contextMenuChoice = (rt: TutorialRuntime) =>
	((rt.setting("bar-buttons", "menus") as Record<string, { hidden: string[]; seen: { title: string }[]; allVault: boolean }> | undefined)?.context ?? { hidden: [], seen: [], allVault: false });
const menuStyleOf = (rt: TutorialRuntime) => JSON.stringify(MENU_STYLE_KEYS.map((k) => rt.setting("menu-style", k)));
/** Obsidian's settings are open (in this window or a window of their own). */
const settingsOpen = (rt: TutorialRuntime) => {
	const setting = (rt.app as unknown as { setting?: { containerEl?: HTMLElement; popout?: unknown } }).setting;
	return !!setting?.popout || !!setting?.containerEl?.isConnected;
};


const bars: TutorialDefinition = {
	id: BARS_TUTORIAL,
	icon: "sliders-horizontal",
	title: "tut.bars.title",
	summary: "tut.bars.summary",
	modules: ["bar-buttons", "toolbar-size", "menu-style"],
	// The practice changes the real settings of the bars and the menu: they go back when the tutorial ends.
	restoreSettings: [
		{ module: "bar-buttons", key: "hidden" },
		{ module: "bar-buttons", key: "custom" },
		{ module: "bar-buttons", key: "order" },
		{ module: "bar-buttons", key: "menus" },
		...MENU_STYLE_KEYS.map((key) => ({ module: "menu-style", key })),
	],
	// A picture, for the popup over images.
	files: (t) => [{ path: barsPhotoName(t), content: PRACTICE_PHOTO }],
	board: (t, folder) => ({
		nodes: [
			title("br-title", t("tut.bars.board.title"), 0, -140, 700, 80),
			card("br-1", t("tut.bars.board.c1"), 0, 0, 280, 90, { color: "5" }),
			card("br-2", t("tut.bars.board.c2"), 340, 0, 280, 90, { color: "4" }),
			fileCard("br-photo", `${folder}/${barsPhotoName(t)}`, 680, -20, 240, 150),
		],
		edges: [],
	}),
	steps: [
		{
			title: "tut.bars.s1.title",
			body: "tut.bars.s1.body",
			task: "tut.bars.s1.task",
			touch: "tut.bars.s1.touch",
			target: settingsButton,
			enter: () => barsVisit.reset(),
			check: () => barsVisit.check(),
			demo: async (rt) => {
				rt.command("bar-buttons:customize");
				await rt.wait(1800);
				closeDialog(BARS_DIALOG);
			},
		},
		{
			title: "tut.bars.s2.title",
			body: "tut.bars.s2.body",
			task: "tut.bars.s2.task",
			target: settingsButton,
			enter: (rt) => {
				hiddenAtStart = hiddenButtons(rt).length;
			},
			check: (rt) => hiddenButtons(rt).length > hiddenAtStart && !dialogOpen(BARS_DIALOG),
			demo: async (rt) => {
				rt.command("bar-buttons:customize");
				await rt.wait(900);
				activeDocument.querySelector<HTMLElement>(`${BARS_DIALOG} .checkbox-container.is-enabled`)?.click();
				await rt.wait(900);
				closeDialog(BARS_DIALOG);
			},
		},
		{
			title: "tut.bars.s3.title",
			body: "tut.bars.s3.body",
			task: "tut.bars.s3.task",
			target: settingsButton,
			enter: (rt) => {
				customAtStart = customButtons(rt).length;
			},
			check: (rt) => customButtons(rt).length > customAtStart && !dialogOpen(".modal"),
			demo: (rt) => rt.setSetting("bar-buttons", "custom", [...customButtons(rt), { id: randomId().slice(0, 8), bar: "side", command: "app:toggle-left-sidebar", icon: "lucide-panel-left", name: rt.t("tut.bars.demoButton") }]),
		},
		{
			title: "tut.bars.popup.title",
			body: "tut.bars.popup.body",
			task: "tut.bars.popup.task",
			touch: "tut.bars.popup.touch",
			target: settingsButton,
			enter: (rt) => {
				customAtStart = customButtons(rt).filter((b) => b.bar === "popup").length;
				hiddenAtStart = hiddenButtons(rt).filter((k) => k.startsWith("popup:")).length;
				rt.select(["br-1"]);
			},
			check: (rt) => (customButtons(rt).filter((b) => b.bar === "popup").length > customAtStart || hiddenButtons(rt).filter((k) => k.startsWith("popup:")).length > hiddenAtStart) && !dialogOpen(".modal"),
			demo: async (rt) => {
				rt.setSetting("bar-buttons", "custom", [...customButtons(rt), { id: randomId().slice(0, 8), bar: "popup", command: "app:toggle-left-sidebar", icon: "lucide-panel-left", name: rt.t("tut.bars.demoButton") }]);
				await rt.wait(300);
				rt.select(["br-1"]);
			},
		},
		{
			title: "tut.bars.image.title",
			body: "tut.bars.image.body",
			task: "tut.bars.image.task",
			touch: "tut.bars.image.touch",
			target: settingsButton,
			focus: ["br-photo"],
			enter: (rt) => {
				customAtStart = customButtons(rt).filter((b) => b.bar === "image").length;
				hiddenAtStart = hiddenButtons(rt).filter((k) => k.startsWith("image:")).length;
				rt.select(["br-photo"]);
			},
			check: (rt) => (customButtons(rt).filter((b) => b.bar === "image").length > customAtStart || hiddenButtons(rt).filter((k) => k.startsWith("image:")).length > hiddenAtStart) && !dialogOpen(".modal"),
			demo: async (rt) => {
				rt.select(["br-photo"]);
				await rt.wait(400);
				rt.command("bar-buttons:customize");
				await rt.wait(900);
				// The first switch of the image popup's list goes off.
				const heads = Array.from(activeDocument.querySelectorAll<HTMLElement>(`${BARS_DIALOG} .setting-item-heading`));
				const head = heads[3];
				let el = head?.nextElementSibling;
				while (el && !el.hasClass("opc-bars-list")) el = el.nextElementSibling;
				el?.querySelector<HTMLElement>(".checkbox-container.is-enabled")?.click();
				await rt.wait(900);
				closeDialog(BARS_DIALOG);
				await rt.wait(300);
				rt.select(["br-photo"]);
			},
		},
		{
			title: "tut.bars.s4.title",
			body: "tut.bars.s4.body",
			task: "tut.bars.s4.task",
			target: settingsButton,
			enter: (rt) => {
				hiddenAtStart = hiddenButtons(rt).length;
			},
			check: (rt) => hiddenButtons(rt).length < hiddenAtStart && !dialogOpen(BARS_DIALOG),
			demo: (rt) => rt.setSetting("bar-buttons", "hidden", hiddenButtons(rt).slice(0, -1)),
		},
		{
			title: "tut.bars.order.title",
			body: "tut.bars.order.body",
			task: "tut.bars.order.task",
			touch: "tut.bars.order.touch",
			target: settingsButton,
			enter: (rt) => {
				orderAtStart = JSON.stringify(rt.setting("bar-buttons", "order") ?? {});
			},
			check: (rt) => JSON.stringify(rt.setting("bar-buttons", "order") ?? {}) !== orderAtStart && !dialogOpen(BARS_DIALOG),
			demo: async (rt) => {
				rt.command("bar-buttons:customize");
				await rt.wait(900);
				// The first button of the bottom bar goes to the end of it, as a drag would put it.
				const list = activeDocument.querySelector<HTMLElement>(`${BARS_DIALOG} .opc-bars-list`);
				const keys = Array.from(list?.querySelectorAll<HTMLElement>(".opc-bars-row") ?? []).map((el) => el.dataset.key ?? "");
				const order = (rt.setting("bar-buttons", "order") as Record<string, string[]> | undefined) ?? {};
				if (keys.length > 1) rt.setSetting("bar-buttons", "order", { ...order, bottom: [...keys.slice(1), keys[0]!] });
				await rt.wait(900);
				closeDialog(BARS_DIALOG);
			},
		},
		{
			title: "tut.bars.menus.title",
			body: "tut.bars.menus.body",
			task: "tut.bars.menus.task",
			touch: "tut.bars.menus.touch",
			target: settingsButton,
			enter: (rt) => {
				menuHiddenAtStart = contextMenuChoice(rt).hidden.length;
			},
			check: (rt) => contextMenuChoice(rt).hidden.length > menuHiddenAtStart && !dialogOpen(BARS_DIALOG),
			demo: async (rt) => {
				// The menu shows its items once, so the list knows them.
				const node = rt.node("br-1");
				const r = node?.nodeEl.getBoundingClientRect();
				if (node && r) node.nodeEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 20, button: 2 }));
				await rt.wait(1200);
				activeDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
				await rt.wait(400);
				rt.command("bar-buttons:customize");
				await rt.wait(900);
				activeDocument.querySelector(`${BARS_DIALOG} .opc-bars-menu-list[data-menu="context"]`)?.scrollIntoView({ block: "center" });
				await rt.wait(600);
				const choice = contextMenuChoice(rt);
				const item = choice.seen.find((i) => !choice.hidden.includes(i.title));
				const menus = rt.setting("bar-buttons", "menus") as Record<string, unknown>;
				if (item) rt.setSetting("bar-buttons", "menus", { ...menus, context: { ...choice, hidden: [...choice.hidden, item.title] } });
				await rt.wait(1200);
				closeDialog(BARS_DIALOG);
			},
		},
		{
			title: "tut.bars.menu.title",
			body: "tut.bars.menu.body",
			task: "tut.bars.menu.task",
			touch: "tut.bars.menu.touch",
			target: settingsButton,
			enter: (rt) => {
				menuStyleAtStart = menuStyleOf(rt);
			},
			// An option changed and the settings closed again (they cover the board and this panel).
			check: (rt) => menuStyleOf(rt) !== menuStyleAtStart && !settingsOpen(rt),
			demo: async (rt) => {
				rt.setSetting("menu-style", "fontSize", 18);
				rt.setSetting("menu-style", "itemPadding", 8);
				await rt.wait(400);
				// Show it: the menu of a card.
				const node = rt.node("br-1");
				const r = node?.nodeEl.getBoundingClientRect();
				if (node && r) node.nodeEl.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.x + 30, clientY: r.y + 20, button: 2 }));
				await rt.wait(1800);
				activeDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
			},
		},
		{ title: "tut.bars.s5.title", body: "tut.bars.s5.body" },
	],
};

// ---------- 22. Images ----------

const CROP_DIALOG = ".opc-crop-modal";
const EXPORT_DIALOG = ".opc-export-modal";
const exportVisit = visitedDialog(EXPORT_DIALOG);
const photoName = (t: TutorialRuntime["t"]) => `${fileSafe(t("tut.images.photoName"))}.svg`;
const barsPhotoName = (t: TutorialRuntime["t"]) => `${fileSafe(t("tut.bars.photoName"))}.svg`;

/** A small landscape to crop: text, so it fits the practice files. */
const PRACTICE_PHOTO = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">
	<rect width="800" height="500" fill="#8fd3f4"/>
	<circle cx="620" cy="110" r="60" fill="#ffd166"/>
	<path d="M0 340 L180 150 L330 320 L470 190 L800 400 L800 500 L0 500 Z" fill="#5b7c99"/>
	<path d="M0 420 C200 340 420 470 800 370 L800 500 L0 500 Z" fill="#4c9f70"/>
	<circle cx="170" cy="400" r="26" fill="#2f6f4f"/>
	<rect x="164" y="420" width="12" height="36" fill="#6b4f3a"/>
</svg>
`;

/** Selects the photo and opens the crop dialog from its toolbar button. */
async function openCrop(rt: TutorialRuntime): Promise<void> {
	rt.select(["i-photo"]);
	await rt.wait(350);
	rt.canvas.menu.menuEl.querySelector<HTMLElement>(".opc-menu-crop")?.click();
	await rt.wait(700);
}

const images: TutorialDefinition = {
	id: "images",
	icon: "image",
	title: "tut.images.title",
	summary: "tut.images.summary",
	modules: ["image-crop", "image-export"],
	files: (t) => [{ path: photoName(t), content: PRACTICE_PHOTO }],
	board: (t, folder) => ({
		nodes: [title("i-title", t("tut.images.board.title"), 0, -140, 700, 80), fileCard("i-photo", `${folder}/${photoName(t)}`, 0, 0, 480, 300), card("i-note", t("tut.images.board.note"), 560, 90, 260, 110, { color: "5" })],
		edges: [],
	}),
	steps: [
		{
			title: "tut.images.s1.title",
			body: "tut.images.s1.body",
			task: "tut.images.s1.task",
			target: ".opc-menu-crop",
			enter: (rt) => rt.select(["i-photo"]),
			check: (rt) => !!rt.extra("i-photo").crop && !dialogOpen(CROP_DIALOG),
			demo: async (rt) => {
				await openCrop(rt);
				activeDocument.querySelectorAll<HTMLElement>(`${CROP_DIALOG} .opc-crop-presets button`)[4]?.click();
				await rt.wait(900);
				activeDocument.querySelector<HTMLElement>(`${CROP_DIALOG} .modal-button-container .mod-cta`)?.click();
			},
		},
		{
			title: "tut.images.s2.title",
			body: "tut.images.s2.body",
			task: "tut.images.s2.task",
			focus: ["i-photo"],
			enter: (rt) => rt.select(["i-photo"]),
			check: (rt) => {
				const a = findNode(rt.before, "i-photo");
				const b = findNode(rt.now(), "i-photo");
				return !!a && !!b && Math.abs(a.width - b.width) >= 20;
			},
			demo: (rt) => {
				const node = rt.node("i-photo");
				if (!node) return;
				const width = node.width + 160;
				rt.change(() => node.moveAndResize({ x: node.x, y: node.y, width, height: Math.round((width * node.height) / node.width) }));
			},
		},
		{
			title: "tut.images.s3.title",
			body: "tut.images.s3.body",
			task: "tut.images.s3.task",
			enter: (rt) => rt.select(["i-photo"]),
			check: (rt) => !rt.extra("i-photo").crop && !dialogOpen(CROP_DIALOG),
			demo: async (rt) => {
				await openCrop(rt);
				activeDocument.querySelector<HTMLElement>(`${CROP_DIALOG} .modal-button-container button`)?.click();
				await rt.wait(900);
				activeDocument.querySelector<HTMLElement>(`${CROP_DIALOG} .modal-button-container .mod-cta`)?.click();
			},
		},
		{
			title: "tut.images.s4.title",
			body: "tut.images.s4.body",
			task: "tut.images.s4.task",
			enter: () => exportVisit.reset(),
			check: () => exportVisit.check(),
			demo: async (rt) => {
				rt.command("image-export:export-image");
				await rt.wait(1800);
				closeDialog(EXPORT_DIALOG);
			},
		},
		{ title: "tut.images.s5.title", body: "tut.images.s5.body" },
	],
};

// ---------- 23. A canvas as a file ----------

const PROPERTIES_DIALOG = ".opc-properties-modal";
const propertiesButton = (rt: TutorialRuntime) => rt.canvas.view.containerEl.querySelector<HTMLElement>(".opc-canvas-properties-action");
const frontmatterTags = (rt: TutorialRuntime): unknown[] => {
	// A row left as text is a single tag.
	const tags = rt.root().frontmatter?.tags;
	return Array.isArray(tags) ? tags : typeof tags === "string" && tags.trim() ? [tags.trim().replace(/^#/, "")] : [];
};
const referenceNote = (t: TutorialRuntime["t"]) => `${fileSafe(t("tut.file.noteName"))}.md`;
let readonlyAtStart = false;

/** The core tag pane is showing one of the board's tags. */
const tagPaneShows = (rt: TutorialRuntime) => {
	const pane = rt.app.workspace.getLeavesOfType("tag")[0]?.view.containerEl;
	return !!pane?.isShown() && frontmatterTags(rt).some((tag) => pane.textContent?.includes(String(tag)));
};

const file: TutorialDefinition = {
	id: "file",
	icon: "file-cog",
	title: "tut.file.title",
	summary: "tut.file.summary",
	modules: ["canvas-properties", "canvas-metadata", "readonly-plus"],
	files: (t) => [{ path: referenceNote(t), content: `# ${t("tut.file.noteName")}\n\n${t("tut.file.noteText")}\n` }],
	board: (t, folder) => ({
		nodes: [
			title("f-title", t("tut.file.board.title"), 0, -140, 700, 80),
			card("f-1", `${t("tut.file.board.c1")}\n\n[[${folder}/${referenceNote(t).replace(/\.md$/, "")}|${t("tut.file.noteName")}]]`, 0, 0, 300, 130, { color: "4" }),
			card("f-2", t("tut.file.board.c2"), 380, 20, 260, 90, { color: "5" }),
		],
		edges: [edge("f-e1", "f-1", "right", "f-2", "left")],
	}),
	steps: [
		{
			title: "tut.file.s1.title",
			body: "tut.file.s1.body",
			task: "tut.file.s1.task",
			target: propertiesButton,
			check: (rt) => frontmatterTags(rt).length > 0 && !dialogOpen(PROPERTIES_DIALOG),
			demo: async (rt) => {
				propertiesButton(rt)?.click();
				await rt.wait(1200);
				closeDialog(PROPERTIES_DIALOG);
				rt.change(() => rt.data.root(rt.canvas).set({ frontmatter: { ...rt.root().frontmatter, tags: [rt.t("tut.file.tag")], aliases: [rt.t("tut.file.alias")] } }));
			},
		},
		{
			title: "tut.file.s2.title",
			body: "tut.file.s2.body",
			task: "tut.file.s2.task",
			check: tagPaneShows,
			demo: (rt) => void rt.command("core:tag-pane:open"),
		},
		{
			title: "tut.file.s3.title",
			body: "tut.file.s3.body",
			task: "tut.file.s3.task",
			touch: "tut.file.s3.touch",
			target: settingsButton,
			check: (rt) => rt.canvas.readonly,
			demo: (rt) => rt.canvas.setReadonly(true),
		},
		{
			title: "tut.file.s4.title",
			body: "tut.file.s4.body",
			task: "tut.file.s4.task",
			touch: "tut.file.s4.touch",
			target: settingsButton,
			enter: (rt) => {
				readonlyAtStart = rt.canvas.readonly;
			},
			check: (rt) => readonlyAtStart && !rt.canvas.readonly,
			demo: (rt) => rt.canvas.setReadonly(false),
		},
		{ title: "tut.file.s5.title", body: "tut.file.s5.body" },
	],
};

// ---------- 25. Smart groups ----------

const SG_MEMBERS = ["sg-title", "sg-photo", "sg-caption"];
const smartGroupOf = (rt: TutorialRuntime, id: string) => rt.extra(id).smartGroup;
/** The three slide pieces share one smart group. */
const piecesGrouped = (rt: TutorialRuntime) => {
	const g = smartGroupOf(rt, SG_MEMBERS[0]!);
	return !!g && SG_MEMBERS.every((id) => smartGroupOf(rt, id) === g);
};

const smartGroups: TutorialDefinition = {
	id: "smart-groups",
	icon: "group",
	title: "tut.sg.title",
	summary: "tut.sg.summary",
	modules: ["smart-groups"],
	board: (t) => ({
		nodes: [
			card("sg-title", `## ${t("tut.sg.board.title")}`, 0, 0, 420, 80, { color: "5" }),
			card("sg-photo", t("tut.sg.board.photo"), 0, 110, 420, 180, { color: "4" }),
			card("sg-caption", t("tut.sg.board.caption"), 0, 320, 420, 70),
			card("sg-note", t("tut.sg.board.note"), 520, 110, 260, 100, { color: "3" }),
		],
		edges: [],
	}),
	steps: [
		{ title: "tut.sg.s1.title", body: "tut.sg.s1.body" },
		{
			title: "tut.sg.s2.title",
			body: "tut.sg.s2.body",
			task: "tut.sg.s2.task",
			touch: "tut.sg.s2.touch",
			target: ".opc-menu-smart-group",
			check: piecesGrouped,
			demo: async (rt) => {
				rt.select(SG_MEMBERS);
				await rt.wait(600);
				rt.command("smart-groups:group");
			},
		},
		{
			title: "tut.sg.s3.title",
			body: "tut.sg.s3.body",
			task: "tut.sg.s3.task",
			enter: (rt) => rt.canvas.deselectAll(),
			check: (rt) => piecesGrouped(rt) && SG_MEMBERS.every((id) => rt.selected().includes(id)),
			demo: (rt) => rt.select(SG_MEMBERS),
		},
		{
			title: "tut.sg.s4.title",
			body: "tut.sg.s4.body",
			task: "tut.sg.s4.task",
			check: (rt) => SG_MEMBERS.every((id) => moved(rt, id)),
			demo: async (rt) => {
				rt.select(SG_MEMBERS);
				await Promise.all(SG_MEMBERS.map((id) => glide(rt, id, -80, 60)));
			},
		},
		{
			title: "tut.sg.s5.title",
			body: "tut.sg.s5.body",
			task: "tut.sg.s5.task",
			touch: "tut.sg.s5.touch",
			check: (rt) => piecesGrouped(rt) && rt.selected().length === 1 && SG_MEMBERS.includes(rt.selected()[0]!),
			demo: (rt) => rt.select(["sg-caption"]),
		},
		{
			title: "tut.sg.s6.title",
			body: "tut.sg.s6.body",
			task: "tut.sg.s6.task",
			touch: "tut.sg.s6.touch",
			check: (rt) => SG_MEMBERS.every((id) => !smartGroupOf(rt, id)),
			demo: async (rt) => {
				rt.select(SG_MEMBERS);
				await rt.wait(600);
				rt.command("smart-groups:ungroup");
			},
		},
		{ title: "tut.sg.s7.title", body: "tut.sg.s7.body" },
	],
};

// ---------- 26–27. Writing in notes: paragraph indents, font size per note ----------

/** The parts of a note's view the writing tutorials read and drive (no Obsidian import: tests load this file). */
interface WritingTab {
	file?: { path: string } | null;
	editor?: { getValue(): string; setCursor(line: number, ch?: number): void; focus(): void };
	getMode?(): string;
}
const writingNotePath = (rt: TutorialRuntime, name: string) => `${rt.folder}/${fileSafe(name)}.md`;
const writingTab = (rt: TutorialRuntime, name: string) => {
	const path = writingNotePath(rt, name);
	const leaf = rt.app.workspace.getLeavesOfType("markdown").find((l) => (l.view as unknown as WritingTab).file?.path === path);
	return leaf ? { leaf, view: leaf.view as unknown as WritingTab } : null;
};
/** Opens the practice note beside the board (it is written with the board and deleted with it). */
async function openWritingNote(rt: TutorialRuntime, name: string): Promise<void> {
	if (writingTab(rt, name)) return;
	const file = rt.app.vault.getAbstractFileByPath(writingNotePath(rt, name));
	const boardLeaf = rt.app.workspace.getLeavesOfType("canvas").find((l) => (l.view as unknown as { canvas?: unknown }).canvas === rt.canvas);
	if (!file || !boardLeaf) return;
	const leaf = rt.app.workspace.createLeafBySplit(boardLeaf, "vertical");
	await leaf.openFile(file as Parameters<typeof leaf.openFile>[0], { active: false, state: { mode: "source" } });
	await rt.wait(400);
	frameClearOfPanel(rt);
}
/** Puts the cursor in the practice note (line, column) and focuses it, as a click would. */
function focusNote(rt: TutorialRuntime, name: string, line: number, ch = 0): boolean {
	const tab = writingTab(rt, name);
	if (!tab?.view.editor) return false;
	rt.app.workspace.setActiveLeaf(tab.leaf, { focus: true });
	tab.view.editor.focus();
	tab.view.editor.setCursor(line, ch);
	return true;
}
/**
 * Runs a command in the focused note ("<module>:<id>" of this plugin, or "core:<id>").
 * rt.command focuses the board first, which would take the cursor out of the note.
 */
function runInNote(rt: TutorialRuntime, id: string): boolean {
	const commands = (rt.app as unknown as { commands: { commands: Record<string, unknown>; executeCommandById(id: string): boolean } }).commands;
	const full = id.startsWith("core:") ? id.slice("core:".length) : Object.keys(commands.commands).find((k) => k.endsWith(`:${id}`));
	return !!full && commands.executeCommandById(full);
}
const noteLines = (rt: TutorialRuntime, name: string) => writingTab(rt, name)?.view.editor?.getValue().split("\n") ?? [];
async function setNoteMode(rt: TutorialRuntime, name: string, mode: "source" | "preview"): Promise<void> {
	const tab = writingTab(rt, name);
	if (!tab) return;
	const state = tab.leaf.getViewState();
	await tab.leaf.setViewState({ ...state, state: { ...(state.state ?? {}), mode } });
}
const inReadingMode = (rt: TutorialRuntime, name: string) => writingTab(rt, name)?.view.getMode?.() === "preview";

const EM = " ";
const LIST_LINE = /^\s*[-*+] /;
const indentNote = (t: Translate) => t("tut.indent.noteName");
const emCount = (rt: TutorialRuntime) => noteLines(rt, indentNote(rt.t)).join("\n").split(EM).length - 1;
/** Line numbers in the practice note: title, blank, first paragraph, blank, second, blank, two bullets. */
const INDENT_P1 = 2;
const INDENT_CARD = "in-card";
const INDENT_ITEM2 = 7;
let emsAtStart = 0;

const indent: TutorialDefinition = {
	id: "indent",
	icon: "indent-increase",
	title: "tut.indent.title",
	summary: "tut.indent.summary",
	modules: ["paragraph-indent"],
	files: (t) => [
		{
			path: `${fileSafe(indentNote(t))}.md`,
			content: ["# " + t("tut.indent.note.title"), "", t("tut.indent.note.p1"), "", t("tut.indent.note.p2"), "", "- " + t("tut.indent.note.b1"), "- " + t("tut.indent.note.b2"), ""].join("\n"),
		},
	],
	board: (t) => ({
		nodes: [card("in-hint", t("tut.indent.board.hint"), 0, 0, 360, 120, { color: "5" }), card(INDENT_CARD, t("tut.indent.board.card"), 0, 170, 360, 260)],
		edges: [],
	}),
	steps: [
		{ title: "tut.indent.s1.title", body: "tut.indent.s1.body", enter: (rt) => void openWritingNote(rt, indentNote(rt.t)) },
		{
			title: "tut.indent.s2.title",
			body: "tut.indent.s2.body",
			task: "tut.indent.s2.task",
			touch: "tut.indent.s2.touch",
			enter: (rt) => void openWritingNote(rt, indentNote(rt.t)),
			check: (rt) => noteLines(rt, indentNote(rt.t)).some((l) => l.startsWith(EM) && !LIST_LINE.test(l)),
			demo: (rt) => {
				if (focusNote(rt, indentNote(rt.t), INDENT_P1, 0)) runInNote(rt, "paragraph-indent:insert");
			},
		},
		{
			title: "tut.indent.s3.title",
			body: "tut.indent.s3.body",
			task: "tut.indent.s3.task",
			check: (rt) => noteLines(rt, indentNote(rt.t)).some((l) => /^[ \t]+[-*+] /.test(l)),
			demo: (rt) => {
				if (focusNote(rt, indentNote(rt.t), INDENT_ITEM2, 2)) runInNote(rt, "core:editor:indent-list");
			},
		},
		{
			title: "tut.indent.s4.title",
			body: "tut.indent.s4.body",
			task: "tut.indent.s4.task",
			touch: "tut.indent.s4.touch",
			enter: (rt) => {
				emsAtStart = emCount(rt);
			},
			check: (rt) => emCount(rt) < emsAtStart,
			demo: (rt) => {
				const lines = noteLines(rt, indentNote(rt.t));
				const line = lines.findIndex((l) => l.startsWith(EM));
				if (line >= 0 && focusNote(rt, indentNote(rt.t), line, lines[line]!.length)) runInNote(rt, "paragraph-indent:remove");
			},
		},
		{
			title: "tut.indent.s5.title",
			body: "tut.indent.s5.body",
			task: "tut.indent.s5.task",
			touch: "tut.indent.s5.touch",
			check: (rt) => inReadingMode(rt, indentNote(rt.t)),
			demo: (rt) => setNoteMode(rt, indentNote(rt.t), "preview"),
		},
		{
			title: "tut.indent.card.title",
			body: "tut.indent.card.body",
			task: "tut.indent.card.task",
			touch: "tut.indent.card.touch",
			enter: (rt) => rt.select([INDENT_CARD]),
			check: (rt) => {
				const node = rt.node(INDENT_CARD);
				return !!node && !node.isEditing && (node.getData().text ?? "").startsWith(EM);
			},
			demo: async (rt) => {
				const node = rt.node(INDENT_CARD);
				if (!node) return;
				rt.select([INDENT_CARD]);
				node.startEditing();
				await rt.wait(900);
				const editor = (node.child as { editor?: { focus(): void; setCursor(line: number, ch: number): void } } | undefined)?.editor;
				editor?.focus();
				editor?.setCursor(0, 0);
				// The same command as Tab (and the one touch screens use from the palette).
				if (!editor || !runInNote(rt, "paragraph-indent:insert")) {
					const text = node.getData().text ?? "";
					rt.change(() => node.setData({ ...node.getData(), text: EM + EM + text }));
				}
				await rt.wait(1500);
				rt.canvas.deselectAll();
			},
		},
		{ title: "tut.indent.s6.title", body: "tut.indent.s6.body" },
	],
};

const sizeNote = (t: Translate) => t("tut.fontsize.noteName");
const sizeProperty = (rt: TutorialRuntime) => {
	const key = rt.setting("note-font-size", "property");
	return (typeof key === "string" ? key.trim() : "") || "font-size";
};
const vaultTextSize = () => Number.parseFloat(getComputedStyle(activeDocument.body).getPropertyValue("--font-text-size")) || 16;
/** The size the practice note asks for, in pixels (null: the vault's size). */
function noteSize(rt: TutorialRuntime): number | null {
	const file = rt.app.vault.getAbstractFileByPath(writingNotePath(rt, sizeNote(rt.t)));
	if (!file) return null;
	const fm = rt.app.metadataCache.getFileCache(file as Parameters<typeof rt.app.metadataCache.getFileCache>[0])?.frontmatter;
	return parseFontSize(fm?.[sizeProperty(rt)], vaultTextSize());
}
let sizeAtStart: number | null = null;
const rememberSize = (rt: TutorialRuntime) => {
	sizeAtStart = noteSize(rt);
};

const fontSize: TutorialDefinition = {
	id: "font-size",
	icon: "a-large-small",
	title: "tut.fontsize.title",
	summary: "tut.fontsize.summary",
	modules: ["note-font-size"],
	files: (t) => [{ path: `${fileSafe(sizeNote(t))}.md`, content: ["# " + t("tut.fontsize.note.title"), "", t("tut.fontsize.note.p1"), "", "- " + t("tut.fontsize.note.b1"), ""].join("\n") }],
	board: (t) => ({ nodes: [card("fs-hint", t("tut.fontsize.board.hint"), 0, 0, 360, 120, { color: "5" })], edges: [] }),
	steps: [
		{ title: "tut.fontsize.s1.title", body: "tut.fontsize.s1.body", enter: (rt) => void openWritingNote(rt, sizeNote(rt.t)) },
		{
			title: "tut.fontsize.s2.title",
			body: "tut.fontsize.s2.body",
			task: "tut.fontsize.s2.task",
			touch: "tut.fontsize.s2.touch",
			enter: (rt) => {
				void openWritingNote(rt, sizeNote(rt.t));
				rememberSize(rt);
			},
			check: (rt) => (noteSize(rt) ?? vaultTextSize()) > (sizeAtStart ?? vaultTextSize()),
			demo: async (rt) => {
				if (!focusNote(rt, sizeNote(rt.t), 2)) return;
				runInNote(rt, "note-font-size:increase");
				await rt.wait(400);
				runInNote(rt, "note-font-size:increase");
			},
		},
		{
			title: "tut.fontsize.s3.title",
			body: "tut.fontsize.s3.body",
			task: "tut.fontsize.s3.task",
			touch: "tut.fontsize.s3.touch",
			enter: rememberSize,
			check: (rt) => {
				const size = noteSize(rt);
				return size !== null && size !== sizeAtStart && !dialogOpen(".modal-container");
			},
			demo: async (rt) => {
				const file = rt.app.vault.getAbstractFileByPath(writingNotePath(rt, sizeNote(rt.t)));
				const key = sizeProperty(rt);
				if (file)
					await rt.app.fileManager.processFrontMatter(file as Parameters<typeof rt.app.fileManager.processFrontMatter>[0], (fm: Record<string, unknown>) => {
						fm[key] = 22;
					});
			},
		},
		{
			title: "tut.fontsize.s4.title",
			body: "tut.fontsize.s4.body",
			task: "tut.fontsize.s4.task",
			touch: "tut.fontsize.s4.touch",
			check: (rt) => inReadingMode(rt, sizeNote(rt.t)),
			demo: (rt) => setNoteMode(rt, sizeNote(rt.t), "preview"),
		},
		{
			title: "tut.fontsize.s5.title",
			body: "tut.fontsize.s5.body",
			task: "tut.fontsize.s5.task",
			touch: "tut.fontsize.s5.touch",
			check: (rt) => noteSize(rt) === null,
			demo: async (rt) => {
				await setNoteMode(rt, sizeNote(rt.t), "source");
				await rt.wait(300);
				if (focusNote(rt, sizeNote(rt.t), 2)) runInNote(rt, "note-font-size:reset");
			},
		},
		{ title: "tut.fontsize.s6.title", body: "tut.fontsize.s6.body" },
	],
};

// ---------- 28. Your shortcuts ----------

const SHORTCUTS_DIALOG = ".opc-shortcuts-modal";
const shortcutsVisit = visitedDialog(SHORTCUTS_DIALOG);
/** The help button (?) of the side bar, which opens the Shortcuts window. */
const helpButton = (rt: TutorialRuntime) => rt.canvas.canvasControlsEl.querySelector<HTMLElement>(".opc-shortcuts-button");
const drawingOn = (rt: TutorialRuntime) => !!rt.canvas.wrapperEl.querySelector(".opc-ink-toolbar");
/** Opens the Shortcuts window the way a user would (the ? button) and searches for `query`. */
const openShortcutsWindow = async (rt: TutorialRuntime, query: string) => {
	if (!dialogOpen(SHORTCUTS_DIALOG)) helpButton(rt)?.click();
	await rt.wait(600);
	const search = activeDocument.querySelector<HTMLInputElement>(`${SHORTCUTS_DIALOG} .opc-shortcuts-search`);
	if (search) {
		search.value = query;
		search.dispatchEvent(new Event("input"));
	}
	await rt.wait(900);
};

const shortcuts: TutorialDefinition = {
	id: "shortcuts",
	icon: "keyboard",
	title: "tut.keys.title",
	summary: "tut.keys.summary",
	modules: ["drawing"],
	// The practice changes the real keys: the user's own come back when the tutorial ends.
	restoreShortcuts: true,
	board: (t) => ({
		nodes: [title("ks-title", t("tut.keys.board.title"), 0, -140, 640, 80), card("ks-1", t("tut.keys.board.c1"), 0, 0, 300, 120, { color: "5" }), card("ks-2", t("tut.keys.board.c2"), 340, 0, 300, 120, { color: "4" })],
		edges: [],
	}),
	steps: [
		{
			title: "tut.keys.s1.title",
			body: "tut.keys.s1.body",
			task: "tut.keys.s1.task",
			touch: "tut.keys.s1.touch",
			target: helpButton,
			enter: () => shortcutsVisit.reset(),
			check: () => shortcutsVisit.check(),
			demo: async (rt) => {
				await openShortcutsWindow(rt, "");
				await rt.wait(1200);
				closeDialog(SHORTCUTS_DIALOG);
			},
		},
		{
			title: "tut.keys.s2.title",
			body: "tut.keys.s2.body",
			task: "tut.keys.s2.task",
			touch: "tut.keys.s2.touch",
			target: helpButton,
			check: (rt) => !rt.shortcuts.isDefault("drawing.toggle") && !dialogOpen(SHORTCUTS_DIALOG),
			demo: async (rt) => {
				await openShortcutsWindow(rt, rt.t("shortcuts.action.drawing.toggle"));
				await rt.shortcuts.set("drawing.toggle", [...rt.shortcuts.combos("drawing.toggle"), "Shift+D"]);
				await rt.wait(1400);
				closeDialog(SHORTCUTS_DIALOG);
			},
		},
		{
			title: "tut.keys.s3.title",
			body: "tut.keys.s3.body",
			task: "tut.keys.s3.task",
			touch: "tut.keys.s3.touch",
			check: (rt) => drawingOn(rt),
			demo: (rt) => void rt.command("drawing:toggle-drawing"),
		},
		{
			title: "tut.keys.s4.title",
			body: "tut.keys.s4.body",
			task: "tut.keys.s4.task",
			touch: "tut.keys.s4.touch",
			target: helpButton,
			// Drawing would keep the keys of the board busy: it ends here.
			enter: (rt) => {
				if (drawingOn(rt)) rt.command("drawing:toggle-drawing");
			},
			check: (rt) => rt.shortcuts.isDefault("drawing.toggle") && !dialogOpen(SHORTCUTS_DIALOG),
			demo: async (rt) => {
				await openShortcutsWindow(rt, rt.t("shortcuts.action.drawing.toggle"));
				await rt.shortcuts.reset("drawing.toggle");
				await rt.wait(1200);
				closeDialog(SHORTCUTS_DIALOG);
			},
		},
		{ title: "tut.keys.s5.title", body: "tut.keys.s5.body" },
	],
};

export const TUTORIALS: readonly TutorialDefinition[] = [basics, notes, shapes, edges, drawing, layers, present, mindmap, navigate, organize, markdown, select, blocks, vault, style, big, direction, pdf, pages, arrows, bars, images, file, columns, columnsDown, toc, autoHeaders, handwriting, smartGroups, indent, fontSize, shortcuts];
