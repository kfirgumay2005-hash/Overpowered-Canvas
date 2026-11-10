/**
 * Ink that sticks to a card: a carrier whose x-opc.anchor names the card its strokes were drawn
 * on. It moves with that card (dragging, auto layout, re-linking), is copied, cut and duplicated
 * with it, is deleted with it and is drawn just above it. Moving the ink off its card frees it.
 */
import type { ModuleContext } from "../../core/module";
import type { Stroke } from "../../data/schema";
import type { CanvasItemLike, CanvasLike, CanvasNodeLike } from "../../internals/types";
import { isTextBox, nodeType, isHiddenNode, renderedZ } from "../shared";
import { stretchStrokes, type Box } from "./carriers";
import { remapRefs } from "./stick";
import type { DrawingSettings } from "./toolbar";

type Ctx = ModuleContext<DrawingSettings>;

/** A resize of a drawing card ends after this pause. */
const STRETCH_PAUSE_MS = 500;

export function isInk(ctx: Ctx, n: CanvasNodeLike): boolean {
	return nodeType(n) === "text" && ctx.data.node(n).get().kind === "ink";
}

/** Cards a stroke can stick to, topmost first. */
export function stickyTargets(ctx: Ctx, canvas: CanvasLike): CanvasNodeLike[] {
	return [...canvas.nodes.values()]
		.filter((n) => nodeType(n) !== "group" && !n.id.includes("~") && !isHiddenNode(n) && (isTextBox(ctx, n) || nodeType(n) === "link"))
		.sort((a, b) => renderedZ(b) - renderedZ(a));
}

export function anchorOf(ctx: Ctx, n: CanvasNodeLike): string | undefined {
	return isInk(ctx, n) ? ctx.data.node(n).get().anchor : undefined;
}

