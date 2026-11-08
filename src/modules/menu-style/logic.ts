/**
 * Right-click menu style: settings and the CSS made from them. Pure (unit-tested).
 * A value of -1 (numbers) or "" (colors), and "theme" for the shadow, keeps the theme's own look,
 * so only what the user changed is written: menus of every theme and plugin keep the rest.
 */

export interface MenuColors {
	background: string;
	text: string;
	hover: string;
	border: string;
}

export interface MenuStyleSettings {
	fontSize: number;
	/** Vertical padding of an item (spacing between items), px. */
	itemPadding: number;
	/** Horizontal padding of an item, px. */
	itemIndent: number;
	/** Minimum width, px. */
	width: number;
	radius: number;
	iconSize: number;
	/** Gap between the icon and the text, px. */
	iconGap: number;
	shadow: "theme" | "none" | "soft" | "strong";
	/** Colors in light mode and in dark mode (a color for one would be wrong in the other). */
	light: MenuColors;
	dark: MenuColors;
}

const NO_COLORS: MenuColors = { background: "", text: "", hover: "", border: "" };

export const MENU_STYLE_DEFAULTS: MenuStyleSettings = {
	fontSize: -1,
	itemPadding: -1,
	itemIndent: -1,
	width: -1,
	radius: -1,
	iconSize: -1,
	iconGap: -1,
	shadow: "theme",
	light: { ...NO_COLORS },
	dark: { ...NO_COLORS },
};

/** Allowed range of each number (inclusive); -1 is always allowed (theme default). */
export const LIMITS = {
	fontSize: [10, 28],
	itemPadding: [0, 20],
	itemIndent: [2, 32],
	width: [120, 480],
	radius: [0, 24],
	iconSize: [10, 32],
	iconGap: [0, 24],
} as const;

export type NumberKey = keyof typeof LIMITS;

const SHADOWS = ["theme", "none", "soft", "strong"] as const;

function cleanNumber(value: unknown, [min, max]: readonly [number, number]): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value === -1) return -1;
	return Math.min(max, Math.max(min, Math.round(value)));
}

/** A CSS color the settings accept: #rgb, #rrggbb or #rrggbbaa; anything else means "theme". */
export function cleanColor(value: unknown): string {
	return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim()) ? value.trim().toLowerCase() : "";
}

function cleanColors(raw: unknown): MenuColors {
	const r = (raw && typeof raw === "object" ? raw : {}) as Partial<Record<keyof MenuColors, unknown>>;
	return { background: cleanColor(r.background), text: cleanColor(r.text), hover: cleanColor(r.hover), border: cleanColor(r.border) };
}

export function sanitizeMenuStyle(raw: unknown): MenuStyleSettings {
	const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const out: MenuStyleSettings = { ...MENU_STYLE_DEFAULTS, light: cleanColors(r.light), dark: cleanColors(r.dark) };
	for (const key of Object.keys(LIMITS) as NumberKey[]) out[key] = cleanNumber(r[key], LIMITS[key]);
	out.shadow = (SHADOWS as readonly string[]).includes(r.shadow as string) ? (r.shadow as MenuStyleSettings["shadow"]) : "theme";
	return out;
}

/** True when nothing differs from the theme (no CSS needed). */
export function isThemeDefault(s: MenuStyleSettings): boolean {
	return JSON.stringify(s) === JSON.stringify(MENU_STYLE_DEFAULTS);
}

const SHADOW_CSS: Record<Exclude<MenuStyleSettings["shadow"], "theme">, string> = {
	none: "none",
	soft: "0 2px 8px rgba(0, 0, 0, 0.15)",
	strong: "0 8px 28px rgba(0, 0, 0, 0.35)",
};

/** Which menus get the style: menus under a body with `body` classes, matching `menu`. */
export interface MenuScope {
	body: string;
	menu: string;
}

/** The CSS for styled menus. Mobile menus (sheets from the bottom) keep their own width. */
export function menuCss(s: MenuStyleSettings, scopes: readonly MenuScope[]): string {
	const rules: string[] = [];
	const rule = (selector: string, decls: (string | false)[]) => {
		const list = decls.filter((d): d is string => !!d);
		if (list.length) rules.push(`${selector} { ${list.join("; ")}; }`);
	};
	const px = (n: number) => `${n}px`;
	/** `body<classes><extra> <menu><suffix>` for every scope. */
	const sel = (suffix = "", extra = "") => scopes.map((sc) => `body${sc.body}${extra} ${sc.menu}${suffix}`).join(", ");

	rule(sel(), [s.fontSize >= 0 && `font-size: ${px(s.fontSize)}`, s.radius >= 0 && `border-radius: ${px(s.radius)}`, s.shadow !== "theme" && `box-shadow: ${SHADOW_CSS[s.shadow]}`]);
	rule(sel("", ":not(.is-phone)"), [s.width >= 0 && `min-width: ${px(s.width)}`]);
	rule(sel(" .menu-item"), [
		s.fontSize >= 0 && `font-size: ${px(s.fontSize)}`,
		s.itemPadding >= 0 && `padding-top: ${px(s.itemPadding)}`,
		s.itemPadding >= 0 && `padding-bottom: ${px(s.itemPadding)}`,
		s.itemIndent >= 0 && `padding-inline: ${px(s.itemIndent)}`,
		s.iconGap >= 0 && `gap: ${px(s.iconGap)}`,
	]);
	rule(sel(" .menu-item-icon"), [s.iconSize >= 0 && `--icon-size: ${px(s.iconSize)}`, s.iconSize >= 0 && `width: ${px(s.iconSize)}`, s.iconGap >= 0 && `margin-inline-end: 0`]);
	rule(sel(" .menu-item-icon .svg-icon"), [s.iconSize >= 0 && `width: ${px(s.iconSize)}`, s.iconSize >= 0 && `height: ${px(s.iconSize)}`]);
	for (const [mode, c] of [
		[".theme-light", s.light],
		[".theme-dark", s.dark],
	] as const) {
		rule(sel("", mode), [c.background && `background-color: ${c.background}`, c.border && `border-color: ${c.border}`, c.text && `color: ${c.text}`]);
		// Warning items (Delete, Remove…) keep their color.
		rule(sel(" .menu-item:not(.is-disabled):not(.is-label):not(.is-warning)", mode), [c.text && `color: ${c.text}`]);
		rule(sel(" .menu-item:not(.is-warning) .menu-item-icon", mode), [c.text && `color: ${c.text}`]);
		rule(sel(" .menu-separator", mode), [c.border && `border-color: ${c.border}`, c.border && `background-color: ${c.border}`]);
		rule(`${sel(" .menu-item:not(.is-disabled):not(.is-label):hover", mode)}, ${sel(" .menu-item.selected:not(.is-disabled):not(.is-label)", mode)}`, [c.hover && `background-color: ${c.hover}`]);
	}
	return rules.join("\n");
}
