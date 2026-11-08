/**
 * Key combinations as text, the way they are stored: "Mod+Shift+G", "Alt+ArrowUp", "Tab", "+".
 * Pure functions only (unit-tested).
 *
 * - Modifiers come first, in the order Mod, Ctrl, Meta, Alt, Shift. "Mod" is Ctrl on Windows and
 *   Linux and Cmd on macOS (like Obsidian's hotkeys); "Ctrl" is only used for the Control key on a
 *   Mac, "Meta" only for the Windows key elsewhere.
 * - The key: a letter is upper case ("G") and read from the key's position (`code`), so it works the
 *   same with any keyboard layout (including those of right-to-left languages); a digit likewise.
 *   Named keys keep their names ("ArrowUp", "Enter", "Escape", "PageDown", "F2"); the space bar is
 *   "Space". Any other character is the character itself ("+", "-", "="), without Shift: Shift is
 *   part of typing it.
 */

export type Combo = string;

export interface KeyEventLike {
	key: string;
	code?: string;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
	shiftKey: boolean;
}

const MODIFIER_ORDER = ["Mod", "Ctrl", "Meta", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];
const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta", "OS", "AltGraph", "CapsLock", "Fn", "FnLock", "Hyper", "Super", "Symbol", "NumLock", "ScrollLock"]);

const NAMED: Record<string, string> = { " ": "Space", Spacebar: "Space", Esc: "Escape", Del: "Delete", Up: "ArrowUp", Down: "ArrowDown", Left: "ArrowLeft", Right: "ArrowRight" };

/** The key part of an event, or null for a lone modifier or an unknown key. */
export function keyOf(evt: KeyEventLike): string | null {
	if (MODIFIER_KEYS.has(evt.key)) return null;
	const code = evt.code ?? "";
	if (/^Key[A-Z]$/.test(code)) return code.slice(3);
	if (/^Digit[0-9]$/.test(code)) return code.slice(5);
	const key = NAMED[evt.key] ?? evt.key;
	if (!key || key === "Unidentified" || key === "Dead" || key === "Process") return null;
	return key.length === 1 ? key.toUpperCase() : key;
}

/** True for keys that type a character other than a letter or digit ("+", "?", "="). */
function isSymbol(key: string): boolean {
	return key.length === 1 && !/[A-Z0-9]/.test(key);
}

/** The combination a key press makes, or null when only a modifier was pressed. */
export function comboFromEvent(evt: KeyEventLike, mac: boolean): Combo | null {
	const key = keyOf(evt);
	if (!key) return null;
	const mods = new Set<Modifier>();
	if (mac ? evt.metaKey : evt.ctrlKey) mods.add("Mod");
	if (mac && evt.ctrlKey) mods.add("Ctrl");
	if (!mac && evt.metaKey) mods.add("Meta");
	if (evt.altKey) mods.add("Alt");
	if (evt.shiftKey && !isSymbol(key)) mods.add("Shift");
	return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** Splits a combo into its modifiers and key ("Mod++" → Mod and "+"). */
export function parseCombo(combo: Combo): { modifiers: Modifier[]; key: string } | null {
	const parts = combo.split("+");
	// A trailing "+" key leaves an empty last part: "Mod++" → ["Mod", "", ""].
	let key = parts.pop() ?? "";
	if (key === "" && parts.length > 0 && parts[parts.length - 1] === "") {
		parts.pop();
		key = "+";
	}
	if (!key) return null;
	const modifiers: Modifier[] = [];
	for (const p of parts) {
		if (!(MODIFIER_ORDER as readonly string[]).includes(p)) return null;
		modifiers.push(p as Modifier);
	}
	return { modifiers, key };
}

/** The canonical text of a combo (modifier order fixed), or null if it isn't one. */
export function normalizeCombo(combo: string): Combo | null {
	const parsed = parseCombo(combo.trim());
	if (!parsed) return null;
	const mods = new Set(parsed.modifiers);
	const key = parsed.key.length === 1 ? parsed.key.toUpperCase() : (NAMED[parsed.key] ?? parsed.key);
	if (isSymbol(key)) mods.delete("Shift");
	return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join("+");
}

const KEY_LABELS: Record<string, string> = {
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Escape: "Esc",
	PageUp: "Page Up",
	PageDown: "Page Down",
	Backspace: "Backspace",
	Delete: "Delete",
};

/** How a combo is shown: "Ctrl + Shift + G" (Windows), "⌘ ⇧ G" (macOS). */
export function formatCombo(combo: Combo, mac: boolean): string {
	const parsed = parseCombo(combo);
	if (!parsed) return combo;
	const mod: Record<Modifier, string> = mac ? { Mod: "⌘", Ctrl: "⌃", Meta: "⌘", Alt: "⌥", Shift: "⇧" } : { Mod: "Ctrl", Ctrl: "Ctrl", Meta: "Win", Alt: "Alt", Shift: "Shift" };
	const parts = [...parsed.modifiers.map((m) => mod[m]), KEY_LABELS[parsed.key] ?? parsed.key];
	return parts.join(mac ? " " : " + ");
}

/** Obsidian's hotkey shape ({ modifiers: ["Mod", "Shift"], key: "G" }) ⇄ combo text. */
export interface HotkeyLike {
	modifiers: string[];
	key: string;
}

/** On Windows and Linux Obsidian's "Ctrl" is the same key as "Mod"; on a Mac its "Meta" is "Mod". */
export function comboFromHotkey(hotkey: HotkeyLike, mac: boolean): Combo | null {
	const mods = hotkey.modifiers.map((m) => (!mac && m === "Ctrl" ? "Mod" : mac && m === "Meta" ? "Mod" : m));
	return normalizeCombo([...mods, hotkey.key === " " ? "Space" : hotkey.key].join("+"));
}

export function hotkeyFromCombo(combo: Combo): HotkeyLike | null {
	const parsed = parseCombo(combo);
	if (!parsed) return null;
	return { modifiers: [...parsed.modifiers], key: parsed.key === "Space" ? " " : parsed.key };
}
