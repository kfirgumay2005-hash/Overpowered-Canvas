import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { Stroke } from "../../data/schema";
import { lassoed } from "../../geometry/ink";
import type { CanvasItemLike, CanvasLike, CanvasNodeLike, SelectionDragLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { absolutePoints, CARRIER_TEXT, refit } from "../drawing/carriers";
import { capturePointer, claimTool, mutate, releaseTool, nodeType, isHiddenNode, randomId, selectedNodes } from "../shared";
import { caught, type P } from "./select";

interface LassoSettings {
	/** The tool stays on after a selection (until Esc, L or its button). */
	stayOn: boolean;
	/** What a finger does while the lasso is on: "auto" = move the board once a pen has been used. */
	fingers: "auto" | "pan" | "lasso";
	/** A pen (or a finger, for several items) on a selected item moves the selection at once. */
	quickMove: boolean;
}

type Ctx = ModuleContext<LassoSettings>;

/** A pen was used in this window: from then on, fingers move the board ("auto"). */
let penSeen = false;
/** A press that moves farther than this (px) is a drag, not a tap. */
const SLOP = 5;
const DOUBLE_TAP_MS = 350;
/** A pen or finger held still this long on the selection opens its menu. */
const LONG_PRESS_MS = 500;
/** When our long-press last opened a menu (the app's own long-press menu right after is dropped). */
let menuOpenedAt = 0;

/** Opens the menu of the current selection at a screen point, as a right-click on it would. */
export function openSelectionMenu(canvas: CanvasLike, clientX: number, clientY: number): void {
	const evt = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY });
	menuOpenedAt = Date.now();
	const nodes = selectedNodes(canvas);
	if (canvas.selection.size === 1 && nodes.length === 1) nodes[0]!.onContextMenu?.(evt);
	else canvas.onSelectionContextMenu?.(evt);
}

/** True right after our long-press opened a menu: the app's own long-press menu is a duplicate. */
export function menuJustOpened(): boolean {
	return Date.now() - menuOpenedAt < 1000;
}

/**
 * Moves the selection with this pointer, as the core's own drag does (snapping, group contents,
 * one undo step), once it has moved a few pixels. A second finger cancels it.
 */
function moveSelection(canvas: CanvasLike, evt: PointerEvent, clickEl: HTMLElement, node?: CanvasNodeLike): void {
	const win = clickEl.win;
	let drag: SelectionDragLike | undefined;
	// Touch and pen: held still, the press opens the selection menu instead of moving it.
	let timer = evt.pointerType === "mouse" ? 0 : win.setTimeout(() => {
		timer = 0;
		if (drag) return;
		remove();
		openSelectionMenu(canvas, evt.clientX, evt.clientY);
	}, LONG_PRESS_MS);
	const remove = () => {
		if (timer) win.clearTimeout(timer);
		timer = 0;
		win.removeEventListener("pointermove", move, true);
		win.removeEventListener("pointerup", up, true);
		win.removeEventListener("pointercancel", cancel, true);
		win.removeEventListener("pointerdown", other, true);
	};
	const move = (e: PointerEvent) => {
		if (e.pointerId !== evt.pointerId) return;
		if (!drag) {
			if (Math.hypot(e.clientX - evt.clientX, e.clientY - evt.clientY) < SLOP) return;
			if (timer) win.clearTimeout(timer);
			timer = 0;
			drag = canvas.handleSelectionDrag?.(evt, clickEl, node);
			if (!drag) return remove();
		}
		e.preventDefault();
		drag.move?.(e);
	};
	const up = (e: PointerEvent) => {
		if (e.pointerId !== evt.pointerId) return;
		remove();
		drag?.end?.(e);
		drag?.cleanup?.();
	};
	const stop = () => {
		remove();
		drag?.cancel?.();
		drag?.cleanup?.();
	};
	const cancel = (e: PointerEvent) => {
		if (e.pointerId === evt.pointerId) stop();
	};
	const other = (e: PointerEvent) => {
		if (e.pointerId !== evt.pointerId) stop();
	};
	win.addEventListener("pointermove", move, true);
	win.addEventListener("pointerup", up, true);
	win.addEventListener("pointercancel", cancel, true);
	win.addEventListener("pointerdown", other, true);
}

