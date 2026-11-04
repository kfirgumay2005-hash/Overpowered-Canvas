/**
 * A button that works the same by mouse, keyboard, finger and pen.
 *
 * A tap normally reaches a button as a `click` the browser makes up after the touch ends. In a
 * note, that click can go missing on tablets: the editor and the app's own touch gestures on the
 * pane (pull down, swipe) take the touch, the keyboard closing moves the page under the finger,
 * and nothing happens. So a touch or pen press runs the action when it is released on the same
 * button, and the click that may still follow is ignored. Mouse and keyboard keep the plain click.
 */
export function onPress(el: HTMLElement, run: (evt: Event) => void): void {
	let down: number | null = null;
	let ranAt = 0;
	el.addEventListener("pointerdown", (evt) => {
		if (evt.pointerType === "mouse") return;
		down = evt.pointerId;
		// The pane's own touch gestures never see a press meant for this button, and the focus
		// stays where it is (a tablet's keyboard doesn't close and move the page mid-tap).
		evt.stopPropagation();
		evt.preventDefault();
	});
	el.addEventListener("touchstart", (evt) => evt.stopPropagation(), { passive: true });
	el.addEventListener("pointercancel", () => (down = null));
	el.addEventListener("pointerup", (evt) => {
		if (evt.pointerType === "mouse" || down !== evt.pointerId) return;
		down = null;
		// Released outside the button (the finger slid away): no press.
		const r = el.getBoundingClientRect();
		if (evt.clientX < r.left - 8 || evt.clientX > r.right + 8 || evt.clientY < r.top - 8 || evt.clientY > r.bottom + 8) return;
		if ((el as HTMLButtonElement).disabled) return;
		ranAt = Date.now();
		evt.preventDefault();
		run(evt);
	});
	el.addEventListener("click", (evt) => {
		// The click a tap makes after its release: already done.
		if (Date.now() - ranAt < 800) {
			evt.preventDefault();
			return;
		}
		run(evt);
	});
}
