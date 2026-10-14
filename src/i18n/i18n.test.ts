import { describe, expect, it } from "vitest";
import { createTranslator, interpolate, LOCALES, resolveLocale } from "./index";

describe("resolveLocale", () => {
	it("uses the explicit setting", () => {
		expect(resolveLocale("he", "en")).toBe("he");
		expect(resolveLocale("en", "he")).toBe("en");
	});
	it("follows Obsidian's language in auto mode", () => {
		expect(resolveLocale("auto", "he")).toBe("he");
		expect(resolveLocale("auto", "iw")).toBe("he");
		expect(resolveLocale("auto", "he-IL")).toBe("he");
		expect(resolveLocale("auto", "fr")).toBe("en");
		expect(resolveLocale("auto", "")).toBe("en");
	});
});

describe("interpolate", () => {
	it("fills placeholders", () => {
		expect(interpolate("{a} and {b}", { a: 1, b: "two" })).toBe("1 and two");
	});
	it("keeps unknown placeholders visible", () => {
		expect(interpolate("{a} {missing}", { a: "x" })).toBe("x {missing}");
	});
	it("returns the template when no vars are given", () => {
		expect(interpolate("{a}")).toBe("{a}");
	});
});

describe("locales", () => {
	const keys = Object.keys(LOCALES.en) as (keyof typeof LOCALES.en)[];

	it("every locale defines every key with a non-empty string", () => {
		for (const [locale, table] of Object.entries(LOCALES)) {
			expect(Object.keys(table).sort(), locale).toEqual([...keys].sort());
			for (const key of keys) expect(table[key], `${locale}:${key}`).not.toBe("");
		}
	});

	it("placeholders match between locales", () => {
		const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
		for (const key of keys) expect(names(LOCALES.he[key]), key).toEqual(names(LOCALES.en[key]));
	});

	it("translator interpolates", () => {
		const t = createTranslator("he");
		expect(t("diagnostics.patches.copied", { count: 3 })).toContain("3");
	});
});
