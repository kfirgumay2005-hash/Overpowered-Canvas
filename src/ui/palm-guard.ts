/**
 * Palm rejection for the pen tools (drawing, highlighter, text color) on tablets, with or
 * without the system's handwriting input (iPadOS Scribble):
 *
 * - Pen contacts are claimed from the system: `touchstart` / `touchmove` of a stylus over the
 *   tool's overlay are `preventDefault`ed, so the system neither turns pen writing into text in a
 *   nearby text field nor scrolls, selects or opens a loupe. Pointer events still arrive.
 * - While a pen is down (and just after), every touch over the overlay is a palm: refused, and
 *   its touch events are `preventDefault`ed too.
 * - Touches let through to the view before the pen came (fingers move the view with palm
 *   navigation) are palms once the pen lands while they are still down: their gesture is
 *   cancelled (a `pointercancel` the view's own handlers see, so a resting palm can't pan, drag a
 *   selection box or open a long-press menu under the pen), their later events are swallowed, and
 *   the view goes back to where it was when the first of them touched.
 * - A very large contact is a palm once a pen has been seen.
 * - Text fields that have the focus lose it when the pen lands (nothing to write into).
 */

/** A pen keeps fingers out for this long after its last event. */
export const PEN_GRACE_MS = 800;
/** A pen pressed but silent this long lost its release (it happens on tablets): it no longer counts. */
const PEN_STALE_MS = 3000;
/** A contact this large (CSS px, either side) is a palm, not a finger (once a pen was seen). */
const PALM_SIZE = 64;
/** A long-press menu opened this soon after a palm's gesture was cancelled is its own: dropped. */
const MENU_GUARD_MS = 400;

export interface ViewState {
	/** The view's position and zoom now. */
	get(): unknown;
	/** Puts the view back. */
	set(state: unknown): void;
}

interface Passed {
	x: number;
	y: number;
	view: unknown;
}

export class PalmGuard {
	/** A pen was used on this surface. */
	penSeen = false;
	private penUntil = 0;
	/** When the pen last sent anything. */
	private penLast = 0;
	private penDown = new Set<number>();
	/** Touches let through to the view (fingers moving it), with the view when they touched. */
	private readonly passed = new Map<number, Passed>();
	/** Touches found to be palms: their events are swallowed until they end. */
	private readonly palms = new Set<number>();
	private menuGuardUntil = 0;
	private readonly win: Window;

	constructor(
		private readonly overlay: HTMLElement,
		private readonly view?: ViewState,
	) {
		this.win = overlay.win;
		overlay.addEventListener("touchstart", this.onTouch, { passive: false });
		overlay.addEventListener("touchmove", this.onTouch, { passive: false });
		this.win.addEventListener("pointermove", this.onWinPointer, true);
		this.win.addEventListener("pointerup", this.onWinPointer, true);
		this.win.addEventListener("pointercancel", this.onWinPointer, true);
		this.win.addEventListener("contextmenu", this.onMenu, true);
	}

	destroy(): void {
		this.overlay.removeEventListener("touchstart", this.onTouch);
		this.overlay.removeEventListener("touchmove", this.onTouch);
		this.win.removeEventListener("pointermove", this.onWinPointer, true);
		this.win.removeEventListener("pointerup", this.onWinPointer, true);
		this.win.removeEventListener("pointercancel", this.onWinPointer, true);
		this.win.removeEventListener("contextmenu", this.onMenu, true);
	}

	/** A pen is in use now (pressed or moving, even hovering). */
	private penActive(): boolean {
		return (this.penDown.size > 0 && Date.now() - this.penLast < PEN_STALE_MS) || Date.now() < this.penUntil;
	}

	/**
	 * Call first in the overlay's pointerdown. Returns true when the press is a palm: it was
	 * refused (default prevented, propagation stopped) and must be ignored.
	 */
	down(evt: PointerEvent): boolean {
		if (evt.pointerType === "pen") {
			this.penSeen = true;
			this.penLast = Date.now();
			this.penUntil = this.penLast + PEN_GRACE_MS;
			this.penDown.add(evt.pointerId);
			this.penLanded();
			blurTextFields(this.overlay.doc);
			return false;
		}
		if (evt.pointerType !== "touch") return false;
		const large = this.penSeen && (evt.width > PALM_SIZE || evt.height > PALM_SIZE);
		if (this.penActive() || large) {
			this.palms.add(evt.pointerId);
			evt.preventDefault();
			evt.stopPropagation();
			return true;
		}
		return false;
	}

	/** Call on the overlay's pointermove (pen hover keeps fingers out too). */
	move(evt: PointerEvent): void {
		if (evt.pointerType !== "pen") return;
		this.penLast = Date.now();
		this.penUntil = this.penLast + PEN_GRACE_MS;
	}

	/** Call on the overlay's pointerup / pointercancel. */
	up(evt: PointerEvent): void {
		if (evt.pointerType === "pen") {
			this.penDown.delete(evt.pointerId);
			this.penUntil = Date.now() + PEN_GRACE_MS;
		}
	}

	/** A touch was let through to the view (it moves the view): remembered until it ends. */
	pass(evt: PointerEvent): void {
		if (evt.pointerType !== "touch") return;
		this.passed.set(evt.pointerId, { x: evt.clientX, y: evt.clientY, view: this.view?.get() });
	}

	/** The pen landed: touches still down are palms. */
	private penLanded(): void {
		if (!this.passed.size) return;
		const resting = [...this.passed];
		this.passed.clear();
		for (const [id] of resting) this.palms.add(id);
		this.menuGuardUntil = Date.now() + MENU_GUARD_MS;
		// The view's own gesture ends (the board's pan, long press, drag selection; another view's
		// drag): a cancel it handles like the system's own.
		for (const [id, p] of resting) {
			const cancel = new PointerEvent("pointercancel", { pointerId: id, pointerType: "touch", isPrimary: true, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true });
			this.overlay.dispatchEvent(cancel);
		}
		// Back to where the view was when the palm came down.
		const first = resting[0]?.[1];
		if (first?.view !== undefined && this.view) this.view.set(first.view);
	}

	private onTouch = (evt: TouchEvent) => {
		const touches = Array.from(evt.changedTouches);
		const stylus = touches.some((t) => (t as Touch & { touchType?: string }).touchType === "stylus");
		if (stylus || (this.penActive() && evt.cancelable)) evt.preventDefault();
	};

	/** Real events of palms go nowhere (our own cancel passes: it is not trusted). */
	private onWinPointer = (evt: PointerEvent) => {
		if (evt.pointerType === "pen" && evt.type !== "pointermove") {
			this.penDown.delete(evt.pointerId);
			return;
		}
		if (!evt.isTrusted) return;
		if (evt.type !== "pointermove") this.passed.delete(evt.pointerId);
		if (!this.palms.has(evt.pointerId)) return;
		if (evt.type !== "pointermove") this.palms.delete(evt.pointerId);
		evt.preventDefault();
		evt.stopImmediatePropagation();
	};

	private onMenu = (evt: MouseEvent) => {
		if (Date.now() > this.menuGuardUntil) return;
		evt.preventDefault();
		evt.stopImmediatePropagation();
	};
}

/** Takes the focus from a text field or editable text (the pen has nothing to write into). */
export function blurTextFields(doc: Document): void {
	const el = doc.activeElement as HTMLElement | null;
	if (!el || el === doc.body) return;
	if (el.isContentEditable || el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !/^(button|checkbox|radio|range|color|submit)$/i.test((el as HTMLInputElement).type))) el.blur();
}
