import { Notice, setIcon, type EventRef } from "obsidian";
import type { ModuleContext } from "../../core/module";
import { logError } from "../../core/log";
import type { EdgeSide } from "../../data/json-canvas";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { relayoutMap } from "../auto-layout/arrange";
import { inkHost } from "../drawing/api";
import { growthOf, makeSiblingRoom } from "../mindmap/room";
import { recordChild, storedOrder } from "../mindmap/order-store";
import { childPosition, childrenOf, directionBetween, type Dir, type TNode } from "../mindmap/tree";
import { pagesHost } from "../pages/api";
import { canvasDirection, centerOn, mutate, nodeType, randomId, selectedNodes } from "../shared";
import { marksHost, type MarkMode } from "../text-highlight/api";
import { ColumnView, type ColumnOptions, type ColumnTool } from "./columns";
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
	/** The way down to the current card, as the column view last showed it. */
	path: string[];
	/** The tool used in the column view, if any. */
	tool: ColumnTool | null;
	/** Changes on the board waiting to be shown in the column view. */
	pending: { ink: boolean; all: boolean; timer: number };
	/** The card just added from the column view, and the undo step before it. */
	fresh: { id: string; step: number; back: string } | null;
	cleanup: () => void;
}

const WALK_KEYS = ["walk.up", "walk.down", "walk.left", "walk.right", "walk.end", "walk.start", "walk.zoomIn", "walk.zoomOut"] as const;
const COLUMN_KEYS = ["columns.child", "columns.sibling", "columns.edit"] as const;
const SIDE: Record<Dir, EdgeSide> = { right: "right", left: "left", down: "bottom", up: "top" };
const OPPOSITE: Record<Dir, EdgeSide> = { right: "left", left: "right", down: "top", up: "bottom" };
/** A press that moved less than this is a tap (jump to that card). */
const TAP_MOVE = 6;
const ZOOM_STEP = 0.5;
/** Board changes are shown in the column view this long after the last one. */
const REFRESH_MS = 80;
/** Ink alone is drawn again sooner: the pen's stroke waits for it (no blink after pen-up). */
const INK_REFRESH_MS = 16;
/** Room around a card added inside a group. */
const GROUP_PAD = 20;
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
 * map's links at the current zoom. Read-only on the board; Esc ends it. The column view shows the
 * map as columns, one page at a time, and lets cards be added, edited, marked and drawn on.
 */
/** Top to bottom columns: down goes to the children, up to the parent, left and right along the siblings. */
const DOWNWARD: Record<Dir, Dir> = { up: "left", down: "right", left: "up", right: "down" };

