import { en, type I18nKey } from "./locales/en";
import { he } from "./locales/he";

export type { I18nKey };
export type Locale = "en" | "he";
export type LanguageSetting = "auto" | Locale;
export type I18nVars = Readonly<Record<string, string | number>>;
export type Translate = (key: I18nKey, vars?: I18nVars) => string;

export const LOCALES: Readonly<Record<Locale, Readonly<Record<I18nKey, string>>>> = { en, he };

/** Picks the UI locale: an explicit setting wins, otherwise follow Obsidian's language. */
export function resolveLocale(setting: LanguageSetting, obsidianLanguage: string): Locale {
	if (setting !== "auto") return setting;
	const base = obsidianLanguage.toLowerCase().split(/[-_]/)[0];
	return base === "he" || base === "iw" ? "he" : "en";
}

/** Replaces {name} placeholders. Unknown placeholders are left as-is so mistakes stay visible. */
export function interpolate(template: string, vars?: I18nVars): string {
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) =>
		Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
	);
}

export function createTranslator(locale: Locale): Translate {
	const table = LOCALES[locale];
	return (key, vars) => interpolate(table[key] ?? en[key] ?? key, vars);
}

/** Text direction of a locale, for UI we build ourselves. */
export function localeDirection(locale: Locale): "ltr" | "rtl" {
	return locale === "he" ? "rtl" : "ltr";
}
