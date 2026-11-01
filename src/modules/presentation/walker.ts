import { setIcon } from "obsidian";
import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { type Dir, type TEdge, type TNode } from "../mindmap/tree";
import { pagesHost } from "../pages/api";
import { canvasDirection, centerOn, nodeType, selectedNodes } from "../shared";
import { ColumnView } from "./columns";
import { childrenOnLeft, largestRoot, orderedChildren, pathTo, tapDirection, treeStep, walkStep } from "./walk";

/** What the arrow keys follow: the map's hierarchy, or where the cards sit. */
export type WalkKeys = "tree" | "layout";

export interface WalkOptions {
	keys: WalkKeys;
	/** A tap on the empty board around the card acts as an arrow key. */
	tapZones: boolean;
	/** Small arrows around the card, where a step is possible. */
	hints: boolean;
}

interface Walk {
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
const LABELS = { up: "presentation.walk.up", down: "presentation.walk.down", left: "presentation.walk.left", right: "presentation.walk.right" } as const;

/** Cards (and groups) a walk can stop on. Cards on other pages count: a walk can go there. */
function shown(node: CanvasNodeLike): boolean {
	const el = node.nodeEl;
	return !node.id.includes("~") && !el.hasClass("opc-hidden-by-collapse") && !el.hasClass("opc-hidden-by-branch") && !el.hasClass("opc-layer-hidden");
}

function inside(outer: TNode, inner: TNode): boolean {
	return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/**
 * Walking through a map without slides: the arrow keys (or the on-screen arrows) move along the
 * map's links at the current zoom. Read-only while walking; Esc ends it.
 */
export function enableWalk(ctx: ModuleContext<object>, presenting: (canvas: CanvasLike) => boolean, options: () => WalkOptions) {
	const walks = new Map<CanvasLike, Walk>();

	/**
	 * The map as a walk sees it: cards and groups joined by their edges. A group without edges
	 * of its own leads into the cards inside it that have no parent, and a card whose branch was
	 * moved to a page leads to that page.
	 */
	const model = (canvas: CanvasLike) => {
		const nodes = new Map<string, TNode>();
		const groups: TNode[] = [];
		for (const n of canvas.nodes.values()) {
			if (!shown(n)) continue;
			const box = { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
			nodes.set(n.id, box);
			if (nodeType(n) === "group") groups.push(box);
		}
		const edges: TEdge[] = [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id })).filter((e) => nodes.has(e.from) && nodes.has(e.to));
		const hasParent = new Set(edges.map((e) => e.to));
		const hasChildren = new Set(edges.map((e) => e.from));
		const page = pagesHost.api;
		const pageOf = (id: string) => {
			const n = canvas.nodes.get(id);
			return page && n ? page.pageOf(n) : "";
		};
		// Smallest group around each node, so nested groups lead into each other.
		const byArea = [...groups].sort((a, b) => a.width * a.height - b.width * b.height);
		const virtual: TEdge[] = [];
		const pageLinks: TEdge[] = [];
		for (const n of nodes.values()) {
			if (hasParent.has(n.id)) continue;
			const g = byArea.find((g) => g.id !== n.id && inside(g, n) && g.width * g.height > n.width * n.height && pageOf(g.id) === pageOf(n.id));
			if (g && !hasChildren.has(g.id)) virtual.push({ from: g.id, to: n.id });
		}
		for (const link of page?.links(canvas) ?? []) if (nodes.has(link.anchor) && nodes.has(link.root)) pageLinks.push({ from: link.anchor, to: link.root });
		// A page lies in a region of its own: where it is says nothing about the card it hangs from.
		return { nodes, onPage: [...edges, ...virtual], edges: [...edges, ...virtual, ...pageLinks] };
	};

	const nextFrom = (canvas: CanvasLike, walk: Walk, dir: Dir) => {
		const { nodes, edges } = model(canvas);
		const rtl = canvasDirection(canvas) === "rtl";
		// The column view shows the hierarchy, so its arrows always follow it.
		const byTree = options().keys === "tree" || !!walk.columns;
		return { edges, next: byTree ? treeStep(nodes, edges, walk.current, dir, walk.visited, rtl) : walkStep(nodes, edges, walk.current, dir, walk.visited) };
	};

	/** The step a tap on side `dir` of the screen stands for: toward the children leads to them. */
	const onScreen = (canvas: CanvasLike, walk: Walk, dir: Dir): Dir => {
		if (options().keys !== "tree" || (dir !== "left" && dir !== "right")) return dir;
		const { nodes, onPage } = model(canvas);
		if (!childrenOnLeft(nodes, onPage, walk.current, walk.visited, canvasDirection(canvas) === "rtl")) return dir;
		return dir === "left" ? "right" : "left";
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
		for (const dir of DIRS) {
			const move = onScreen(canvas, walk, dir);
			if (!nextFrom(canvas, walk, move).next) continue;
			const hint = hints.createEl("button", { cls: `clickable-icon opc-walk-hint opc-walk-hint-${dir}`, attr: { "aria-label": ctx.t(labelOf(move)) } });
			setIcon(hint, `arrow-${dir}`);
			hint.addEventListener("pointerdown", (evt) => evt.stopPropagation());
			hint.addEventListener("click", (evt) => {
				evt.preventDefault();
				evt.stopPropagation();
				step(canvas, move, "tap");
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
			walk.columns = new ColumnView(ctx.app, canvas, {
				open: (id) => {
					const w = walks.get(canvas);
					if (w && id !== w.current) go(canvas, w, id);
				},
				sibling: (delta) => step(canvas, delta > 0 ? "down" : "up"),
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

		const onKey = (evt: KeyboardEvent) => {
			if (ctx.activeCanvas() !== canvas || evt.ctrlKey || evt.metaKey || evt.altKey) return;
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
			// Empty board: the side of the card it is on stands for that arrow key.
			if (!options().tapZones || (target !== wrapper && !target?.closest?.(".canvas, .canvas-background"))) return;
			const rect = canvas.nodes.get(walk.current)?.nodeEl.getBoundingClientRect();
			const dir = rect ? tapDirection(rect, evt.clientX, evt.clientY) : null;
			if (dir) step(canvas, onScreen(canvas, walk, dir), "tap");
		};
		win.addEventListener("keydown", onKey, true);
		wrapper.addEventListener("pointerdown", onDown, true);
		wrapper.addEventListener("pointerup", onUp, true);
		wrapper.addClass("opc-walking");

		const walk: Walk = {
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
	ctx.on("canvas-frame", (canvas) => {
		const walk = walks.get(canvas);
		if (walk) sizeHints(canvas, walk);
	});

	return { start, stop, walking: (canvas: CanvasLike) => walks.has(canvas) };
}
