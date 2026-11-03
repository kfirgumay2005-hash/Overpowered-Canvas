import { setIcon } from "obsidian";
import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import type { Dir, TNode } from "../mindmap/tree";
import { pagesHost } from "../pages/api";
import { canvasDirection, centerOn, mutate, nodeType, selectedNodes } from "../shared";
import { ColumnView, type ColumnOptions } from "./columns";
import { groupEdges, largestRoot, orderedChildren, pathTo, tapDirection, treeStep, walkStep, type WalkBox, type WalkEdge } from "./walk";

/** What the arrow keys follow: the map's hierarchy, or where the cards sit. */
export type WalkKeys = "tree" | "layout";

export interface WalkOptions {
	keys: WalkKeys;
	/** A tap on the empty board around the card acts as an arrow key. */
	tapZones: boolean;
	/** Small arrows around the card, where a step is possible. */
	hints: boolean;
	columns: ColumnOptions;
}

interface Walk {
	/** The file walked: a tab that opens another canvas keeps its canvas object. */
	file: string;
	start: string;
	current: string;
	/** Per parent: the child last visited under it. */
	visited: Map<string, string>;
	wasReadonly: boolean;
	hints: HTMLElement | null;
	columns: ColumnView | null;
	cleanup: () => void;
}

const ARROWS: Record<string, Dir> = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" };
/** A press that moved less than this is a tap (jump to that card). */
const TAP_MOVE = 6;
const ZOOM_STEP = 0.5;
/** Controls drawn by the walk: a tap on them is not a tap on the board. */
const WALK_UI = ".opc-walk-pad, .opc-walk-hints, .opc-columns";
const DIRS: Dir[] = ["up", "down", "left", "right"];
const DRAWINGS: ReadonlySet<string> = new Set(["ink", "line", "guide"]);
const LABELS = { up: "presentation.walk.up", down: "presentation.walk.down", left: "presentation.walk.left", right: "presentation.walk.right" } as const;

/** Cards (and groups) a walk can stop on. Cards on other pages count: a walk can go there. */
function shown(node: CanvasNodeLike): boolean {
	const el = node.nodeEl;
	return !node.id.includes("~") && !el.hasClass("opc-hidden-by-collapse") && !el.hasClass("opc-hidden-by-branch") && !el.hasClass("opc-layer-hidden");
}

/**
 * Walking through a map without slides: the arrow keys (or the on-screen arrows) move along the
 * map's links at the current zoom. Read-only while walking; Esc ends it.
 */
