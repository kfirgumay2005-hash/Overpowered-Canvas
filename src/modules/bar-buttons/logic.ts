/**
 * Which buttons the bottom bar, the side bar, the popup over a selection and the popup over
 * images show (pure, unit-tested).
 *
 * The app gives its bar buttons no ids and translates their labels, so a button is known by what
 * stays the same across languages and devices: our own class, else its icon.
 */

/** "image": the popup when only images are selected; it has its own buttons, order and commands. */
export type Bar = "bottom" | "side" | "popup" | "image";

export const BARS: readonly Bar[] = ["bottom", "side", "popup", "image"];

/** The two popups over a selection (built for each selection, not mounted once). */
export const isPopupBar = (bar: Bar): boolean => bar === "popup" || bar === "image";

/** Which popup a selection gets: the image one when it holds images only. */
export function popupFor(items: readonly { image: boolean }[]): Bar {
	return items.length > 0 && items.every((i) => i.image) ? "image" : "popup";
}

/** A button added by hand: it runs a command from the command palette. */
export interface CustomButton {
	id: string;
	bar: Bar;
	/** Command id, e.g. "app:open-settings". */
	command: string;
	icon: string;
	name: string;
}

/** A menu item seen in a right-click or ⋮ menu: its title (what it is known by) and icon. */
export interface SeenItem {
	title: string;
	icon: string;
}

/** The right-click menu or the ⋮ menu: which items are taken off, and where that applies. */
export interface MenuChoice {
	/** Off: menus opened in a canvas. On: these menus everywhere in Obsidian. */
	allVault: boolean;
	/** Titles of the items taken off. */
	hidden: string[];
	/** Items the menu has shown (newest last), for the list in Customize the bars. */
	seen: SeenItem[];
}

export type MenuKey = "context" | "more";
export const MENU_KEYS: readonly MenuKey[] = ["context", "more"];
export const MAX_SEEN = 200;

export interface BarButtonsSettings {
	/** `<bar>:<button key>` of the buttons taken off the bars. */
	hidden: string[];
	/** `<bar>:<button key>` of buttons that are off until turned on (OFF_BY_DEFAULT) and were turned on. */
	shown: string[];
	custom: CustomButton[];
	/** Per bar, the order chosen: button keys and `custom:<id>` of added buttons. Absent: as it comes. */
	order: Partial<Record<Bar, string[]>>;
	menus: Record<MenuKey, MenuChoice>;
}

export const emptyMenus = (): Record<MenuKey, MenuChoice> => ({ context: { allVault: false, hidden: [], seen: [] }, more: { allVault: false, hidden: [], seen: [] } });

/** A menu item's title as a key: one line, trimmed. */
export const itemTitle = (text: string | null | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/** `seen` with the items of a menu added (known ones keep their place); null when nothing is new. */
export function addSeen(seen: readonly SeenItem[], items: readonly SeenItem[]): SeenItem[] | null {
	const known = new Set(seen.map((s) => s.title));
	const fresh = items.filter((i) => i.title && !known.has(i.title) && known.add(i.title));
	if (!fresh.length) return null;
	return [...seen, ...fresh].slice(-MAX_SEEN);
}

function sanitizeMenuChoice(raw: unknown): MenuChoice {
	const r = (raw ?? {}) as Partial<Record<keyof MenuChoice, unknown>>;
	const hidden = Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((k): k is string => typeof k === "string" && k.trim().length > 0).map(itemTitle))] : [];
	const seen: SeenItem[] = [];
	const titles = new Set<string>();
	for (const s of Array.isArray(r.seen) ? (r.seen as Partial<SeenItem>[]) : []) {
		const title = itemTitle(typeof s?.title === "string" ? s.title : "");
		if (!title || titles.has(title)) continue;
		titles.add(title);
		seen.push({ title, icon: typeof s.icon === "string" ? s.icon : "" });
	}
	return { allVault: r.allVault === true, hidden, seen: seen.slice(-MAX_SEEN) };
}

/** The key of an added button in an order list. */
export const customKey = (id: string) => `custom:${id}`;

/** Places past the chosen order, for buttons it doesn't name (new ones come last, as they come). */
const UNLISTED = 1000;

/** Where a button goes: its place in the chosen order, else after all of them, in its own order. */
export function orderOf(key: string, natural: number, saved: readonly string[] | undefined): number {
	if (!saved) return natural;
	const at = saved.indexOf(key);
	return at >= 0 ? at : UNLISTED + natural;
}

