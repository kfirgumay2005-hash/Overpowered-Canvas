/**
 * A button that works the same by mouse, keyboard, finger and pen.
 *
 * A tap normally reaches a button as a `click` the browser makes up after the touch ends, at
 * whatever is under the finger at that moment. That goes wrong in two ways on tablets:
 * - the click can go missing (the editor and the app's own touch gestures on the pane take the
 *   touch, the keyboard closing moves the page under the finger);
 * - when the press itself puts something under the finger (the pages index opening in the side
 *   drawer, with its backdrop), the late click lands on that and undoes it (a click on the
 *   drawer's backdrop closes the drawer).
 * So a touch or pen press runs the action once, when it is released over the button (on
 * `pointerup`, or `touchend` where pointer events don't come), and the click it would make is
 * cancelled: `touchend` is default-prevented (no mouse events and no click follow) and any click
 * still made right after is swallowed before it reaches anything. Mouse and keyboard keep the
 * plain click.
 */
const SLOP = 8;
/** How long after a touch press its late click is swallowed (ms). */
const CLICK_AFTER = 700;

/** Swallows the next click in this window (made up by a touch already handled). */
function swallowNextClick(win: Window): void {
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
}

export function onPress(el: HTMLElement, run: (evt: Event) => void): void {
	/** The touch or pen press under way (pointer id), and whether it already ran. */
	let pointer: number | null = null;
	let touch: number | null = null;
	let ran = false;
	let ranAt = 0;
	const win = () => el.ownerDocument.defaultView ?? window;
	const over = (x: number, y: number) => {
		const r = el.getBoundingClientRect();
		return x >= r.left - SLOP && x <= r.right + SLOP && y >= r.top - SLOP && y <= r.bottom + SLOP;
	};
	const fire = (evt: Event) => {
		if (ran) return;
		ran = true;
		if ((el as HTMLButtonElement).disabled) return;
		ranAt = Date.now();
		swallowNextClick(win());
		run(evt);
	};

	el.addEventListener("pointerdown", (evt) => {
		if (evt.pointerType === "mouse") return;
		pointer = evt.pointerId;
		ran = false;
		// The pane's own gestures never see a press meant for this button.
		evt.stopPropagation();
	});
	el.addEventListener("pointercancel", (evt) => {
		if (evt.pointerId === pointer) pointer = null;
	});
	el.addEventListener("pointerup", (evt) => {
		if (evt.pointerType === "mouse" || pointer !== evt.pointerId) return;
		pointer = null;
		if (over(evt.clientX, evt.clientY)) fire(evt);
	});

	el.addEventListener(
		"touchstart",
		(evt) => {
			evt.stopPropagation();
			if (evt.touches.length !== 1) return;
			touch = evt.changedTouches[0]!.identifier;
			// No pointerdown came first (or it was for another touch): a new press.
			if (pointer === null) ran = false;
		},
		{ passive: true },
	);
	el.addEventListener("touchcancel", () => (touch = null));
	el.addEventListener("touchend", (evt) => {
		if (touch === null) return;
		const end = Array.from(evt.changedTouches).find((t) => t.identifier === touch);
		if (!end) return;
		touch = null;
		if (!over(end.clientX, end.clientY)) return;
		// No mouse events and no click after this touch: the press is handled here.
		if (evt.cancelable) evt.preventDefault();
		fire(evt);
	});

	el.addEventListener("click", (evt) => {
		// The click a touch press makes after its release: already done.
		if (Date.now() - ranAt < CLICK_AFTER) {
			evt.preventDefault();
			return;
		}
		run(evt);
	});
}