/** Wires anchored ink into a canvas session of the drawing module. */
export function enableAnchors(ctx: Ctx): void {
	/** Card → the carriers stuck to it. */
	const byCard = new Map<string, Set<CanvasNodeLike>>();
	/** Where each card with ink was last seen, to move its ink by as much. */
	const lastPos = new WeakMap<CanvasNodeLike, Box>();
	/** Carriers being moved by us. */
	const moving = new Set<CanvasNodeLike>();

	const index = (carrier: CanvasNodeLike, anchor: string | undefined) => {
		for (const [card, set] of byCard) if (card !== anchor && set.delete(carrier) && set.size === 0) byCard.delete(card);
		if (!anchor) return;
		let set = byCard.get(anchor);
		if (!set) byCard.set(anchor, (set = new Set()));
		set.add(carrier);
		const card = carrier.canvas.nodes.get(anchor);
		if (card && !lastPos.has(card)) lastPos.set(card, { x: card.x, y: card.y, width: card.width, height: card.height });
	};
	const carriersOf = (card: CanvasNodeLike) => [...(byCard.get(card.id) ?? [])].filter((c) => c.canvas === card.canvas && c.canvas.nodes.get(c.id) === c);

	ctx.decorateNodes({
		apply: (node, extra) => {
			if (extra.kind === "ink" && nodeType(node) === "text") index(node, extra.anchor);
			else index(node, undefined);
			restack(node);
		},
		clear: (node) => index(node, undefined),
	});

	// ---- Following the card -----------------------------------------------------------------

	ctx.on("node-moved", (moved) => {
		const canvas = moved.canvas;
		const anchor = anchorOf(ctx, moved);
		if (anchor !== undefined) {
			if (moving.has(moved)) return;
			// The ink was moved by itself (not with its card): off the card, it comes loose.
			const card = canvas.nodes.get(anchor);
			if (card && canvas.selection.has(card)) return;
			const cx = moved.x + moved.width / 2;
			const cy = moved.y + moved.height / 2;
			if (!card || cx < card.x || cx > card.x + card.width || cy < card.y || cy > card.y + card.height) {
				ctx.data.node(moved).set({ anchor: undefined }, { history: false });
			}
			return;
		}
		const carriers = byCard.has(moved.id) ? carriersOf(moved) : [];
		const was = lastPos.get(moved);
		lastPos.set(moved, { x: moved.x, y: moved.y, width: moved.width, height: moved.height });
		if (!carriers.length || !was) return;
		// A card made for a drawing, resized: the drawing stretches with it.
		if ((Math.abs(moved.width - was.width) > 0.01 || Math.abs(moved.height - was.height) > 0.01) && ctx.data.node(moved).get().drawingCard) return stretch(moved, carriers, was);
		const dx = moved.x - was.x;
		const dy = moved.y - was.y;
		if (!dx && !dy) return;
		for (const c of carriers) {
			moving.add(c);
			try {
				c.moveTo({ x: c.x + dx, y: c.y + dy });
			} finally {
				moving.delete(c);
			}
		}
	});

	/**
	 * Stretches the ink of a drawing card from the box it had when the resize began: every step
	 * of a live resize starts from the same strokes, so rounding never adds up. A pause ends the
	 * resize (the next one starts from the strokes as they are then).
	 */
	const stretching = new Map<CanvasNodeLike, { from: Box; strokes: Map<CanvasNodeLike, { origin: { x: number; y: number }; strokes: Stroke[] }>; timer: number }>();
	const stretch = (card: CanvasNodeLike, carriers: CanvasNodeLike[], was: Box) => {
		const win = card.canvas.wrapperEl.win;
		let run = stretching.get(card);
		if (!run) stretching.set(card, (run = { from: was, strokes: new Map(), timer: 0 }));
		win.clearTimeout(run.timer);
		run.timer = win.setTimeout(() => stretching.delete(card), STRETCH_PAUSE_MS);
		const to = { x: card.x, y: card.y, width: card.width, height: card.height };
		for (const c of carriers) {
			let base = run.strokes.get(c);
			if (!base) run.strokes.set(c, (base = { origin: { x: c.x, y: c.y }, strokes: ctx.data.node(c).get().strokes ?? [] }));
			const fit = stretchStrokes(base.strokes, base.origin, run.from, to);
			if (!fit) continue;
			moving.add(c);
			try {
				c.moveAndResize(fit.box);
				ctx.data.node(c).set({ strokes: fit.strokes }, { history: false });
			} finally {
				moving.delete(c);
			}
		}
	};

	// A deleted card takes its ink along (the same undo step: the core saves a moment later).
	ctx.on("node-removed", (removed) => {
		if (!byCard.has(removed.id)) return;
		const canvas = removed.canvas;
		const carriers = [...(byCard.get(removed.id) ?? [])];
		queueMicrotask(() => {
			if (canvas.nodes.has(removed.id) || canvas.readonly) return;
			let changed = false;
			for (const c of carriers)
				if (canvas.nodes.get(c.id) === c && anchorOf(ctx, c) === removed.id) {
					canvas.removeNode(c);
					changed = true;
				}
			if (changed) canvas.requestSave();
		});
	});

	// ---- Drawn just above the card -------------------------------------------------------------

	const patchedProtos = new WeakSet<object>();
	const restack = (node: CanvasNodeLike) => {
		for (let proto = Object.getPrototypeOf(node) as object | null; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
			if (!Object.prototype.hasOwnProperty.call(proto, "renderZIndex") || patchedProtos.has(proto)) continue;
			patchedProtos.add(proto);
			ctx.patch("node.renderZIndex", proto as CanvasNodeLike, {
				renderZIndex: (next) =>
					function (this: CanvasNodeLike) {
						next.call(this);
						const anchor = anchorOf(ctx, this);
						if (anchor) {
							const card = this.canvas.nodes.get(anchor);
							if (card) {
								const z = renderedZ(card) + 1;
								if (renderedZ(this) < z) this.nodeEl.style.zIndex = String(z);
							}
						} else if (byCard.has(this.id)) for (const c of carriersOf(this)) c.renderZIndex();
					},
			});
		}
		if (anchorOf(ctx, node)) node.renderZIndex();
	};

	// ---- Copy, cut, duplicate and paste ------------------------------------------------------

	const patchedCanvas = new WeakSet<object>();
	ctx.onCanvas((canvas) => {
		const proto = Object.getPrototypeOf(canvas) as CanvasLike;
		if (patchedCanvas.has(proto)) return;
		patchedCanvas.add(proto);
		ctx.patch("canvas.getSelectionData", proto, {
			// Copying a card copies the ink stuck to it.
			getSelectionData: (next) =>
				function (this: CanvasLike, selection?: Set<CanvasItemLike>) {
					const items = selection ?? this.selection;
					const extra = [...items].flatMap((i) => ("nodeEl" in i && byCard.has(i.id) ? carriersOf(i) : [])).filter((c) => !items.has(c));
					return next.call(this, extra.length ? new Set([...items, ...extra]) : selection);
				},
		});
		ctx.patch("canvas.cloneData", proto, {
			// Pasted ink sticks to the pasted card, pasted lines to the pasted cards they joined.
			cloneData: (next) =>
				function (this: CanvasLike, data: Parameters<CanvasLike["cloneData"]>[0], offset: Parameters<CanvasLike["cloneData"]>[1]) {
					const before = data.nodes.map((n) => n.id);
					const out = next.call(this, data, offset);
					const nodes = out.nodes ?? [];
					remapRefs(nodes, new Map(before.map((id, i) => [id, nodes[i]?.id ?? id])));
					return out;
				},
		});
	});
}
