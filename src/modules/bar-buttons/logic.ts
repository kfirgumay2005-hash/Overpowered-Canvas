/**
 * Which buttons the bottom bar, the side bar and the popup over a selection show (pure,
 * unit-tested).
 *
 * The app gives its bar buttons no ids and translates their labels, so a button is known by what
 * stays the same across languages and devices: our own class, else its icon.
 */

export type Bar = "bottom" | "side" | "popup";

export const BARS: readonly Bar[] = ["bottom", "side", "popup"];

/** A button added by hand: it runs a command from the command palette. */
export interface CustomButton {
	id: string;
	bar: Bar;
	/** Command id, e.g. "app:open-settings". */
	command: string;
	icon: string;
	name: string;
}

export interface BarButtonsSettings {
	/** `<bar>:<button key>` of the buttons taken off the bars. */
	hidden: string[];
	custom: CustomButton[];
	/** Per bar, the order chosen: button keys and `custom:<id>` of added buttons. Absent: as it comes. */
	order: Partial<Record<Bar, string[]>>;
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

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function sanitizeBarSettings(raw: unknown): BarButtonsSettings {
	const r = (raw ?? {}) as { hidden?: unknown; custom?: unknown; order?: unknown };
	const hidden = Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((k): k is string => typeof k === "string" && k.length > 0))] : [];
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
	return { hidden, custom, order };
}
