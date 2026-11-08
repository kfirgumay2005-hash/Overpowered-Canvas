import { describe, expect, it } from "vitest";
import { cleanColor, isThemeDefault, MENU_STYLE_DEFAULTS, menuCss, sanitizeMenuStyle } from "./logic";

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

describe("menuCss", () => {
	it("writes nothing for the theme's own look", () => {
		expect(menuCss(MENU_STYLE_DEFAULTS, [{ body: "", menu: ".menu" }])).toBe("");
		expect(isThemeDefault(MENU_STYLE_DEFAULTS)).toBe(true);
	});
	it("writes only what changed, per theme for colors", () => {
		const css = menuCss({ ...MENU_STYLE_DEFAULTS, fontSize: 16, width: 260, dark: { background: "#101010", text: "", hover: "#333333", border: "" } }, [{ body: ".x", menu: ".menu.y" }]);
		expect(css).toContain("body.x .menu.y { font-size: 16px; }");
		expect(css).toContain("body.x:not(.is-phone) .menu.y { min-width: 260px; }");
		expect(css).toContain("body.x.theme-dark .menu.y { background-color: #101010; }");
		expect(css).toContain("body.x.theme-dark .menu.y .menu-item:not(.is-disabled):not(.is-label):hover, body.x.theme-dark .menu.y .menu-item.selected:not(.is-disabled):not(.is-label) { background-color: #333333; }");
		expect(css).not.toContain("theme-light");
		expect(isThemeDefault({ ...MENU_STYLE_DEFAULTS, fontSize: 16 })).toBe(false);
	});
	it("applies to every selector of a list", () => {
		const css = menuCss({ ...MENU_STYLE_DEFAULTS, radius: 4 }, [{ body: ".a", menu: ".menu.c" }, { body: ".a.b", menu: ".menu" }]);
		expect(css).toBe("body.a .menu.c, body.a.b .menu { border-radius: 4px; }");
	});
});