export function enableWalk(ctx: ModuleContext<object>, presenting: (canvas: CanvasLike) => boolean, options: () => WalkOptions) {
	const walks = new Map<CanvasLike, Walk>();

	/**
	 * The map as a walk sees it: cards and groups joined by their edges. A group leads into the
	 * cards inside it that no arrow leads to, then to where its own arrows go (see groupEdges), and
	 * a card whose branch was moved to a page leads to that page.
	 */
	const model = (canvas: CanvasLike) => {
		const nodes = new Map<string, TNode>();
		const boxes: WalkBox[] = [];
		const page = pagesHost.api;
		for (const n of canvas.nodes.values()) {
			// Ink, drawn lines and infinite lines are marks on the board, not stops.
			if (!shown(n) || DRAWINGS.has(ctx.data.node(n).get().kind ?? "")) continue;
			const box = { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
			nodes.set(n.id, box);
			boxes.push({ ...box, group: nodeType(n) === "group", page: page ? page.pageOf(n) : "" });
		}
		const edges: WalkEdge[] = [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id })).filter((e) => nodes.has(e.from) && nodes.has(e.to));
		const virtual = groupEdges(boxes, edges);
		const pageLinks: WalkEdge[] = [];
		for (const link of page?.links(canvas) ?? []) if (nodes.has(link.anchor) && nodes.has(link.root)) pageLinks.push({ from: link.anchor, to: link.root });
		// A page lies in a region of its own: where it is says nothing about the card it hangs from.
		return { nodes, edges: [...virtual, ...edges, ...pageLinks] };
	};

	const nextFrom = (canvas: CanvasLike, walk: Walk, dir: Dir) => {
		const { nodes, edges } = model(canvas);
		const rtl = canvasDirection(canvas) === "rtl";
		// The column view shows the hierarchy, so its arrows always follow it.
		const byTree = options().keys === "tree" || !!walk.columns;
		return { edges, next: byTree ? treeStep(nodes, edges, walk.current, dir, walk.visited, rtl) : walkStep(nodes, edges, walk.current, dir, walk.visited) };
	};

	const labelOf = (move: Dir) => (options().keys === "tree" && move === "left" ? "presentation.walk.parent" : options().keys === "tree" && move === "right" ? "presentation.walk.child" : LABELS[move]);

	/** Keeps the arrows the same size on screen at any zoom. */
	const sizeHints = (canvas: CanvasLike, walk: Walk) => walk.hints?.setCssProps({ "--opc-hint-unit": String(1 / canvas.scale) });

	/** The arrows around the current card: only where a step leads somewhere. */
	const drawHints = (canvas: CanvasLike, walk: Walk) => {
		walk.hints?.remove();
		walk.hints = null;
		const node = canvas.nodes.get(walk.current);
		if (!node || walk.columns || !options().hints) return;
		const hints = node.nodeEl.createDiv({ cls: "opc-walk-hints", attr: { dir: "ltr" } });
		walk.hints = hints;
		sizeHints(canvas, walk);
		// Each arrow does what the same arrow of the walking pad does (by the hierarchy: right is
		// always deeper, left always back up), wherever the cards sit on the board.
		for (const dir of DIRS) {
			if (!nextFrom(canvas, walk, dir).next) continue;
			const hint = hints.createEl("button", { cls: `clickable-icon opc-walk-hint opc-walk-hint-${dir}`, attr: { "aria-label": ctx.t(labelOf(dir)) } });
			setIcon(hint, `arrow-${dir}`);
			hint.addEventListener("pointerdown", (evt) => evt.stopPropagation());
			hint.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				step(canvas, dir, "tap");
			});
		}
	};

	/** What the column view shows for the current card. */
	const drawColumns = (canvas: CanvasLike, walk: Walk) => {
		if (!walk.columns) return;
		const { nodes, edges } = model(canvas);
		const rtl = canvasDirection(canvas) === "rtl";
		const path = pathTo(nodes, edges, walk.current, walk.visited);
		const ids = (list: { id: string }[]) => list.map((n) => n.id);
		const columns = path.map((id, i) => ({ ids: i === 0 ? [id] : ids(orderedChildren(nodes, edges, path[i - 1]!, rtl)), active: id }));
		const children = ids(orderedChildren(nodes, edges, walk.current, rtl));
		if (children.length) columns.push({ ids: children, active: "" });
		walk.columns.show(columns, walk.current, path);
	};

	const go = (canvas: CanvasLike, walk: Walk, id: string, from?: string, how?: "tap") => {
		const node = canvas.nodes.get(id);
		if (!node) return;
		canvas.nodes.get(walk.current)?.nodeEl.removeClass("opc-walk-current");
		if (from && from !== id) walk.visited.set(from, id);
		walk.current = id;
		// A card on another page: show that page first.
		pagesHost.api?.reveal(canvas, node);
		node.nodeEl.addClass("opc-walk-current");
		centerOn(canvas, node);
		drawHints(canvas, walk);
		drawColumns(canvas, walk);
		ctx.events.emit("map-walk-moved", canvas, node, how);
	};

	const step = (canvas: CanvasLike, dir: Dir, how?: "tap") => {
		const walk = walks.get(canvas);
		if (!walk) return;
		const { next, edges } = nextFrom(canvas, walk, dir);
		if (!next) return;
		// Each parent remembers the child visited last (going down, or along the siblings), so
		// going back up and down again returns there.
		const down = edges.some((e) => e.from === walk.current && e.to === next);
		const sharedParent = edges.find((e) => e.to === next && edges.some((f) => f.from === e.from && f.to === walk.current))?.from;
		go(canvas, walk, next, down ? walk.current : sharedParent, how);
	};

	const zoom = (canvas: CanvasLike, delta: number) => {
		const columns = walks.get(canvas)?.columns;
		if (columns) return columns.zoomBy(Math.pow(2, delta / 2));
		canvas.tZoom = Math.min(1, Math.max(-4, canvas.tZoom + delta));
		canvas.zoomCenter = null;
		canvas.markViewportChanged();
	};

	const stop = (canvas: CanvasLike) => {
		const walk = walks.get(canvas);
		if (!walk) return;
		walks.delete(canvas);
		walk.cleanup();
		walk.hints?.remove();
		walk.columns?.destroy();
		canvas.nodes.get(walk.current)?.nodeEl.removeClass("opc-walk-current");
		canvas.setReadonly(walk.wasReadonly);
		const node = canvas.nodes.get(walk.current);
		if (node) canvas.selectOnly(node);
		ctx.events.emit("map-walk-ended", canvas);
	};

	const toggleColumns = (canvas: CanvasLike) => {
		const walk = walks.get(canvas);
		if (!walk) return;
		if (walk.columns) {
			walk.columns.destroy();
			walk.columns = null;
		} else {
			walk.columns = new ColumnView(ctx.app, ctx, canvas, {
				open: (id) => {
					const w = walks.get(canvas);
					if (w && id !== w.current) go(canvas, w, id);
				},
				sibling: (delta) => step(canvas, delta > 0 ? "down" : "up"),
				options: () => options().columns,
				// The walk keeps the board read-only; an edit from the columns is let through.
				save: (id, text) => {
					const node = canvas.nodes.get(id);
					const w = walks.get(canvas);
					if (!node || !w || w.wasReadonly) return false;
					canvas.setReadonly(false);
					try {
						return mutate(ctx, canvas, () => node.setData({ ...node.getData(), text }));
					} finally {
						canvas.setReadonly(true);
					}
				},
			});
		}
		go(canvas, walk, walk.current);
		canvas.wrapperEl.querySelector(".opc-walk-columns")?.toggleClass("is-active", !!walk.columns);
	};

	const start = (canvas: CanvasLike, from?: CanvasNodeLike, inColumns = false) => {
		if (walks.has(canvas)) {
			if (inColumns && !walks.get(canvas)!.columns) toggleColumns(canvas);
			return;
		}
		if (presenting(canvas)) return;
		const { nodes, edges } = model(canvas);
		const picked = from ?? selectedNodes(canvas)[0];
		const flagged = ctx.data.root(canvas).get().presentation?.start;
		const id = picked && nodes.has(picked.id) ? picked.id : flagged && nodes.has(flagged) ? flagged : largestRoot(nodes, edges);
		if (!id) return;

		const wrapper = canvas.wrapperEl;
		const win = wrapper.win;
		const pad = wrapper.createDiv({ cls: "opc-walk-pad", attr: { dir: "ltr" } });
		const button = (cls: string, icon: string, label: string, run: () => void) => {
			const b = pad.createEl("button", { cls: `clickable-icon opc-walk-${cls}`, attr: { "aria-label": label } });
			setIcon(b, icon);
			b.addEventListener("click", (evt) => {
				evt.preventDefault();
				run();
			});
		};
		button("up", "arrow-up", ctx.t("presentation.walk.up"), () => step(canvas, "up"));
		button("left", "arrow-left", ctx.t("presentation.walk.left"), () => step(canvas, "left"));
		button("right", "arrow-right", ctx.t("presentation.walk.right"), () => step(canvas, "right"));
		button("down", "arrow-down", ctx.t("presentation.walk.down"), () => step(canvas, "down"));
		button("zoom-in", "zoom-in", ctx.t("presentation.walk.zoomIn"), () => zoom(canvas, ZOOM_STEP));
		button("zoom-out", "zoom-out", ctx.t("presentation.walk.zoomOut"), () => zoom(canvas, -ZOOM_STEP));
		button("close", "x", ctx.t("presentation.walk.end"), () => stop(canvas));
		button("columns", "columns-3", ctx.t("presentation.walk.columns"), () => toggleColumns(canvas));
		// The pad is not part of the board: no panning or selecting through it.
		pad.addEventListener("pointerdown", (evt) => evt.stopPropagation());
		// On a phone the navigation bar lies over the bottom of the board: the pad sits above it.
		const navbar = wrapper.doc.querySelector<HTMLElement>(".mobile-navbar");
		const lift = navbar && navbar.offsetParent ? wrapper.getBoundingClientRect().bottom - navbar.getBoundingClientRect().top : 0;
		if (lift > 0) pad.setCssProps({ "--opc-pad-lift": `${Math.round(lift)}px` });

		const onKey = (evt: KeyboardEvent) => {
			if (ctx.activeCanvas() !== canvas || evt.ctrlKey || evt.metaKey || evt.altKey) return;
			// Typing in a card edited from the column view.
			const typing = evt.target as HTMLElement | null;
			if (typing?.closest?.("textarea, input, [contenteditable=true]") || walks.get(canvas)?.columns?.isEditing()) return;
			const dir = ARROWS[evt.key];
			const walk = walks.get(canvas);
			if (!walk) return;
			if (dir) step(canvas, dir);
			else if (evt.key === "Escape") stop(canvas);
			else if (evt.key === "Home") go(canvas, walk, walk.start);
			else if (evt.key === "+" || evt.key === "=") zoom(canvas, ZOOM_STEP);
			else if (evt.key === "-") zoom(canvas, -ZOOM_STEP);
			else return;
			evt.preventDefault();
			evt.stopPropagation();
		};
		// Tapping a card walks to it.
		let down: { x: number; y: number; id: number } | null = null;
		const onDown = (evt: PointerEvent) => {
			down = evt.isPrimary ? { x: evt.clientX, y: evt.clientY, id: evt.pointerId } : null;
		};
		const onUp = (evt: PointerEvent) => {
			const d = down;
			down = null;
			const walk = walks.get(canvas);
			if (!walk || !d || d.id !== evt.pointerId || Math.hypot(evt.clientX - d.x, evt.clientY - d.y) > TAP_MOVE) return;
			const target = evt.target as HTMLElement | null;
			if (target?.closest?.(WALK_UI)) return;
			const el = target?.closest?.(".canvas-node");
			if (el) {
				const node = [...canvas.nodes.values()].find((n) => n.nodeEl === el);
				if (node && shown(node) && node.id !== walk.current) go(canvas, walk, node.id);
				return;
			}
			// Empty board: the side of the card it is on stands for that arrow of the pad.
			if (!options().tapZones || (target !== wrapper && !target?.closest?.(".canvas, .canvas-background"))) return;
			const rect = canvas.nodes.get(walk.current)?.nodeEl.getBoundingClientRect();
			const dir = rect ? tapDirection(rect, evt.clientX, evt.clientY) : null;
			if (dir) step(canvas, dir, "tap");
		};
		win.addEventListener("keydown", onKey, true);
		wrapper.addEventListener("pointerdown", onDown, true);
		wrapper.addEventListener("pointerup", onUp, true);
		wrapper.addClass("opc-walking");

		const walk: Walk = {
			file: canvas.view.file?.path ?? "",
			start: id,
			current: id,
			visited: new Map(),
			wasReadonly: canvas.readonly,
			hints: null,
			columns: null,
			cleanup: () => {
				win.removeEventListener("keydown", onKey, true);
				wrapper.removeEventListener("pointerdown", onDown, true);
				wrapper.removeEventListener("pointerup", onUp, true);
				wrapper.removeClass("opc-walking");
				pad.remove();
			},
		};
		walks.set(canvas, walk);
		canvas.deselectAll();
		canvas.setReadonly(true);
		ctx.events.emit("map-walk-started", canvas, canvas.nodes.get(id)!);
		go(canvas, walk, id);
		if (inColumns) toggleColumns(canvas);
	};

	ctx.register(() => {
		for (const canvas of [...walks.keys()]) stop(canvas);
	});
	ctx.onCanvas((canvas) => () => stop(canvas));
	ctx.on("data-load", (canvas) => {
		const walk = walks.get(canvas);
		if (walk && walk.file !== (canvas.view.file?.path ?? "")) stop(canvas);
	});
	ctx.on("canvas-frame", (canvas) => {
		const walk = walks.get(canvas);
		if (walk) sizeHints(canvas, walk);
	});

	/** Settings changed: the column views draw again. */
	const refresh = () => {
		for (const [canvas, walk] of walks) if (walk.columns) drawColumns(canvas, walk);
	};

	return { start, stop, refresh, walking: (canvas: CanvasLike) => walks.has(canvas) };
}
