/**
 * Which buttons the bottom bar and the side bar show (pure, unit-tested).
 *
 * The app gives its bar buttons no ids and translates their labels, so a button is known by what
 * stays the same across languages and devices: our own class, else its icon.
 */

export type Bar = "bottom" | "side";

export const BARS: readonly Bar[] = ["bottom", "side"];

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
}

export interface ButtonFacts {
	/** Classes of the button. */
	classes: string[];
	/** Classes of the group holding it (side bar). */
	groupClasses: string[];
	/** Classes of its icon. */
	iconClasses: string[];
	label: string;
}

function baseKey(b: ButtonFacts): string {
	return b.classes.find((c) => c.startsWith("opc-card-") && c !== "opc-card-button") ?? b.groupClasses.find((c) => /^opc-.*-control$/.test(c)) ?? b.iconClasses.find((c) => c.startsWith("lucide-")) ?? b.label;
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
	const r = (raw ?? {}) as { hidden?: unknown; custom?: unknown };
	const hidden = Array.isArray(r.hidden) ? [...new Set(r.hidden.filter((k): k is string => typeof k === "string" && k.length > 0))] : [];
	const ids = new Set<string>();
	const custom: CustomButton[] = [];
	for (const item of Array.isArray(r.custom) ? (r.custom as Partial<CustomButton>[]) : []) {
		const id = text(item?.id);
		const command = text(item?.command);
		if (!id || !command || ids.has(id)) continue;
		ids.add(id);
		custom.push({ id, bar: item.bar === "side" ? "side" : "bottom", command, icon: text(item.icon) || "lucide-terminal", name: text(item.name) || command });
	}
	return { hidden, custom };
}
