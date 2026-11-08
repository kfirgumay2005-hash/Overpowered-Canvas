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

/** Prefix of the body classes and CSS variables that switch the style on (styles.css). */
const P = "opc-ms";

const NUMBER_FLAGS: Record<NumberKey, string> = {
	fontSize: "font",
	itemPadding: "pad",
	itemIndent: "indent",
	width: "width",
	radius: "radius",
	iconSize: "icon",
	iconGap: "gap",
};
const COLOR_FLAGS: Record<keyof MenuColors, string> = { background: "bg", text: "text", hover: "hover", border: "border" };

/** Every body class the style may set (to remove them all when the module stops or a value resets). */
export const ALL_MENU_CLASSES: readonly string[] = [
	...Object.values(NUMBER_FLAGS).map((f) => `${P}-${f}`),
	`${P}-shadow`,
	...(["light", "dark"] as const).flatMap((mode) => Object.values(COLOR_FLAGS).map((f) => `${P}-${mode}-${f}`)),
];
/** Every CSS variable the style may set (same names as the classes, as `--` variables). */
export const ALL_MENU_VARS: readonly string[] = ALL_MENU_CLASSES.map((c) => `--${c}`);

/**
 * What a body gets for these settings: a class per changed value (styles.css applies it to the
 * menus) and the value itself as a CSS variable. Nothing for the theme's own look.
 */
export function menuStyleProps(s: MenuStyleSettings): { classes: string[]; vars: Record<string, string> } {
	const classes: string[] = [];
	const vars: Record<string, string> = {};
	const put = (flag: string, value: string) => {
		classes.push(`${P}-${flag}`);
		vars[`--${P}-${flag}`] = value;
	};
	for (const key of Object.keys(NUMBER_FLAGS) as NumberKey[]) if (s[key] >= 0) put(NUMBER_FLAGS[key], `${s[key]}px`);
	if (s.shadow !== "theme") put("shadow", SHADOW_CSS[s.shadow]);
	for (const mode of ["light", "dark"] as const)
		for (const key of Object.keys(COLOR_FLAGS) as (keyof MenuColors)[]) if (s[mode][key]) put(`${mode}-${COLOR_FLAGS[key]}`, s[mode][key]);
	return { classes, vars };
}
