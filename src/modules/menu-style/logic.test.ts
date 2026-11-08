import { describe, expect, it } from "vitest";
import { ALL_MENU_CLASSES, ALL_MENU_VARS, cleanColor, isThemeDefault, MENU_STYLE_DEFAULTS, menuStyleProps, sanitizeMenuStyle } from "./logic";

describe("sanitizeMenuStyle", () => {
	it("keeps the theme for missing or bad values and clamps numbers", () => {
		const s = sanitizeMenuStyle({ fontSize: 99, radius: -5, width: "wide", shadow: "glow", light: { background: "red", hover: "#ABCDEF" } });
		expect(s.fontSize).toBe(28);
		expect(s.radius).toBe(0);
		expect(s.width).toBe(-1);
		expect(s.shadow).toBe("theme");
		expect(s.light).toEqual({ background: "", text: "", hover: "#abcdef", border: "" });
		expect(sanitizeMenuStyle(undefined)).toEqual(MENU_STYLE_DEFAULTS);
	});
	it("accepts hex colors only", () => {
		expect(cleanColor("#fff")).toBe("#fff");
		expect(cleanColor("#11223344")).toBe("#11223344");
		expect(cleanColor("url(x)")).toBe("");
	});
});

describe("menuStyleProps", () => {
	it("sets nothing for the theme's own look", () => {
		expect(menuStyleProps(MENU_STYLE_DEFAULTS)).toEqual({ classes: [], vars: {} });
		expect(isThemeDefault(MENU_STYLE_DEFAULTS)).toBe(true);
	});
	it("sets only what changed, per theme for colors", () => {
		const { classes, vars } = menuStyleProps({ ...MENU_STYLE_DEFAULTS, fontSize: 16, width: 260, shadow: "none", dark: { background: "#101010", text: "", hover: "#333333", border: "" } });
		expect(classes.sort()).toEqual(["opc-ms-dark-bg", "opc-ms-dark-hover", "opc-ms-font", "opc-ms-shadow", "opc-ms-width"]);
		expect(vars).toEqual({ "--opc-ms-font": "16px", "--opc-ms-width": "260px", "--opc-ms-shadow": "none", "--opc-ms-dark-bg": "#101010", "--opc-ms-dark-hover": "#333333" });
		expect(isThemeDefault({ ...MENU_STYLE_DEFAULTS, fontSize: 16 })).toBe(false);
	});
	it("lists every class it can set", () => {
		const all = { ...MENU_STYLE_DEFAULTS, fontSize: 12, itemPadding: 2, itemIndent: 4, width: 200, radius: 3, iconSize: 14, iconGap: 5, shadow: "soft" as const };
		const c = { background: "#111", text: "#222", hover: "#333", border: "#444" };
		expect(menuStyleProps({ ...all, light: c, dark: c }).classes.sort()).toEqual([...ALL_MENU_CLASSES].sort());
		expect(ALL_MENU_VARS).toContain("--opc-ms-light-border");
	});
});
