/**
 * Page-navigation controls (the pages bar of boards, notes with pages and text pages: index
 * button, crumbs, previous / next, whole note): one mechanism for all of them, the same on a board
 * and in a note, by mouse, keyboard, finger and pen.
 *
 * Presses are not listened to on the buttons. One set of listeners per window, in the capture
 * phase of the window (before anything on the page sees the event), finds the control a press is
 * for and runs it:
 * - by the element pressed (`closest(".opc-nav-control")`), or, when something else lies on top
 *   of the control (a transparent layer of the app, a theme or another plugin), by position: the
 *   control whose box holds the point, unless a menu, dialog, drawer or popover is on top of it;
 * - at release, looked up again by position, so a control drawn again in between (the bar is
 *   redrawn when the note changes) still answers;
 * - its action is read when it runs, so it acts on the page shown at that moment.
 * A touch or pen press runs on release over the control and makes no mouse events and no click
 * (its late click would land on whatever the press opened, such as the drawer's backdrop); any
 * click still made right after is swallowed. The press never reaches the pane below (no panning,
 * no editor focus change, no keyboard closing on a tablet).
 *
 * Debug mode reports every press, what received it and whether it ran.
 */
import { debugNotice, debugText, describeElement } from "../core/debug";
import { logError } from "../core/log";

const CONTROL = "opc-nav-control";
/**
 * Layers that really cover a control: a press there is theirs. Notices are not among them: they
 * show at the top corner, over the bar's buttons (debug mode shows one for every press), and a
 * press on a control under one is meant for the control.
 */
const COVERING = ".modal-container, .menu, .popover, .prompt, .suggestion-container, .workspace-drawer, .workspace-drawer-backdrop";
/** How far a finger may drift off the control before release (px). */
const SLOP = 10;
/** How long after a touch press its late click is swallowed (ms). */
const CLICK_AFTER = 700;

const actions = new WeakMap<HTMLElement, () => void>();
const windows = new Map<Window, () => void>();

/** Makes `el` a page-navigation control that runs `run` when pressed. */
export function navControl(el: HTMLElement, run: () => void): void {
	el.addClass(CONTROL);
	actions.set(el, run);
	install(el.ownerDocument.defaultView ?? window);
}

/** Removes the listeners from every window (plugin unload). */
export function removeNavControls(): void {
	for (const remove of windows.values()) remove();
	windows.clear();
}

function labelOf(el: HTMLElement): string {
	return el.getAttr("aria-label") || el.textContent?.trim() || describeElement(el);
}

function isElement(target: EventTarget | null): target is Element {
	return !!target && typeof (target as Element).closest === "function";
}

interface Hit {
	el: HTMLElement;
	/** What received the event when it is not the control itself. */
	cover: Element | null;
}

interface Press {
	el: HTMLElement;
	pointer: number | null;
	touch: number | null;
	ran: boolean;
}

