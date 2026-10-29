import { setIcon } from "obsidian";
import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { type Dir, type TEdge, type TNode } from "../mindmap/tree";
import { pagesHost } from "../pages/api";
import { canvasDirection, centerOn, nodeType, selectedNodes } from "../shared";
import { largestRoot, treeStep, walkStep } from "./walk";

/** What the arrow keys follow: the map's hierarchy, or where the cards sit. */
export type WalkKeys = "tree" | "layout";

interface Walk {
	start: string;
	current: string;
	/** Per parent: the child last visited under it. */
	visited: Map<string, string>;
	wasReadonly: boolean;
	cleanup: () => void;
}

const ARROWS: Record<string, Dir> = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" };
/** A press that moved less than this is a tap (jump to that card). */
const TAP_MOVE = 6;
const ZOOM_STEP = 0.5;

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
export function enableWalk(ctx: ModuleContext<object>, presenting: (canvas: CanvasLike) => boolean, keys: () => WalkKeys) {
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
		for (const n of nodes.values()) {
			if (hasParent.has(n.id)) continue;
			const g = byArea.find((g) => g.id !== n.id && inside(g, n) && g.width * g.height > n.width * n.height && pageOf(g.id) === pageOf(n.id));
			if (g && !hasChildren.has(g.id)) virtual.push({ from: g.id, to: n.id });
		}
		for (const link of page?.links(canvas) ?? []) if (nodes.has(link.anchor) && nodes.has(link.root)) virtual.push({ from: link.anchor, to: link.root });
		return { nodes, edges: [...edges, ...virtual] };
	};

	const go = (canvas: CanvasLike, walk: Walk, id: string, from?: string) => {
		const node = canvas.nodes.get(id);
		if (!node) return;
		canvas.nodes.get(walk.current)?.nodeEl.removeClass("opc-walk-current");
		if (from && from !== id) walk.visited.set(from, id);
		walk.current = id;
		// A card on another page: show that page first.
		pagesHost.api?.reveal(canvas, node);
		node.nodeEl.addClass("opc-walk-current");
		centerOn(canvas, node);
		ctx.events.emit("map-walk-moved", canvas, node);
	};

	const step = (canvas: CanvasLike, dir: Dir) => {
		const walk = walks.get(canvas);
		if (!walk) return;
		const { nodes, edges } = model(canvas);
		const next = keys() === "tree" ? treeStep(nodes, edges, walk.current, dir, walk.visited, canvasDirection(canvas) === "rtl") : walkStep(nodes, edges, walk.current, dir, walk.visited);
		if (!next) return;
		// Each parent remembers the child visited last (going down, or along the siblings), so
		// going back up and down again returns there.
		const down = edges.some((e) => e.from === walk.current && e.to === next);
		const sharedParent = edges.find((e) => e.to === next && edges.some((f) => f.from === e.from && f.to === walk.current))?.from;
		go(canvas, walk, next, down ? walk.current : sharedParent);
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
		canvas.nodes.get(walk.current)?.nodeEl.removeClass("opc-walk-current");
		canvas.setReadonly(walk.wasReadonly);
		const node = canvas.nodes.get(walk.current);
		if (node) canvas.selectOnly(node);
		ctx.events.emit("map-walk-ended", canvas);
	};

	const start = (canvas: CanvasLike, from?: CanvasNodeLike) => {
		if (walks.has(canvas) || presenting(canvas)) return;
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
			const el = (evt.target as HTMLElement | null)?.closest?.(".canvas-node");
			const node = el ? [...canvas.nodes.values()].find((n) => n.nodeEl === el) : undefined;
			if (node && shown(node) && node.id !== walk.current) go(canvas, walk, node.id);
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
	};

	ctx.register(() => {
		for (const canvas of [...walks.keys()]) stop(canvas);
	});
	ctx.onCanvas((canvas) => () => stop(canvas));

	return { start, stop, walking: (canvas: CanvasLike) => walks.has(canvas) };
}