/** Bounding box of the selected items, in canvas units. */
function selectionBox(canvas: CanvasLike): { minX: number; minY: number; maxX: number; maxY: number } | null {
	let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
	for (const item of canvas.selection) {
		const b = item.getBBox();
		box = box ? { minX: Math.min(box.minX, b.minX), minY: Math.min(box.minY, b.minY), maxX: Math.max(box.maxX, b.maxX), maxY: Math.max(box.maxY, b.maxY) } : { ...b };
	}
	return box;
}

function hidden(n: CanvasNodeLike): boolean {
	return n.nodeEl.hasClass("opc-hidden-by-collapse") || n.nodeEl.hasClass("opc-hidden-by-branch") || isHiddenNode(n);
}

/**
 * The lasso on a canvas: draw a free shape; everything inside is selected (cards, groups,
 * edges, ink strokes) and the normal selection actions apply. While the tool stays on, pressing
 * inside the selection moves it, a tap selects the card under it (twice: edits it) and, once a
 * pen has been used, fingers move and zoom the board.
 */
class LassoSession {
	private readonly overlay: HTMLElement;
	private readonly svg: SVGSVGElement;
	private readonly line: SVGPolylineElement;
	private points: P[] = [];
	private screen: P[] = [];
	private pointerId: number | null = null;
	private additive = false;
	private penUntil = 0;
	private lastTap: { at: number; node: CanvasNodeLike | null } = { at: 0, node: null };
	/** When a menu last closed: the app closes menus on Esc before our key handler runs. */
	private menuClosedAt = 0;
	private readonly menus = new MutationObserver((records) => {
		for (const r of records) for (const n of r.removedNodes) if (n.instanceOf(HTMLElement) && n.hasClass("menu")) this.menuClosedAt = Date.now();
	});

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
		this.overlay.addEventListener("contextmenu", this.onContextMenu);
		this.overlay.addEventListener("lostpointercapture", this.onCancel);
		canvas.wrapperEl.win.addEventListener("keydown", this.onKey, true);
		canvas.wrapperEl.addClass("opc-lasso-active");
		this.menus.observe(canvas.wrapperEl.doc.body, { childList: true });
	}

	destroy(): void {
		this.canvas.wrapperEl.win.removeEventListener("keydown", this.onKey, true);
		this.menus.disconnect();
		this.overlay.remove();
		this.canvas.wrapperEl.removeClass("opc-lasso-active");
	}

	/** Right-click or the app's long-press on the selection: its menu (elsewhere: the board's menu). */
	private onContextMenu = (e: MouseEvent) => {
		const box = this.canvas.selection.size ? selectionBox(this.canvas) : null;
		if (!box) return;
		const p = this.canvas.posFromEvt(e);
		if (p.x < box.minX || p.x > box.maxX || p.y < box.minY || p.y > box.maxY) return;
		e.preventDefault();
		e.stopPropagation();
		if (!menuJustOpened()) openSelectionMenu(this.canvas, e.clientX, e.clientY);
	};

	private onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		// An open menu closes first (the app may have closed it already, a moment ago).
		if (e.defaultPrevented || this.canvas.wrapperEl.doc.querySelector(".menu") || Date.now() - this.menuClosedAt < 100) return;
		e.preventDefault();
		e.stopPropagation();
		this.onEnd();
	};

	private local(e: PointerEvent): P {
		const r = this.overlay.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	}

	private fingersMoveBoard(): boolean {
		const f = this.ctx.settings.fingers;
		return f === "pan" || (f === "auto" && penSeen);
	}

	private onDown = (e: PointerEvent) => {
		if (e.pointerType === "pen") {
			penSeen = true;
			this.penUntil = Date.now() + 800;
		}
		if (e.pointerType === "touch") {
			// A palm resting while the pen writes.
			if (Date.now() < this.penUntil) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			// The event reaches the canvas, which pans and zooms.
			if (this.fingersMoveBoard()) return;
		}
		if (e.pointerType === "mouse" && e.button !== 0) return; // right/middle: core panning
		// A pen or mouse can't press twice: the last gesture lost its release (it happens on
		// tablets), so it is dropped instead of blocking the lasso.
		if (this.pointerId !== null && e.pointerType !== "touch") this.reset();
		if (this.pointerId !== null) return;
		e.preventDefault();
		e.stopPropagation();
		const p = this.canvas.posFromEvt(e);
		const box = this.canvas.selection.size && !e.shiftKey ? selectionBox(this.canvas) : null;
		if (box && !this.canvas.readonly && p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY) {
			moveSelection(this.canvas, e, this.overlay);
			return;
		}
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
		if (this.isTap()) return this.tap(e);
		this.select();
		if (this.ctx.settings.stayOn) {
			this.points = [];
			this.screen = [];
			this.draw();
		} else this.onEnd();
	};

	private isTap(): boolean {
		const first = this.screen[0];
		return !!first && this.screen.every((p) => Math.hypot(p.x - first.x, p.y - first.y) < SLOP);
	}

	/** A tap selects the card under it (Shift adds it), a second tap edits it; on empty space, clears. */
	private tap(e: PointerEvent): void {
		const canvas = this.canvas;
		this.points = [];
		this.screen = [];
		this.draw();
		const node = this.nodeAt(canvas.posFromEvt(e));
		const now = Date.now();
		const twice = !!node && this.lastTap.node === node && now - this.lastTap.at < DOUBLE_TAP_MS;
		this.lastTap = { at: now, node };
		if (node && twice && !canvas.readonly && nodeType(node) !== "group") {
			this.onEnd();
			canvas.selectOnly(node);
			node.startEditing();
			return;
		}
		if (!node) {
			if (!e.shiftKey) canvas.deselectAll();
		} else if (e.shiftKey) {
			if (canvas.selection.has(node)) canvas.deselect(node);
			else canvas.select(node);
		} else canvas.selectOnly(node);
		if (!this.ctx.settings.stayOn) this.onEnd();
	}

	/** The topmost visible card at a canvas point (cards win over groups). */
	private nodeAt(p: P): CanvasNodeLike | null {
		let best: CanvasNodeLike | null = null;
		for (const n of this.canvas.nodes.values()) {
			if (hidden(n) || n.id.includes("~")) continue;
			if (p.x < n.x || p.x > n.x + n.width || p.y < n.y || p.y > n.y + n.height) continue;
			const group = nodeType(n) === "group";
			const bestGroup = !!best && nodeType(best) === "group";
			if (!best || (bestGroup && !group) || (group === bestGroup && n.zIndex >= best.zIndex)) best = n;
		}
		return best;
	}

	private onCancel = (e: PointerEvent) => {
		if (e.pointerId === this.pointerId) this.reset();
	};

	private reset(): void {
		this.pointerId = null;
		this.points = [];
		this.screen = [];
		this.draw();
	}

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
					const anchor = ctx.data.node(carrier).get().anchor;
					carrier.moveAndResize(keep.box);
					ctx.data.node(carrier).set({ strokes: keep.strokes });
					const created = canvas.importData({ nodes: [{ id: randomId(), type: "text", text: CARRIER_TEXT, ...moved.box, "x-opc": { kind: "ink", strokes: moved.strokes, ...(anchor ? { anchor } : {}) } }], edges: [] }, false);
					for (const n of created ?? []) items.add(n);
				}
			});
		if (items.size) canvas.selectAll(items);
		else canvas.deselectAll();
		ctx.events.emit("lasso-selected", canvas, [...items]);
	}
}

