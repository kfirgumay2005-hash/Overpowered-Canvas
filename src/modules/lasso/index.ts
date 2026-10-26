import { defineModule, type ModuleContext } from "../../core/module";
import type { Stroke } from "../../data/schema";
import { lassoed } from "../../geometry/ink";
import type { CanvasItemLike, CanvasLike, CanvasNodeLike } from "../../internals/types";
import { absolutePoints, CARRIER_TEXT, refit } from "../drawing/carriers";
import { capturePointer, mutate, nodeType, onHiddenLayer, randomId } from "../shared";
import { caught, type P } from "./select";

type Ctx = ModuleContext<Record<string, never>>;

function hidden(n: CanvasNodeLike): boolean {
	return n.nodeEl.hasClass("opc-hidden-by-collapse") || n.nodeEl.hasClass("opc-hidden-by-branch") || onHiddenLayer(n);
}

/**
 * One lasso on a canvas: draw a free shape; everything inside is selected (cards, groups,
 * edges, ink strokes), then the tool ends and the normal selection actions apply.
 */
class LassoSession {
	private readonly overlay: HTMLElement;
	private readonly svg: SVGSVGElement;
	private readonly line: SVGPolylineElement;
	private points: P[] = [];
	private screen: P[] = [];
	private pointerId: number | null = null;
	private additive = false;

	constructor(
		private readonly ctx: Ctx,
		private readonly canvas: CanvasLike,
		private readonly onEnd: () => void,
	) {
		this.overlay = canvas.wrapperEl.createDiv({ cls: "opc-lasso-overlay" });
		this.svg = this.overlay.createSvg("svg", { cls: "opc-lasso-svg" });
		this.line = this.svg.createSvg("polyline", { cls: "opc-lasso-line" });
		this.overlay.addEventListener("pointerdown", this.onDown);
		this.overlay.addEventListener("pointermove", this.onMove);
		this.overlay.addEventListener("pointerup", this.onUp);
		this.overlay.addEventListener("pointercancel", this.onCancel);
		canvas.wrapperEl.win.addEventListener("keydown", this.onKey, true);
		canvas.wrapperEl.addClass("opc-lasso-active");
	}

	destroy(): void {
		this.canvas.wrapperEl.win.removeEventListener("keydown", this.onKey, true);
		this.overlay.remove();
		this.canvas.wrapperEl.removeClass("opc-lasso-active");
	}

