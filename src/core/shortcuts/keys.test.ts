import { describe, expect, it } from "vitest";
import { comboFromEvent, comboFromHotkey, formatCombo, hotkeyFromCombo, normalizeCombo, parseCombo } from "./keys";

const ev = (key: string, code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("comboFromEvent", () => {
	it("reads letters by position, whatever the layout", () => {
		expect(comboFromEvent(ev("p", "KeyP"), false)).toBe("P");
		// A right-to-left layout types another letter on the same key.
		expect(comboFromEvent(ev("פ", "KeyP"), false)).toBe("P");
		expect(comboFromEvent(ev("G", "KeyG", { ctrlKey: true, shiftKey: true }), false)).toBe("Mod+Shift+G");
	});
	it("maps Mod to Cmd on a Mac", () => {
		expect(comboFromEvent(ev("g", "KeyG", { metaKey: true }), true)).toBe("Mod+G");
		expect(comboFromEvent(ev("g", "KeyG", { ctrlKey: true }), true)).toBe("Ctrl+G");
		expect(comboFromEvent(ev("g", "KeyG", { metaKey: true }), false)).toBe("Meta+G");
	});
	it("names special keys", () => {
		expect(comboFromEvent(ev(" ", "Space"), false)).toBe("Space");
		expect(comboFromEvent(ev("ArrowUp", "ArrowUp", { altKey: true }), false)).toBe("Alt+ArrowUp");
		expect(comboFromEvent(ev("Escape", "Escape"), false)).toBe("Escape");
		expect(comboFromEvent(ev("F2", "F2"), false)).toBe("F2");
		expect(comboFromEvent(ev("1", "Digit1", { shiftKey: true }), false)).toBe("Shift+1");
	});
	it("drops Shift from typed symbols", () => {
		expect(comboFromEvent(ev("+", "Equal", { shiftKey: true }), false)).toBe("+");
		expect(comboFromEvent(ev("-", "Minus"), false)).toBe("-");
	});
	it("ignores a lone modifier", () => {
		expect(comboFromEvent(ev("Shift", "ShiftLeft", { shiftKey: true }), false)).toBeNull();
		expect(comboFromEvent(ev("Control", "ControlLeft", { ctrlKey: true }), false)).toBeNull();
	});
});

describe("parse and normalize", () => {
	it("parses a + key", () => {
		expect(parseCombo("Mod++")).toEqual({ modifiers: ["Mod"], key: "+" });
		expect(parseCombo("+")).toEqual({ modifiers: [], key: "+" });
	});
	it("puts modifiers in order", () => {
		expect(normalizeCombo("Shift+Mod+g")).toBe("Mod+Shift+G");
		expect(normalizeCombo("Shift++")).toBe("+");
		expect(normalizeCombo("Hyper+G")).toBeNull();
	});
});

describe("Obsidian hotkeys", () => {
	it("converts both ways", () => {
		expect(comboFromHotkey({ modifiers: ["Mod", "Shift"], key: "g" }, false)).toBe("Mod+Shift+G");
		expect(comboFromHotkey({ modifiers: ["Ctrl"], key: "G" }, false)).toBe("Mod+G");
		expect(comboFromHotkey({ modifiers: ["Meta"], key: "G" }, true)).toBe("Mod+G");
		expect(hotkeyFromCombo("Mod+Shift+G")).toEqual({ modifiers: ["Mod", "Shift"], key: "G" });
		expect(hotkeyFromCombo("Space")).toEqual({ modifiers: [], key: " " });
	});
});

describe("formatCombo", () => {
	it("shows keys for the platform", () => {
		expect(formatCombo("Mod+Shift+G", false)).toBe("Ctrl + Shift + G");
		expect(formatCombo("Mod+Shift+G", true)).toBe("⌘ ⇧ G");
		expect(formatCombo("Alt+ArrowLeft", false)).toBe("Alt + ←");
	});
});