/** Lasso selection for the whole canvas (not only in drawing mode): button, command and L. */
export const lassoModule = defineModule<LassoSettings>({
	id: "lasso",
	name: "lasso.name",
	description: "lasso.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: { stayOn: true, fingers: "auto", quickMove: true },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			stayOn: typeof s.stayOn === "boolean" ? s.stayOn : defaults.stayOn,
			fingers: s.fingers === "auto" || s.fingers === "pan" || s.fingers === "lasso" ? s.fingers : defaults.fingers,
			quickMove: typeof s.quickMove === "boolean" ? s.quickMove : defaults.quickMove,
		};
	},
	overlapsWith: ["canvas-kit"],

	enable(ctx) {
		const sessions = new Map<CanvasLike, LassoSession>();
		const stop = (canvas: CanvasLike) => {
			releaseTool(canvas, "lasso");
			sessions.get(canvas)?.destroy();
			sessions.delete(canvas);
			refresh(canvas);
		};
		const toggle = (canvas: CanvasLike) => {
			if (sessions.has(canvas)) return stop(canvas);
			// Drawing mode or the highlighter ends first.
			claimTool(canvas, "lasso", () => stop(canvas));
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

		// Quick move: a pen on a selected item, or a finger on an item of a multi-selection, moves
		// the selection right away (the core waits for a long press on touch screens).
		ctx.onCanvas((canvas) => {
			const wrapper = canvas.wrapperEl;
			const onDown = (e: PointerEvent) => {
				if (e.pointerType === "pen") penSeen = true;
				if (!ctx.settings.quickMove || (e.pointerType !== "pen" && e.pointerType !== "touch") || !e.isPrimary) return;
				if (canvas.readonly || sessions.has(canvas) || wrapper.hasClass("opc-drawing") || canvas.selection.size === 0) return;
				if (e.pointerType === "touch" && canvas.selection.size < 2) return;
				const target = e.target as HTMLElement | null;
				if (!target || target.closest(".canvas-menu-container, .canvas-card-menu, .canvas-controls, .canvas-node-resizer, .canvas-node-connection-point")) return;
				const onFrame = target === canvas.menu.selection?.selectionEl;
				const node = onFrame ? undefined : selectedNodes(canvas).find((n) => n.nodeEl.contains(target));
				if ((!onFrame && !node) || node?.isEditing) return;
				e.preventDefault();
				e.stopPropagation();
				moveSelection(canvas, e, node?.nodeEl ?? wrapper, node);
			};
			// Our long-press already opened the menu: the app's own long-press menu would cover it.
			const onMenu = (e: MouseEvent) => {
				if (!menuJustOpened()) return;
				e.preventDefault();
				e.stopPropagation();
			};
			wrapper.addEventListener("pointerdown", onDown, true);
			wrapper.addEventListener("contextmenu", onMenu, true);
			return () => {
				wrapper.removeEventListener("pointerdown", onDown, true);
				wrapper.removeEventListener("contextmenu", onMenu, true);
			};
		});
	},

	renderSettings(el, ctx: ModuleContext<LassoSettings>) {
		new Setting(el)
			.setName(ctx.t("lasso.stayOn.name"))
			.setDesc(ctx.t("lasso.stayOn.desc"))
			.addToggle((t) => t.setValue(ctx.settings.stayOn).onChange((v) => ctx.updateSettings({ stayOn: v })));
		new Setting(el)
			.setName(ctx.t("lasso.fingers.name"))
			.setDesc(ctx.t("lasso.fingers.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ auto: ctx.t("lasso.fingers.auto"), pan: ctx.t("lasso.fingers.pan"), lasso: ctx.t("lasso.fingers.lasso") })
					.setValue(ctx.settings.fingers)
					.onChange((v) => ctx.updateSettings({ fingers: v as LassoSettings["fingers"] })),
			);
		new Setting(el)
			.setName(ctx.t("lasso.quickMove.name"))
			.setDesc(ctx.t("lasso.quickMove.desc"))
			.addToggle((t) => t.setValue(ctx.settings.quickMove).onChange((v) => ctx.updateSettings({ quickMove: v })));
	},
});
