import { describe, expect, it } from "vitest";
import { cleanFolderPath, DEFAULT_FILES_FOLDER, defaultSettings, mergeWithDefaults, sanitizeSettings } from "./settings";

describe("sanitizeSettings", () => {
	it("keeps the finished tutorials, without duplicates or junk", () => {
		expect(sanitizeSettings({ tutorials: { done: ["basics", "layers", "basics", 3, null] } }).tutorials.done).toEqual(["basics", "layers"]);
		expect(sanitizeSettings({ tutorials: { done: "basics" } }).tutorials.done).toEqual([]);
		// The old tour's saved step is dropped.
		expect(sanitizeSettings({ tour: { step: 4 } })).not.toHaveProperty("tour");
	});

	it("returns defaults for garbage", () => {
		expect(sanitizeSettings(undefined)).toEqual(defaultSettings());
		expect(sanitizeSettings("x")).toEqual(defaultSettings());
	});

	it("keeps valid values, including entries of unknown modules", () => {
		const s = sanitizeSettings({
			language: "ja",
			modules: { diagnostics: { enabled: true, settings: { benchmarkFrames: 100 } }, "future-module": { enabled: true, settings: {} }, bad: 3 },
			coexistence: { acknowledged: ["advanced-canvas", 5] },
		});
		expect(s.language).toBe("ja");
		expect(s.modules).toEqual({
			diagnostics: { enabled: true, settings: { benchmarkFrames: 100 } },
			"future-module": { enabled: true, settings: {} },
		});
		expect(s.coexistence.acknowledged).toEqual(["advanced-canvas"]);
	});

	it("rejects an unknown or removed language", () => {
		expect(sanitizeSettings({ language: "fr" }).language).toBe("auto");
		expect(sanitizeSettings({ language: "he" }).language).toBe("auto");
	});
});

describe("mergeWithDefaults", () => {
	const defaults = { size: 10, name: "a", flags: { x: true, y: false }, list: [1] };

	it("takes stored values of the right type", () => {
		expect(mergeWithDefaults({ size: 5, name: "b", list: [2, 3] }, defaults)).toEqual({ size: 5, name: "b", flags: { x: true, y: false }, list: [2, 3] });
	});

	it("ignores wrong types, NaN and unknown keys", () => {
		expect(mergeWithDefaults({ size: "5", name: null, extra: 1, list: {} }, defaults)).toEqual(defaults);
		expect(mergeWithDefaults({ size: Number.NaN }, defaults).size).toBe(10);
	});

	it("merges nested objects", () => {
		expect(mergeWithDefaults({ flags: { y: true, z: 1 } }, defaults).flags).toEqual({ x: true, y: true });
	});

	it("does not share arrays with the stored data", () => {
		const stored = { list: [7] };
		const merged = mergeWithDefaults(stored, defaults);
		expect(merged.list).not.toBe(stored.list);
	});
});

describe("files folder", () => {
	it("cleans up typed paths and refuses unusable ones", () => {
		expect(cleanFolderPath(" /Plugins//Canvas data/ ")).toBe("Plugins/Canvas data");
		expect(cleanFolderPath("a\\b")).toBe("a/b");
		for (const bad of ["", "/", ".obsidian/x", "a/../b", "a:b", "a/#b"]) expect(cleanFolderPath(bad)).toBeNull();
	});
	it("defaults, keeps a valid folder and takes over the old Canvas ⇄ Markdown setting", () => {
		expect(sanitizeSettings({}).filesFolder).toBe(DEFAULT_FILES_FOLDER);
		expect(sanitizeSettings({ filesFolder: "System/Canvas" }).filesFolder).toBe("System/Canvas");
		expect(sanitizeSettings({ filesFolder: ".hidden" }).filesFolder).toBe(DEFAULT_FILES_FOLDER);
		expect(sanitizeSettings({ modules: { "canvas-markdown": { enabled: true, settings: { dataFolder: "Old/data" } } } }).filesFolder).toBe("Old/data");
	});
});