function install(win: Window): void {
	if (windows.has(win)) return;
	const doc = win.document;
	let press: Press | null = null;
	let touchRanAt = 0;

	const find = (target: EventTarget | null, x?: number, y?: number): Hit | null => {
		const direct = isElement(target) ? target.closest<HTMLElement>(`.${CONTROL}`) : null;
		if (direct && actions.has(direct)) return { el: direct, cover: null };
		if (x === undefined || y === undefined || (x === 0 && y === 0)) return null;
		const top = doc.elementFromPoint(x, y);
		for (const el of Array.from(doc.querySelectorAll<HTMLElement>(`.${CONTROL}`))) {
			if (!actions.has(el)) continue;
			const r = el.getBoundingClientRect();
			if (r.width === 0 || r.height === 0 || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
			const covering = top?.closest(COVERING);
			if (covering && !covering.contains(el)) return null;
			return { el, cover: top ?? (isElement(target) ? target : null) };
		}
		return null;
	};

	const near = (el: HTMLElement, x: number, y: number) => {
		const r = el.getBoundingClientRect();
		return x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP;
	};

	const run = (hit: Hit, how: "touch" | "click") => {
		const label = labelOf(hit.el);
		const received = hit.cover ? debugText("debug.nav.cover", { element: describeElement(hit.cover) }) : debugText("debug.nav.direct");
		if ((hit.el as HTMLButtonElement).disabled || hit.el.hasClass("is-disabled")) {
			debugNotice("debug.nav.off", { control: label, received });
			return;
		}
		debugNotice(how === "touch" ? "debug.nav.tapped" : "debug.nav.clicked", { control: label, received });
		try {
			actions.get(hit.el)?.();
		} catch (error) {
			logError("[overpowered-canvas] page navigation failed", error);
			debugNotice("debug.nav.failed", { control: label, error: String(error) });
		}
	};

	/** The press ends at (x, y): run it if it ends on its control (or the same control drawn again). */
	const release = (x: number, y: number, target: EventTarget | null) => {
		const p = press;
		press = null;
		if (!p || p.ran) return;
		p.ran = true;
		let hit: Hit | null = p.el.isConnected && near(p.el, x, y) ? { el: p.el, cover: null } : find(target, x, y);
		// Drawn again during the press: the new control at the same place, with the same label.
		if (hit && hit.el !== p.el && (p.el.isConnected || labelOf(hit.el) !== labelOf(p.el))) hit = null;
		if (!hit) {
			debugNotice("debug.nav.left", { control: labelOf(p.el) });
			return;
		}
		touchRanAt = Date.now();
		swallowClick();
		run(hit, "touch");
	};

	const swallowClick = () => {
		const stop = (evt: Event) => {
			evt.preventDefault();
			evt.stopImmediatePropagation();
			done();
		};
		const done = () => {
			win.removeEventListener("click", stop, true);
			win.clearTimeout(timer);
		};
		win.addEventListener("click", stop, true);
		const timer = win.setTimeout(done, CLICK_AFTER);
	};

	const onPointerDown = (evt: PointerEvent) => {
		const hit = find(evt.target, evt.clientX, evt.clientY);
		if (!hit) return;
		// Nothing below sees a press meant for the control (the board, the editor, the app's gestures).
		evt.stopPropagation();
		if (evt.pointerType === "mouse") {
			// The editor keeps its focus; the click runs the control.
			if (evt.button === 0) evt.preventDefault();
			return;
		}
		if (press && press.touch !== null && press.el === hit.el) press.pointer = evt.pointerId;
		else press = { el: hit.el, pointer: evt.pointerId, touch: null, ran: false };
	};
	const onPointerUp = (evt: PointerEvent) => {
		if (evt.pointerType === "mouse" || !press || press.pointer !== evt.pointerId) return;
		evt.stopPropagation();
		release(evt.clientX, evt.clientY, evt.target);
	};
	const onPointerCancel = (evt: PointerEvent) => {
		// Touch events may still finish the press (below); otherwise it is dropped there.
		if (press && press.pointer === evt.pointerId) press.pointer = null;
	};
	const onTouchStart = (evt: TouchEvent) => {
		const t = evt.changedTouches[0];
		if (!t || evt.touches.length !== 1) return;
		const hit = find(evt.target, t.clientX, t.clientY);
		if (!hit) return;
		evt.stopPropagation();
		// No mouse events, no click, no scrolling and no focus change come from this touch.
		if (evt.cancelable) evt.preventDefault();
		if (press && !press.ran && press.el === hit.el) press.touch = t.identifier;
		else press = { el: hit.el, pointer: null, touch: t.identifier, ran: false };
	};
	const onTouchEnd = (evt: TouchEvent) => {
		if (!press || press.touch === null) return;
		const t = Array.from(evt.changedTouches).find((c) => c.identifier === press!.touch);
		if (!t) return;
		evt.stopPropagation();
		if (evt.type === "touchcancel") {
			press = null;
			return;
		}
		if (evt.cancelable) evt.preventDefault();
		release(t.clientX, t.clientY, evt.target);
	};
	const onMouseDown = (evt: MouseEvent) => {
		if (!find(evt.target, evt.clientX, evt.clientY)) return;
		evt.stopPropagation();
		if (evt.button === 0) evt.preventDefault();
	};
	const onClick = (evt: MouseEvent) => {
		const hit = find(evt.target, evt.clientX, evt.clientY);
		if (!hit) return;
		evt.preventDefault();
		evt.stopPropagation();
		// The click a touch press makes after its release: already done.
		if (Date.now() - touchRanAt < CLICK_AFTER) return;
		run(hit, "click");
	};

	const opts = { capture: true, passive: false } as const;
	win.addEventListener("pointerdown", onPointerDown, true);
	win.addEventListener("pointerup", onPointerUp, true);
	win.addEventListener("pointercancel", onPointerCancel, true);
	win.addEventListener("touchstart", onTouchStart, opts);
	win.addEventListener("touchend", onTouchEnd, opts);
	win.addEventListener("touchcancel", onTouchEnd, opts);
	win.addEventListener("mousedown", onMouseDown, true);
	win.addEventListener("click", onClick, true);
	windows.set(win, () => {
		win.removeEventListener("pointerdown", onPointerDown, true);
		win.removeEventListener("pointerup", onPointerUp, true);
		win.removeEventListener("pointercancel", onPointerCancel, true);
		win.removeEventListener("touchstart", onTouchStart, opts);
		win.removeEventListener("touchend", onTouchEnd, opts);
		win.removeEventListener("touchcancel", onTouchEnd, opts);
		win.removeEventListener("mousedown", onMouseDown, true);
		win.removeEventListener("click", onClick, true);
	});
}
