import { describe, expect, it } from "vitest";
import { BackgroundDoubleClick, clampDoubleClickMs, type PointerSample } from "./double-click";

const down = (time: number, over: Partial<PointerSample> = {}): PointerSample => ({
	id: 1, x: 100, y: 100, time, onBackground: true, primary: true, leftButton: true, mouse: true, ...over,
});

/** A full click at (x, y) pressed at `time` and released 50 ms later; returns pointerUp's result. */
function click(d: BackgroundDoubleClick, time: number, over: Partial<PointerSample> = {}, moveTo?: { x: number; y: number }) {
	const p = down(time, over);
	d.pointerDown(p);
	const end = moveTo ?? { x: p.x, y: p.y };
	if (moveTo) d.pointerMove(p.id, moveTo.x, moveTo.y);
	return d.pointerUp(p.id, end.x, end.y, time + 50);
}

describe("BackgroundDoubleClick", () => {
	it("detects two quick clicks on the background", () => {
		const d = new BackgroundDoubleClick(() => 400);
		expect(click(d, 0)).toBe(false);
		expect(click(d, 300)).toBe(true);
	});

	it("ignores clicks further apart than the interval", () => {
		const d = new BackgroundDoubleClick(() => 250);
		expect(click(d, 0)).toBe(false);
		expect(click(d, 400)).toBe(false);
	});

	it("follows a changed interval", () => {
		let ms = 250;
		const d = new BackgroundDoubleClick(() => ms);
		click(d, 0);
		ms = 600;
		expect(click(d, 500)).toBe(true);
	});

	it("never counts a drag (selection box) as a click", () => {
		const d = new BackgroundDoubleClick(() => 400);
		expect(click(d, 0)).toBe(false);
		expect(click(d, 200, {}, { x: 300, y: 250 })).toBe(false);
		// The drag also resets: the next single click starts over.
		expect(click(d, 400)).toBe(false);
	});

	it("click on a card, then a drag on the background: no card", () => {
		const d = new BackgroundDoubleClick(() => 400);
		expect(click(d, 0, { onBackground: false })).toBe(false);
		expect(click(d, 150, {}, { x: 260, y: 220 })).toBe(false);
	});

	it("click on a card, then a click on the background: not a double-click", () => {
		const d = new BackgroundDoubleClick(() => 400);
		click(d, 0, { onBackground: false });
		expect(click(d, 150)).toBe(false);
	});

	it("requires both clicks at about the same spot", () => {
		const d = new BackgroundDoubleClick(() => 400);
		click(d, 0);
		expect(click(d, 200, { x: 180 })).toBe(false);
	});

	it("allows a little jitter, more for touch", () => {
		const mouse = new BackgroundDoubleClick(() => 400);
		click(mouse, 0);
		expect(click(mouse, 200, {}, { x: 104, y: 103 })).toBe(true);

		const touch = new BackgroundDoubleClick(() => 400);
		click(touch, 0, { mouse: false });
		expect(click(touch, 200, { mouse: false }, { x: 109, y: 106 })).toBe(true);
	});

	it("a second finger or another button cancels", () => {
		const d = new BackgroundDoubleClick(() => 400);
		click(d, 0);
		d.pointerDown(down(100, { id: 2, primary: false }));
		expect(click(d, 200)).toBe(false);

		const r = new BackgroundDoubleClick(() => 400);
		click(r, 0);
		click(r, 100, { leftButton: false });
		expect(click(r, 200)).toBe(false);
	});

	it("does not chain a third click into another double-click", () => {
		const d = new BackgroundDoubleClick(() => 400);
		click(d, 0);
		expect(click(d, 200)).toBe(true);
		expect(click(d, 400)).toBe(false);
	});

	it("clamps the custom interval", () => {
		expect(clampDoubleClickMs(5)).toBe(100);
		expect(clampDoubleClickMs(99999)).toBe(2000);
		expect(clampDoubleClickMs(Number.NaN)).toBe(400);
		expect(clampDoubleClickMs(333.4)).toBe(333);
	});
});
