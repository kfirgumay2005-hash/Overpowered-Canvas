export type DoubleClickSpeed = "fast" | "regular" | "slow" | "custom";

/** Milliseconds allowed between the two clicks of each preset. */
export const DOUBLE_CLICK_PRESETS: Readonly<Record<Exclude<DoubleClickSpeed, "custom">, number>> = {
	fast: 250,
	regular: 400,
	slow: 600,
};

export const clampDoubleClickMs = (n: number) => (Number.isFinite(n) ? Math.min(2000, Math.max(100, Math.round(n))) : DOUBLE_CLICK_PRESETS.regular);

export interface PointerSample {
	readonly id: number;
	readonly x: number;
	readonly y: number;
	readonly time: number;
	/** Pressed on the empty canvas background (not on a card, edge or control). */
	readonly onBackground: boolean;
	readonly primary: boolean;
	readonly leftButton: boolean;
	/** Mouse pointers get a tighter movement tolerance than touch and pen. */
	readonly mouse: boolean;
}

/**
 * Double-click detection on the canvas background, replacing the browser's dblclick: the interval
 * is ours, and a click that moved (a selection drag) or started on a card never counts, so
 * "click a card, then drag a selection box" no longer creates a card.
 */
export class BackgroundDoubleClick {
	private down: (PointerSample & { moved: boolean }) | null = null;
	private lastClick: { x: number; y: number; time: number } | null = null;

	constructor(private readonly interval: () => number) {}

	private tolerance(mouse: boolean) {
		return mouse ? 6 : 12;
	}

	pointerDown(p: PointerSample): void {
		if (!p.primary || !p.leftButton || !p.onBackground) {
			// A second finger (pinch) or another button cancels everything in progress.
			this.down = null;
			this.lastClick = null;
			return;
		}
		this.down = { ...p, moved: false };
	}

	pointerMove(id: number, x: number, y: number): void {
		const d = this.down;
		if (!d || d.id !== id || d.moved) return;
		if (Math.hypot(x - d.x, y - d.y) > this.tolerance(d.mouse)) d.moved = true;
	}

	cancel(): void {
		this.down = null;
		this.lastClick = null;
	}

	/** True when this release completes a double-click. */
	pointerUp(id: number, x: number, y: number, time: number): boolean {
		const d = this.down;
		this.down = null;
		if (!d || d.id !== id) return false;
		if (d.moved || Math.hypot(x - d.x, y - d.y) > this.tolerance(d.mouse)) {
			this.lastClick = null;
			return false;
		}
		const last = this.lastClick;
		if (last && d.time - last.time <= this.interval() && Math.hypot(x - last.x, y - last.y) <= 2 * this.tolerance(d.mouse)) {
			this.lastClick = null;
			return true;
		}
		this.lastClick = { x, y, time };
		return false;
	}
}
