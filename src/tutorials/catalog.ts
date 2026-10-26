/**
 * The tutorials. Each builds a small demo board and walks through a feature with tasks that are
 * checked on the live board; "Show me" does the task for the user, on the same board.
 */
import type { CanvasFileData, CanvasNodeData } from "../data/json-canvas";
import { SCHEMA_KEY, type LayerInfo, type OpcRoot } from "../data/schema";
import { builtinTemplate } from "../modules/board-templates/builtins";
import { reid, translate as shiftData } from "../modules/board-templates/logic";
import { STICKY_COLORS } from "../modules/sticky-notes/logic";
import { added, addedEdges, arrow, card, count, edge, edgesOf, ellipsePoints, extraOf, findNode, group, ink, kindOf, nodesOf, randomId, shape, sticky, strokeCount, title } from "./board";
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
			check: (rt) => rt.seen("undo"),
			demo: (rt) => rt.canvas.undo(),
		},
	],
};

// ---------- 2. Sticky notes and text ----------

const notes: TutorialDefinition = {
	id: "notes",
	icon: "sticky-note",
	title: "tut.notes.title",
	summary: "tut.notes.summary",
	modules: ["sticky-notes", "floating-text", "text-align", "auto-resize"],
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
	modules: ["drawing", "free-lines", "shapes"],
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
			check: (rt) => rt.seen("presentation-slide-changed", (_c, _s, index) => typeof index === "number" && index >= 1),
			demo: (rt) => {
				if (!rt.command("presentation:next")) rt.command("presentation:start");
			},
		},
		{
			title: "tut.present.s6.title",
			body: "tut.present.s6.body",
			task: "tut.present.s6.task",
			check: (rt) => rt.seen("presentation-ended"),
			demo: (rt) => void rt.command("presentation:end"),
		},
	],
};

// ---------- 8. Mind maps ----------

const mindmap: TutorialDefinition = {
	id: "mindmap",
	icon: "network",
	title: "tut.mindmap.title",
	summary: "tut.mindmap.summary",
	modules: ["mindmap", "branch-collapse", "auto-layout", "note-blocks"],
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
			enter: (rt) => rt.select(["m-root"]),
			check: (rt) => rt.seen("layout-applied"),
			demo: (rt) => {
				rt.select(["m-root"]);
				rt.command("auto-layout:layout-mindmap");
			},
		},
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
export const TUTORIALS: readonly TutorialDefinition[] = [basics, notes, shapes, edges, drawing, layers, present, mindmap, navigate, organize, markdown, select, blocks];
