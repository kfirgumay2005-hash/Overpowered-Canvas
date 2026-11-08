import { describe, expect, it } from "vitest";
import { en } from "../../i18n/locales/en";
import { sanitizeSettings } from "../../settings/settings";
import { clash, collisions, CATEGORY_ORDER, SHORTCUTS, shortcutDef } from "./catalog";
import { normalizeCombo } from "./keys";
import { migrateLegacyShortcuts, sanitizeOverrides, ShortcutStore, type ShortcutOverrides } from "./store";

describe("catalog", () => {
	it("has unique ids, known categories and normalized default keys", () => {
		const ids = SHORTCUTS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const s of SHORTCUTS) {
			expect(CATEGORY_ORDER).toContain(s.category);
			for (const c of s.defaults) expect(normalizeCombo(c), `${s.id}: ${c}`).toBe(c);
			if (!s.fixed) expect(s.defaults.length, s.id).toBeGreaterThan(0);
			for (const other of s.shares ?? []) expect(shortcutDef(other), `${s.id} shares ${other}`).toBeDefined();
		}
	});

	it("has a name, a situation and a category label in the UI strings", () => {
		const keys = new Set(Object.keys(en));
		for (const s of SHORTCUTS) {
			expect(keys.has(`shortcuts.action.${s.id}`), s.id).toBe(true);
			expect(keys.has(`shortcuts.ctx.${s.context}`), s.context).toBe(true);
			expect(keys.has(`shortcuts.cat.${s.category}`), s.category).toBe(true);
			if (s.gesture) expect(keys.has(s.gesture), s.gesture).toBe(true);
		}
	});

	it("ships without conflicts between its own defaults", () => {
		const defaults = (id: string) => shortcutDef(id)?.defaults ?? [];
		for (const s of SHORTCUTS) for (const c of s.defaults) expect(collisions(s, c, defaults).map((o) => o.id), `${s.id} ${c}`).toEqual([]);
	});

	it("lets stickies share keys with mind maps on purpose, not with other board keys", () => {
		expect(clash(shortcutDef("sticky.next")!, shortcutDef("mindmap.child")!)).toBe(false);
		expect(clash(shortcutDef("drawing.toggle")!, shortcutDef("mindmap.child")!)).toBe(true);
		// Different modes never fire together.
		expect(clash(shortcutDef("drawing.done")!, shortcutDef("slides.end")!)).toBe(false);
		expect(clash(shortcutDef("walk.end")!, shortcutDef("columns.edit")!)).toBe(true);
	});
});

describe("overrides", () => {
	it("keeps known, editable ids with valid keys", () => {
		expect(sanitizeOverrides({ "drawing.toggle": ["Shift+d", "D", "D", 4], "core.undo": ["Mod+U"], nope: ["X"], "lasso.toggle": [] })).toEqual({ "drawing.toggle": ["Shift+D", "D"], "lasso.toggle": [] });
	});

	it("moves the old key settings over", () => {
		expect(migrateLegacyShortcuts({ mindmap: { settings: { siblingKey: "Shift+Enter" } }, "smart-groups": { settings: { keys: false } } })).toEqual({
			"mindmap.sibling": ["Shift+Enter"],
			"groups.group": [],
			"groups.ungroup": [],
		});
		expect(migrateLegacyShortcuts({ mindmap: { settings: { siblingKey: "Enter" } }, "smart-groups": { settings: { keys: true } } })).toEqual({});
	});

	it("migrates only once: saved shortcuts win over the old settings", () => {
		const legacy = { modules: { mindmap: { enabled: true, settings: { siblingKey: "Shift+Enter" } } } };
		expect(sanitizeSettings(legacy).shortcuts).toEqual({ "mindmap.sibling": ["Shift+Enter"] });
		expect(sanitizeSettings({ ...legacy, shortcuts: {} }).shortcuts).toEqual({});
	});
});

describe("ShortcutStore", () => {
	const make = () => {
		const map: ShortcutOverrides = {};
		let saves = 0;
		const store = new ShortcutStore(() => map, async () => void saves++, false);
		return { map, store, saves: () => saves };
	};
	const key = (k: string, code: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({ key: k, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

	it("matches the default until changed, then the new key", async () => {
		const { store, map, saves } = make();
		expect(store.matches("drawing.toggle", key("p", "KeyP"))).toBe(true);
		await store.set("drawing.toggle", ["Shift+D"]);
		expect(map).toEqual({ "drawing.toggle": ["Shift+D"] });
		expect(store.matches("drawing.toggle", key("p", "KeyP"))).toBe(false);
		expect(store.matches("drawing.toggle", key("D", "KeyD", { shiftKey: true }))).toBe(true);
		await store.set("drawing.toggle", ["P"]);
		expect(map).toEqual({});
		expect(saves()).toBe(2);
	});

	it("switches a shortcut off with an empty list and resets", async () => {
		const { store } = make();
		await store.set("groups.group", []);
		expect(store.combos("groups.group")).toEqual([]);
		expect(store.changedIds()).toEqual(["groups.group"]);
		await store.resetAll();
		expect(store.combos("groups.group")).toEqual(["Mod+G"]);
	});

	it("finds which of several shortcuts a key belongs to", () => {
		const { store } = make();
		expect(store.match(key(" ", "Space"), ["slides.previous", "slides.next"])).toBe("slides.next");
		expect(store.match(key("x", "KeyX"), ["slides.previous", "slides.next"])).toBeNull();
	});

	it("never changes a built-in canvas key", async () => {
		const { store, map } = make();
		await store.set("core.undo", ["Mod+U"]);
		expect(map).toEqual({});
	});
});
