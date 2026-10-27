import { setIcon } from "obsidian";
import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { parentOf, type Dir, type TEdge, type TNode } from "../mindmap/tree";
import { centerOn, nodeType, onHiddenLayer, selectedNodes } from "../shared";
import { largestRoot, walkStep } from "./walk";

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

function shown(node: CanvasNodeLike): boolean {
	const el = node.nodeEl;
	return nodeType(node) !== "group" && !el.hasClass("opc-hidden-by-collapse") && !el.hasClass("opc-hidden-by-branch") && !onHiddenLayer(node);
}

/**
 * Walking through a map without slides: the arrow keys (or the on-screen arrows) move along the
 * map's links at the current zoom. Read-only while walking; Esc ends it.
 */
export function enableWalk(ctx: ModuleContext<object>, presenting: (canvas: CanvasLike) => boolean) {
	const walks = new Map<CanvasLike, Walk>();

	const model = (canvas: CanvasLike) => {
		const nodes = new Map<string, TNode>();
		for (const n of canvas.nodes.values()) if (shown(n)) nodes.set(n.id, { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height });
		const edges: TEdge[] = [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id })).filter((e) => nodes.has(e.from) && nodes.has(e.to));
		return { nodes, edges };
	};

	const go = (canvas: CanvasLike, walk: Walk, id: string) => {
		const node = canvas.nodes.get(id);
		if (!node) return;
		canvas.nodes.get(walk.current)?.nodeEl.removeClass("opc-walk-current");
		walk.current = id;
		node.nodeEl.addClass("opc-walk-current");
		const parent = parentOf(model(canvas).edges, id);
		if (parent) walk.visited.set(parent, id);
		centerOn(canvas, node);
		ctx.events.emit("map-walk-moved", canvas, node);
	};

	const step = (canvas: CanvasLike, dir: Dir) => {
		const walk = walks.get(canvas);
		if (!walk) return;
		const { nodes, edges } = model(canvas);
		const next = walkStep(nodes, edges, walk.current, dir, walk.visited);
		if (next) go(canvas, walk, next);
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
