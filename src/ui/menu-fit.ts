import { Platform, type Menu } from "obsidian";

/** Space kept free under a fitted menu (CSS px). */
const MARGIN = 8;

interface ScrollingMenu {
	items: ({ dom?: HTMLElement } | undefined)[];
	select(index: number): void;
}

/**
 * Two things the app does for a mouse move a long menu under a finger, so a tap misses its item:
 * the mouse move that a tap fires scrolls the list to match the pointer's height, and selecting
 * an item scrolls it fully into view. Touch and pen leave the list where it is.
 */
function holdListStill(menu: ScrollingMenu, dom: HTMLElement): void {
	let touching = false;
	const note = (evt: PointerEvent) => {
		touching = evt.pointerType !== "mouse";
	};
	for (const name of ["pointerover", "pointerdown", "pointermove"] as const) dom.addEventListener(name, note, true);
	dom.addEventListener(
		"mousemove",
		(evt) => {
			if (touching) evt.stopPropagation();
		},
		true,
	);
	const select = menu.select.bind(menu);
	menu.select = function (index) {
		const item = menu.items[index]?.dom;
		if (!touching || !item) return select(index);
		item.scrollIntoView = () => {};
		try {
			select(index);
		} finally {
			Reflect.deleteProperty(item, "scrollIntoView");
		}
	};
}

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
	holdListStill(menu as unknown as ScrollingMenu, dom);
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
		// The app places the menu with an inline `top`; move it the same way.
		dom.setCssStyles({ top: `${Math.round(menuTop)}px` });
		dom.setCssProps({ "--opc-menu-fit-max": `${Math.max(80, Math.floor(bottom - menuTop))}px` });
	};
	// The menu is laid out right after the event that builds it.
	window.setTimeout(run, 0);
}