export function enableWalk(ctx: ModuleContext<object>, presenting: (canvas: CanvasLike) => boolean, options: () => WalkOptions, flipColumns: () => void) {
	const walks = new Map<CanvasLike, Walk>();

	const pageOf = (node: CanvasNodeLike | undefined) => (node && pagesHost.api ? pagesHost.api.pageOf(node) : "");
	/** The page the column view shows: the current card's. */
	const columnPage = (canvas: CanvasLike, walk: Walk) => pageOf(canvas.nodes.get(walk.current));

	/**
	 * The map as a walk sees it: cards and groups joined by their edges, with groups read as cards
	 * (see groupEdges). With `page`, only that page's cards (the column view, which shows a page
	 * at a time and follows the links to the others); without it, every page, a card whose branch
	 * was moved to a page leading to that page.
	 */
	const model = (canvas: CanvasLike, page?: string) => {
		const nodes = new Map<string, TNode>();
		const boxes: WalkBox[] = [];
		const api = pagesHost.api;
		for (const n of canvas.nodes.values()) {
			// Ink, drawn lines and infinite lines are marks on the board, not stops.
			if (!shown(n) || DRAWINGS.has(ctx.data.node(n).get().kind ?? "")) continue;
			const on = api ? api.pageOf(n) : "";
			if (page !== undefined && api && on !== page) continue;
			const box = { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height };
			nodes.set(n.id, box);
			boxes.push({ ...box, group: nodeType(n) === "group", page: on });
		}
		const edges: WalkEdge[] = [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id })).filter((e) => nodes.has(e.from) && nodes.has(e.to));
		const pageLinks: WalkEdge[] = [];
		if (page === undefined) for (const link of api?.links(canvas) ?? []) if (nodes.has(link.anchor) && nodes.has(link.root)) pageLinks.push({ from: link.anchor, to: link.root });
		// A page lies in a region of its own: where it is says nothing about the card it hangs from.
		return { nodes, edges: [...groupEdges(boxes, edges), ...pageLinks], order: storedOrder(ctx, canvas) };
	};
	const modelFor = (canvas: CanvasLike, walk: Walk) => model(canvas, walk.columns ? columnPage(canvas, walk) : undefined);

	const nextFrom = (canvas: CanvasLike, walk: Walk, dir: Dir) => {
		const { nodes, edges, order } = modelFor(canvas, walk);
		const rtl = canvasDirection(canvas) === "rtl";
		// The column view shows the hierarchy, so its arrows always follow it.
		const byTree = options().keys === "tree" || !!walk.columns;
		return { edges, next: byTree ? treeStep(nodes, edges, walk.current, dir, walk.visited, rtl, order) : walkStep(nodes, edges, walk.current, dir, walk.visited) };
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

	/** What the column view shows for the current card. `keep`: same zoom and scroll (a refresh). */
	const drawColumns = (canvas: CanvasLike, walk: Walk, keep = false) => {
		if (!walk.columns) return;
		const { nodes, edges, order } = modelFor(canvas, walk);
		const rtl = canvasDirection(canvas) === "rtl";
		const path = pathTo(nodes, edges, walk.current, walk.visited);
		walk.path = path;
		const ids = (list: { id: string }[]) => list.map((n) => n.id);
		const columns = path.map((id, i) => ({ ids: i === 0 ? [id] : ids(orderedChildren(nodes, edges, path[i - 1]!, rtl, order)), active: id }));
		const children = ids(orderedChildren(nodes, edges, walk.current, rtl, order));
		if (children.length) columns.push({ ids: children, active: "" });
		walk.columns.show(columns, walk.current, path, keep);
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
		// The keys and the pad's arrows go the way the levels run on screen.
		if (walk.columns && options().columns.vertical) dir = DOWNWARD[dir];
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

	// ---------- the column view's tools ----------

	/** Ends the tool used in the column view (if any). */
	const endTool = (canvas: CanvasLike, walk: Walk) => {
		const tool = walk.tool;
		walk.tool = null;
		if (tool === "ink") inkHost.api?.stop(canvas);
		else if (tool) marksHost.api?.stop(canvas);
	};

	/** The tools the column view offers here: drawing, the highlighter and the text color tool. */
	const tools = (walk: Walk): ColumnTool[] => {
		if (walk.wasReadonly) return [];
		const out: ColumnTool[] = [];
		if (inkHost.api) out.push("ink");
		if (marksHost.api) out.push("highlight", "color");
		return out;
	};

	const useTool = (canvas: CanvasLike, tool: ColumnTool) => {
		const walk = walks.get(canvas);
		const view = walk?.columns;
		if (!walk || !view) return;
		const was = walk.tool;
		endTool(canvas, walk);
		if (was === tool) return;
		walk.tool = tool;
		const ended = () => {
			const w = walks.get(canvas);
			if (!w || w.tool !== tool) return;
			w.tool = null;
			w.columns?.setTool(null);
		};
		if (tool === "ink") {
			// Handwriting lands where it shows only on cards at their size on the board.
			view.setTool("ink");
			inkHost.api?.start(canvas, view.inkSurface(), ended);
		} else {
			view.setTool(tool);
			marksHost.api?.start(canvas, tool satisfies MarkMode, view.markSurface(), ended);
		}
		// A tool that could not start (a read-only board): nothing is on.
		if (tool === "ink" ? !inkHost.api?.active(canvas) : !marksHost.api?.active(canvas)) ended();
	};

	// ---------- adding cards from the column view ----------

	/**
	 * A new card under `parent` (after `after` among its children, else last), placed on the
	 * board as a mind map places it: beside the parent and its other children, making room among
	 * them, linked by an arrow; inside a group when the parent is a group. One undo step.
	 */
	const createCard = (canvas: CanvasLike, parent: CanvasNodeLike, held: TNode[], after: CanvasNodeLike | null): CanvasNodeLike | null => {
		const size = canvas.config.defaultTextNodeDimensions;
		let created: CanvasNodeLike | null = null;
		const ok = mutate(ctx, canvas, () => {
			if (nodeType(parent) === "group") {
				// What the group holds reads top to bottom: the new card goes below `after` (the
				// cards under it move down) or below the last one.
				const below = after && held.some((h) => h.id === after.id) ? after : null;
				const lowest = held.reduce<TNode | null>((low, h) => (!low || h.y + h.height > low.y + low.height ? h : low), null);
				const anchor = below ?? lowest;
				const pos = anchor ? { x: anchor.x, y: anchor.y + anchor.height + GROUP_PAD } : { x: parent.x + GROUP_PAD, y: parent.y + GROUP_PAD * 2 };
				if (below) {
					for (const h of held) {
						const n = canvas.nodes.get(h.id);
						if (n && n !== below && n.y >= below.y + below.height) n.moveTo({ x: n.x, y: n.y + size.height + GROUP_PAD });
					}
				}
				created = canvas.createTextNode({ pos, size, save: false, focus: false });
				// The group grows around everything it holds.
				const inside = [created, ...held.map((h) => canvas.nodes.get(h.id)).filter((n): n is CanvasNodeLike => !!n)];
				const right = Math.max(parent.x + parent.width, ...inside.map((n) => n.x + n.width + GROUP_PAD));
				const bottom = Math.max(parent.y + parent.height, ...inside.map((n) => n.y + n.height + GROUP_PAD));
				if (right > parent.x + parent.width || bottom > parent.y + parent.height) parent.moveAndResize({ x: parent.x, y: parent.y, width: right - parent.x, height: bottom - parent.y });
				return;
			}
			const linked = after && [...canvas.edges.values()].some((e) => e.from.node === parent && e.to.node === after);
			let dir: Dir;
			let pos: { x: number; y: number };
			if (after && linked) {
				dir = directionBetween(parent, after);
				pos = makeSiblingRoom(canvas, parent, after, size);
			} else {
				dir = growthOf(canvas, parent);
				const kids = childrenOf(
					[...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id })),
					parent.id,
				)
					.map((id) => canvas.nodes.get(id))
					.filter((n): n is CanvasNodeLike => !!n);
				pos = childPosition(parent, kids, size, dir);
			}
			created = canvas.createTextNode({ pos, size, save: false, focus: false });
			const color = parent.color;
			canvas.importData({ nodes: [], edges: [{ id: randomId(), fromNode: parent.id, fromSide: SIDE[dir], toNode: created.id, toSide: OPPOSITE[dir], ...(color ? { color } : {}) }] }, false);
			recordChild(ctx, canvas, parent, created, after && linked ? after.id : undefined);
		});
		if (!ok || !created) return null;
		const card: CanvasNodeLike = created;
		// A map with a recorded layout arranges itself again, as after a card dropped into it.
		if (nodeType(parent) !== "group") void relayoutMap(ctx, canvas, card, after?.id).catch((e) => logError("[overpowered-canvas] columns: layout", e));
		return card;
	};

	/** Adds a child of the current card, or a sibling right after it, and edits it. */
	const addCard = (canvas: CanvasLike, kind: "child" | "sibling") => {
		const walk = walks.get(canvas);
		if (!walk?.columns || walk.wasReadonly || canvas.readonly) return;
		const node = canvas.nodes.get(walk.current);
		if (!node) return;
		const { nodes, edges } = modelFor(canvas, walk);
		const path = pathTo(nodes, edges, walk.current, walk.visited);
		const parentId = kind === "child" ? walk.current : path[path.length - 2];
		const parent = parentId ? canvas.nodes.get(parentId) : undefined;
		if (!parent) {
			new Notice(ctx.t("presentation.columns.noParent"));
			return;
		}
		endTool(canvas, walk);
		const held = edges.filter((e) => e.from === parent.id && e.inside).map((e) => nodes.get(e.to)).filter((n): n is TNode => !!n);
		const step = canvas.history.current;
		const card = createCard(canvas, parent, held, kind === "sibling" ? node : null);
		if (!card) return;
		walk.fresh = { id: card.id, step, back: node.id };
		walk.visited.set(parent.id, card.id);
		go(canvas, walk, card.id);
		walk.columns.edit(card.id, true);
		ctx.events.emit("column-card-added", canvas, card, kind);
	};

	/**
	 * A card added from the column view and left empty is taken away again, as if it had never
	 * been added: its step is undone (the cards moved to make room go back) and can't be redone.
	 */
	const discard = (canvas: CanvasLike, id: string) => {
		const walk = walks.get(canvas);
		const node = canvas.nodes.get(id);
		if (!walk || !node) return;
		const fresh = walk.fresh?.id === id ? walk.fresh : null;
		// Back to the card it was added from.
		const back = fresh?.back ?? walk.path[walk.path.length - 2];
		walk.fresh = null;
		const history = canvas.history;
		if (fresh && history.current === fresh.step + 1) {
			canvas.undo();
			history.data.length = history.current + 1;
		} else mutate(ctx, canvas, () => canvas.removeNode(node));
		if (back && canvas.nodes.has(back)) go(canvas, walk, back);
	};

	/**
	 * A card resized in the column view: the board card takes the size (its top-left corner stays,
	 * so ink on it keeps its place), one undo step; a map with a recorded layout arranges itself
	 * again around the new size.
	 */
	const resizeCard = (canvas: CanvasLike, id: string, size: { width: number; height: number }): boolean => {
		const node = canvas.nodes.get(id);
		const walk = walks.get(canvas);
		if (!node || !walk || walk.wasReadonly || canvas.readonly) return false;
		const ok = mutate(ctx, canvas, () => node.moveAndResize({ x: node.x, y: node.y, width: size.width, height: size.height }));
		if (ok) {
			ctx.events.emit("column-card-resized", canvas, node);
			void relayoutMap(ctx, canvas, node).catch((e) => logError("[overpowered-canvas] columns: layout", e));
		}
		return ok;
	};

	// ---------- following the board ----------

	/** Shows the board's changes in the column view (debounced; never while a card is edited). */
	const schedule = (canvas: CanvasLike, ink: boolean) => {
		const walk = walks.get(canvas);
		if (!walk?.columns) return;
		if (ink) walk.pending.ink = true;
		else walk.pending.all = true;
		canvas.wrapperEl.win.clearTimeout(walk.pending.timer);
		walk.pending.timer = canvas.wrapperEl.win.setTimeout(() => flush(canvas), walk.pending.all ? REFRESH_MS : INK_REFRESH_MS);
	};
	const flush = (canvas: CanvasLike) => {
		const walk = walks.get(canvas);
		const view = walk?.columns;
		if (!walk || !view) return;
		if (view.isEditing()) {
			walk.pending.timer = canvas.wrapperEl.win.setTimeout(() => flush(canvas), REFRESH_MS * 4);
			return;
		}
		const { ink, all } = walk.pending;
		walk.pending = { ink: false, all: false, timer: 0 };
		if (!canvas.nodes.has(walk.current)) {
			// The current card is gone (deleted, undone): back to the nearest card still there.
			const back = [...walk.path].reverse().find((id) => canvas.nodes.has(id)) ?? walk.start;
			if (canvas.nodes.has(back)) go(canvas, walk, back);
			else stop(canvas);
			return;
		}
		if (all) drawColumns(canvas, walk, true);
		else if (ink) view.refreshInk();
	};
	const isInk = (node: CanvasNodeLike) => ctx.data.node(node).get().kind === "ink";
	ctx.on("node-set-data", (node) => schedule(node.canvas, isInk(node)));
	ctx.on("node-extra-change", (node) => schedule(node.canvas, isInk(node)));
	ctx.on("node-added", (node) => schedule(node.canvas, isInk(node)));
	ctx.on("node-removed", (node) => schedule(node.canvas, isInk(node)));
	ctx.on("node-moved", (node) => schedule(node.canvas, isInk(node)));
	ctx.on("edge-added", (edge) => schedule(edge.canvas, false));
	ctx.on("edge-removed", (edge) => schedule(edge.canvas, false));
	ctx.on("history-apply", (canvas) => schedule(canvas, false));
	// The board selects nothing behind the column view (keys like Delete would act on it).
	ctx.on("selection-change", (canvas) => {
		if (walks.get(canvas)?.columns && canvas.selection.size) queueMicrotask(() => canvas.deselectAll());
	});
	// Another page shown on the board (the pages index or bar): the column view goes there.
	const workspace = ctx.app.workspace as unknown as { on(name: string, cb: (canvas: CanvasLike, page: string) => void): EventRef };
	ctx.registerEvent(
		workspace.on("overpowered-canvas:page-shown", (canvas, page) => {
			const walk = walks.get(canvas);
			if (!walk?.columns || columnPage(canvas, walk) === page) return;
			const { nodes, edges } = model(canvas, page);
			const root = largestRoot(nodes, edges);
			if (root) go(canvas, walk, root);
		}),
	);

	const stop = (canvas: CanvasLike) => {
		const walk = walks.get(canvas);
		if (!walk) return;
		walks.delete(canvas);
		endTool(canvas, walk);
		canvas.wrapperEl.win.clearTimeout(walk.pending.timer);
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
			endTool(canvas, walk);
			walk.columns.destroy();
			walk.columns = null;
			// Walking on the board is for reading.
			canvas.setReadonly(true);
		} else {
			// The column view edits (text, new cards, marks, ink): the board takes changes again,
			// unless it was read-only before the walk.
			canvas.setReadonly(walk.wasReadonly);
			canvas.deselectAll();
			walk.columns = new ColumnView(ctx.app, ctx, canvas, {
				open: (id) => {
					const w = walks.get(canvas);
					if (w && id !== w.current) go(canvas, w, id);
				},
				sibling: (delta) => step(canvas, delta > 0 ? "down" : "up"),
				options: () => options().columns,
				save: (id, text) => {
					const node = canvas.nodes.get(id);
					const w = walks.get(canvas);
					if (!node || !w || w.wasReadonly) return false;
					return mutate(ctx, canvas, () => node.setData({ ...node.getData(), text }));
				},
				editable: () => !walks.get(canvas)?.wasReadonly,
				add: (kind) => addCard(canvas, kind),
				discard: (id) => discard(canvas, id),
				tools: () => {
					const w = walks.get(canvas);
					return w ? tools(w) : [];
				},
				useTool: (tool) => useTool(canvas, tool),
				resize: (id, size) => resizeCard(canvas, id, size),
				flip: flipColumns,
			});
		}
		go(canvas, walk, walk.current);
		canvas.wrapperEl.querySelector(".opc-walk-columns")?.toggleClass("is-active", !!walk.columns);
		canvas.wrapperEl.toggleClass("opc-walk-in-columns", !!walk.columns);
	};

	const start = (canvas: CanvasLike, from?: CanvasNodeLike, inColumns = false) => {
		if (walks.has(canvas)) {
			if (inColumns && !walks.get(canvas)!.columns) toggleColumns(canvas);
			return;
		}
		if (presenting(canvas)) return;
		// The column view starts on the page shown.
		const { nodes, edges } = model(canvas, inColumns && pagesHost.api ? pagesHost.api.current(canvas) : undefined);
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
		// (Set on the board, so the column view's tools sit above it too.)
		if (lift > 0) wrapper.setCssProps({ "--opc-pad-lift": `${Math.round(lift)}px` });

		const onKey = (evt: KeyboardEvent) => {
			if (ctx.activeCanvas() !== canvas) return;
			// Typing in a card edited from the column view.
			const typing = evt.target as HTMLElement | null;
			if (typing?.closest?.("textarea, input, [contenteditable=true]") || walks.get(canvas)?.columns?.isEditing()) return;
			const walk = walks.get(canvas);
			if (!walk) return;
			// Keys from the Shortcuts window. The column view's own keys first (they take Tab and Enter).
			const inColumns = !!walk.columns;
			const action = (inColumns ? ctx.shortcutOf(evt, COLUMN_KEYS) : null) ?? ctx.shortcutOf(evt, WALK_KEYS);
			// The end key with a tool of the column view on ends the tool (it handles it), not the walk.
			if (walk.tool && action === "walk.end") return;
			if (action === "walk.up" || action === "walk.down" || action === "walk.left" || action === "walk.right") step(canvas, action.slice(5) as Dir);
			else if (action === "walk.end") stop(canvas);
			else if (action === "walk.start") go(canvas, walk, walk.start);
			else if (action === "walk.zoomIn") zoom(canvas, ZOOM_STEP);
			else if (action === "walk.zoomOut") zoom(canvas, -ZOOM_STEP);
			else if (action === "columns.child") addCard(canvas, "child");
			else if (action === "columns.sibling") addCard(canvas, "sibling");
			else if (action === "columns.edit") walk.columns?.edit(walk.current);
			else return;
			evt.preventDefault();
			evt.stopPropagation();
		};
		// Nothing pasted onto the board from behind the column view.
		const onPaste = (evt: ClipboardEvent) => {
			const walk = walks.get(canvas);
			if (!walk?.columns || ctx.activeCanvas() !== canvas) return;
			if ((evt.target as HTMLElement | null)?.closest?.("textarea, input, [contenteditable=true]")) return;
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
		win.addEventListener("paste", onPaste, true);
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
			path: [id],
			tool: null,
			pending: { ink: false, all: false, timer: 0 },
			fresh: null,
			cleanup: () => {
				win.removeEventListener("keydown", onKey, true);
				win.removeEventListener("paste", onPaste, true);
				wrapper.removeEventListener("pointerdown", onDown, true);
				wrapper.removeEventListener("pointerup", onUp, true);
				wrapper.removeClass("opc-walking");
				wrapper.removeClass("opc-walk-in-columns");
				wrapper.setCssProps({ "--opc-pad-lift": "" });
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
		for (const [canvas, walk] of walks) if (walk.columns) drawColumns(canvas, walk, true);
	};

	return { start, stop, refresh, walking: (canvas: CanvasLike) => walks.has(canvas) };
}