/** Keys in the order the bar shows them. */
export function sortKeys(keys: readonly string[], saved: readonly string[] | undefined): string[] {
	return keys
		.map((key, natural) => ({ key, at: orderOf(key, natural, saved) }))
		.sort((a, b) => a.at - b.at)
		.map((e) => e.key);
}


export interface ButtonFacts {
	/** Classes of the button. */
	classes: string[];
	/** Classes of the group holding it (side bar). */
	groupClasses: string[];
	/** Classes of its icon. */
	iconClasses: string[];
	label: string;
	/** Popup buttons: the name of an icon that isn't a lucide one (the label is translated). */
	iconName?: string;
}

function baseKey(b: ButtonFacts): string {
	return (
		b.classes.find((c) => (c.startsWith("opc-card-") && c !== "opc-card-button") || (c.startsWith("opc-menu-") && c !== "opc-menu-button")) ??
		b.groupClasses.find((c) => /^opc-.*-control$/.test(c)) ??
		b.iconClasses.find((c) => c.startsWith("lucide-")) ??
		b.iconName ??
		b.label
	);
}

/** A stable key for each button of a bar; buttons that look the same are told apart by their order. */
export function buttonKeys(buttons: ButtonFacts[]): string[] {
	const seen = new Map<string, number>();
	return buttons.map((b) => {
		const key = baseKey(b);
		const n = (seen.get(key) ?? 0) + 1;
		seen.set(key, n);
		return n === 1 ? key : `${key}#${n}`;
	});
}

/** A button's name for lists: its tooltip without the shortcut or notes in brackets. */
export function buttonLabel(label: string): string {
	const first = label.split("\n")[0] ?? "";
	return first.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function hiddenKey(bar: Bar, key: string): string {
	return `${bar}:${key}`;
}

/** Buttons a bar starts without: they show once turned on in Customize the bars. */
export const OFF_BY_DEFAULT: readonly string[] = ["bottom:opc-card-flowchart-review"];

/** The `<bar>:<key>` of the buttons taken off: those taken off by hand and those off by default. */
export function hiddenKeys(settings: Pick<BarButtonsSettings, "hidden" | "shown">): Set<string> {
	const out = new Set(settings.hidden);
	for (const key of OFF_BY_DEFAULT) if (!settings.shown.includes(key)) out.add(key);
	return out;
}

/** The settings change that shows or hides one button. */
export function showButton(settings: Pick<BarButtonsSettings, "hidden" | "shown">, key: string, show: boolean): Pick<BarButtonsSettings, "hidden" | "shown"> {
	const hidden = settings.hidden.filter((k) => k !== key);
	const shown = settings.shown.filter((k) => k !== key);
	if (!show) hidden.push(key);
	else if (OFF_BY_DEFAULT.includes(key)) shown.push(key);
	return { hidden, shown };
}

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function sanitizeBarSettings(raw: unknown): BarButtonsSettings {
	const r = (raw ?? {}) as { hidden?: unknown; shown?: unknown; custom?: unknown; order?: unknown };
	const keys = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === "string" && k.length > 0))] : []);
	const hidden = keys(r.hidden);
	const shown = keys(r.shown);
	const ids = new Set<string>();
	const custom: CustomButton[] = [];
	for (const item of Array.isArray(r.custom) ? (r.custom as Partial<CustomButton>[]) : []) {
		const id = text(item?.id);
		const command = text(item?.command);
		if (!id || !command || ids.has(id)) continue;
		ids.add(id);
		custom.push({ id, bar: BARS.includes(item.bar as Bar) ? (item.bar as Bar) : "bottom", command, icon: text(item.icon) || "lucide-terminal", name: text(item.name) || command });
	}
	const order: Partial<Record<Bar, string[]>> = {};
	const savedOrder = r.order && typeof r.order === "object" ? (r.order as Record<string, unknown>) : {};
	for (const bar of BARS) {
		const list = savedOrder[bar];
		if (Array.isArray(list)) order[bar] = [...new Set(list.filter((k): k is string => typeof k === "string" && k.length > 0))];
	}
	const menus = (r as { menus?: Partial<Record<MenuKey, unknown>> }).menus ?? {};
	return { hidden, shown, custom, order, menus: { context: sanitizeMenuChoice(menus.context), more: sanitizeMenuChoice(menus.more) } };
}