	private onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.preventDefault();
		e.stopPropagation();
		this.onEnd();
	};

	private local(e: PointerEvent): P {
		const r = this.overlay.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	private onDown = (e: PointerEvent) => {
		if (e.pointerType === "mouse" && e.button !== 0) return; // right/middle: core panning
		if (this.pointerId !== null) return;
		e.preventDefault();
		e.stopPropagation();
		capturePointer(this.overlay, e.pointerId);
		this.pointerId = e.pointerId;
		this.additive = e.shiftKey;
		this.points = [this.canvas.posFromEvt(e)];
		this.screen = [this.local(e)];
		this.draw();
	};

	private onMove = (e: PointerEvent) => {
		if (e.pointerId !== this.pointerId) return;
		e.preventDefault();
		const events = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
		for (const ev of events.length ? events : [e]) {
			this.points.push(this.canvas.posFromEvt(ev));
			this.screen.push(this.local(ev));
		}
		this.draw();
	};

	private onUp = (e: PointerEvent) => {
		if (e.pointerId !== this.pointerId) return;
		this.pointerId = null;
		this.select();
		this.onEnd();
	};

	private onCancel = (e: PointerEvent) => {
		if (e.pointerId !== this.pointerId) return;
		this.pointerId = null;
		this.points = [];
		this.screen = [];
		this.draw();
	};

	private draw(): void {
		this.line.setAttribute("points", this.screen.map((p) => `${p.x},${p.y}`).join(" "));
	}

	private select(): void {
		const lasso = this.points;
		if (lasso.length < 3) return;
		const canvas = this.canvas;
		const ctx = this.ctx;
		const visible = [...canvas.nodes.values()].filter((n) => !hidden(n) && !n.id.includes("~"));
		const isInk = (n: CanvasNodeLike) => nodeType(n) === "text" && ctx.data.node(n).get().kind === "ink";
		const cards = visible.filter((n) => !isInk(n));
		const edges = [...canvas.edges.values()].map((e) => ({ id: e.id, from: e.from.node.id, fromSide: e.from.side, to: e.to.node.id, toSide: e.to.side }));
		const hit = caught(
			lasso,
			cards.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, group: nodeType(n) === "group" })),
			edges,
		);
		const items = new Set<CanvasItemLike>(this.additive ? canvas.selection : []);
		for (const id of hit.nodes) items.add(canvas.nodes.get(id)!);
		for (const id of hit.edges) {
			const e = canvas.edges.get(id);
			if (e) items.add(e);
		}

		// Ink: a carrier is selected when all its strokes are inside; strokes caught in a carrier
		// that also has strokes outside move to a carrier of their own first (one undo step).
		const splits: { carrier: CanvasNodeLike; inside: Stroke[]; outside: Stroke[] }[] = [];
		for (const carrier of visible.filter(isInk)) {
			const strokes = ctx.data.node(carrier).get().strokes ?? [];
			const inside = strokes.filter((s) => lassoed(absolutePoints(s, carrier), lasso));
			if (!inside.length) continue;
			if (inside.length === strokes.length) items.add(carrier);
			else splits.push({ carrier, inside, outside: strokes.filter((s) => !inside.includes(s)) });
		}
		if (splits.length && !canvas.readonly)
			mutate(ctx, canvas, () => {
				for (const { carrier, inside, outside } of splits) {
					const origin = { x: carrier.x, y: carrier.y };
					const keep = refit(outside, origin);
					const moved = refit(inside, origin);
					if (!keep || !moved) continue;
					carrier.moveAndResize(keep.box);
					ctx.data.node(carrier).set({ strokes: keep.strokes });
					const created = canvas.importData({ nodes: [{ id: randomId(), type: "text", text: CARRIER_TEXT, ...moved.box, "x-opc": { kind: "ink", strokes: moved.strokes } }], edges: [] }, false);
					for (const n of created ?? []) items.add(n);
				}
			});
		if (items.size) canvas.selectAll(items);
		else canvas.deselectAll();
		ctx.events.emit("lasso-selected", canvas, [...items]);
	}
}

/** Lasso selection for the whole canvas (not only in drawing mode): button, command and L. */
export const lassoModule = defineModule({
	id: "lasso",
	name: "lasso.name",
	description: "lasso.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["canvas-kit"],

	enable(ctx) {
		const sessions = new Map<CanvasLike, LassoSession>();
		const stop = (canvas: CanvasLike) => {
			sessions.get(canvas)?.destroy();
			sessions.delete(canvas);
			refresh(canvas);
		};
		const toggle = (canvas: CanvasLike) => {
			if (sessions.has(canvas)) return stop(canvas);
			// Drawing mode has its own lasso for strokes; leave it first.
			if (canvas.wrapperEl.hasClass("opc-drawing")) return;
			sessions.set(canvas, new LassoSession(ctx, canvas, () => stop(canvas)));
			refresh(canvas);
		};
		const refresh = (canvas: CanvasLike) => {
			canvas.cardMenuEl.querySelector(".opc-card-lasso")?.toggleClass("is-active", sessions.has(canvas));
		};
		ctx.register(() => {
			for (const c of [...sessions.keys()]) stop(c);
		});
		ctx.onCanvas((canvas) => () => stop(canvas));

		ctx.addCardMenuButton({
			id: "lasso",
			icon: "lasso-select",
			tooltip: () => ctx.t("lasso.button"),
			order: 5,
			onClick: (canvas) => toggle(canvas),
		});
		ctx.addCommand({
			id: "lasso",
			name: ctx.t("lasso.button"),
			icon: "lasso-select",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas) return false;
				if (!checking) toggle(canvas);
				return true;
			},
		});
		ctx.addCanvasKey({ modifiers: [], key: "L", handle: (canvas) => (toggle(canvas), true) });
	},
});
