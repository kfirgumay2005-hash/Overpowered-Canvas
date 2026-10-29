import { Platform, type Menu } from "obsidian";

/** Space kept free under a fitted menu (CSS px). */
const MARGIN = 8;

/**
 * Keeps a context menu inside the visible part of the window. The app gives menus
 * `max-height: 100%` but opens them `top` pixels down, so a long menu runs past the bottom edge
 * (and behind a tablet's bottom bar) and its last items can't be reached. After the menu is
 * shown, its height is capped to the room left below its top, and it scrolls.
 */
export function fitMenu(menu: Menu): void {
	// Phones show menus as a bottom sheet with its own height limit.
	if (Platform.isPhone) return;
	const dom = (menu as unknown as { dom?: HTMLElement }).dom;
	if (!dom) return;
	const run = () => {
		if (!dom.isConnected) return;
		const win = dom.win;
		const body = dom.doc.body;
		const css = getComputedStyle(body);
		const inset = (name: string) => Number.parseFloat(css.getPropertyValue(name)) || 0;
		const viewport = win.visualViewport;
		const top = (viewport?.offsetTop ?? 0) + inset("--safe-area-inset-top") + MARGIN;
		const bottom = (viewport ? viewport.offsetTop + viewport.height : win.innerHeight) - inset("--safe-area-inset-bottom") - MARGIN;
		const rect = dom.getBoundingClientRect();
		const full = dom.scrollHeight;
		if (rect.top + Math.min(full, rect.height) <= bottom && full <= bottom - rect.top) return;
		// Too little room below: move the menu up as far as needed (never above the top).
		let menuTop = rect.top;
		if (bottom - menuTop < Math.min(full, bottom - top)) menuTop = Math.max(top, bottom - full);
		dom.addClass("opc-menu-fit");
		dom.setCssProps({ "--opc-menu-fit-top": `${Math.round(menuTop)}px`, "--opc-menu-fit-max": `${Math.max(80, Math.floor(bottom - menuTop))}px` });
	};
	// The menu is laid out right after the event that builds it.
	window.setTimeout(run, 0);
}
