import { en, type I18nKey } from "./locales/en";
import { hi } from "./locales/hi";
import { ja } from "./locales/ja";
import { zh } from "./locales/zh";

export type { I18nKey };
export type Locale = "en" | "zh" | "ja" | "hi";
export type LanguageSetting = "auto" | Locale;
export type I18nVars = Readonly<Record<string, string | number>>;
export type Translate = (key: I18nKey, vars?: I18nVars) => string;

export const LOCALE_IDS: readonly Locale[] = ["en", "zh", "ja", "hi"];
export const LOCALES: Readonly<Record<Locale, Readonly<Record<I18nKey, string>>>> = { en, zh, ja, hi };

/** Picks the UI locale: an explicit setting wins, otherwise follow Obsidian's language. */
export function resolveLocale(setting: LanguageSetting, obsidianLanguage: string): Locale {
	if (setting !== "auto") return setting;
	const base = obsidianLanguage.toLowerCase().split(/[-_]/)[0] ?? "";
	return (LOCALE_IDS as readonly string[]).includes(base) ? (base as Locale) : "en";
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
