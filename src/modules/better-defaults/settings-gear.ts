import { setTooltip } from "obsidian";
import type { CanvasLike } from "../../internals/types";

/** How long a finger stays on the gear to open the canvas options instead. */
const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE = 10;

interface GearOptions {
	tooltip: string;
	/** Opens this plugin's tab in Obsidian's settings. */
	openSettings(): void;
}

/**
 * The settings button (gear) at the top of the canvas side controls opens this plugin's settings.
 * The canvas options the core shows there (snap to grid, snap to objects, read-only, Customize the
 * bars…) open with a right-click or a long press. Returns the function that gives the button back.
 */
export function takeOverSettingsGear(canvas: CanvasLike, opts: GearOptions): () => void {
	const button = (canvas as CanvasLike & { quickSettingsButton?: HTMLElement }).quickSettingsButton ?? canvas.canvasControlsEl?.querySelector("svg.lucide-settings")?.closest<HTMLElement>(".canvas-control-item");
	if (!button) return () => {};
	const originalLabel = button.getAttribute("aria-label");

	let passThrough = false;
	let suppressClickUntil = 0;
	let press: { id: number; x: number; y: number; timer: number } | null = null;

	/** The core menu, by letting one click through to the core's own listener. */
	const openCanvasOptions = () => {
		const r = button.getBoundingClientRect();
		passThrough = true;
		try {
			button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, clientX: r.left, clientY: r.bottom, view: button.win }));
		} finally {
			passThrough = false;
		}
	};

	const onClick = (evt: MouseEvent) => {
		if (passThrough) return;
		evt.preventDefault();
		evt.stopImmediatePropagation();
		if (performance.now() < suppressClickUntil) return;
		opts.openSettings();
	};
	const onContextMenu = (evt: MouseEvent) => {
		evt.preventDefault();
		evt.stopImmediatePropagation();
		// A long press may already have opened it (some phones send both).
		if (performance.now() < suppressClickUntil) return;
		suppressClickUntil = performance.now() + 700;
		openCanvasOptions();
	};
	const cancelPress = () => {
		if (press) button.win.clearTimeout(press.timer);
		press = null;
	};
	const onPointerDown = (evt: PointerEvent) => {
		if (evt.pointerType === "mouse") return;
		cancelPress();
		const timer = button.win.setTimeout(() => {
			press = null;
			suppressClickUntil = performance.now() + 900;
			openCanvasOptions();
		}, LONG_PRESS_MS);
		press = { id: evt.pointerId, x: evt.clientX, y: evt.clientY, timer };
	};
	const onPointerMove = (evt: PointerEvent) => {
		if (press && evt.pointerId === press.id && Math.hypot(evt.clientX - press.x, evt.clientY - press.y) > MOVE_TOLERANCE) cancelPress();
	};

	button.addEventListener("click", onClick, true);
	button.addEventListener("contextmenu", onContextMenu, true);
	button.addEventListener("pointerdown", onPointerDown);
	button.addEventListener("pointermove", onPointerMove);
	button.addEventListener("pointerup", cancelPress);
	button.addEventListener("pointercancel", cancelPress);
	button.setAttribute("aria-label", opts.tooltip);
	setTooltip(button, opts.tooltip, { placement: "left" });
	button.addClass("opc-settings-gear");

	return () => {
		cancelPress();
		button.removeEventListener("click", onClick, true);
		button.removeEventListener("contextmenu", onContextMenu, true);
		button.removeEventListener("pointerdown", onPointerDown);
		button.removeEventListener("pointermove", onPointerMove);
		button.removeEventListener("pointerup", cancelPress);
		button.removeEventListener("pointercancel", cancelPress);
		button.removeClass("opc-settings-gear");
		if (originalLabel !== null) {
			button.setAttribute("aria-label", originalLabel);
			setTooltip(button, originalLabel, { placement: "left" });
		}
	};
}
