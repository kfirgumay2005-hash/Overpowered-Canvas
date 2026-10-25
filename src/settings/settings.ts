/**
 * Plugin settings (data.json). Pure functions only — unit-tested.
 * Unknown module entries are kept, so downgrading the plugin never loses a module's settings.
 */
import type { LanguageSetting } from "../i18n";
import { isPlainObject } from "../data/validate";

export const SETTINGS_VERSION = 1;

export interface ModuleState {
	enabled: boolean;
	settings: Record<string, unknown>;
}

export interface PluginSettings {
	settingsVersion: number;
	language: LanguageSetting;
	modules: Record<string, ModuleState>;
	coexistence: {
		/** Overlapping plugin ids whose notice the user has already answered. */
		acknowledged: string[];
	};
	tutorials: {
		/** Ids of the tutorials finished at least once. */
		done: string[];
	};
}

export function defaultSettings(): PluginSettings {
	return { settingsVersion: SETTINGS_VERSION, language: "auto", modules: {}, coexistence: { acknowledged: [] }, tutorials: { done: [] } };
}

const LANGUAGES: readonly LanguageSetting[] = ["auto", "en", "zh", "ja", "hi"];

export function sanitizeSettings(raw: unknown): PluginSettings {
	const out = defaultSettings();
	if (!isPlainObject(raw)) return out;

	if (typeof raw.language === "string" && (LANGUAGES as readonly string[]).includes(raw.language))
		out.language = raw.language as LanguageSetting;

	if (isPlainObject(raw.modules)) {
		for (const [id, entry] of Object.entries(raw.modules)) {
			if (!isPlainObject(entry)) continue;
			out.modules[id] = {
				enabled: typeof entry.enabled === "boolean" ? entry.enabled : false,
				settings: isPlainObject(entry.settings) ? { ...entry.settings } : {},
			};
		}
	}

	if (isPlainObject(raw.coexistence) && Array.isArray(raw.coexistence.acknowledged))
		out.coexistence.acknowledged = raw.coexistence.acknowledged.filter((x): x is string => typeof x === "string");

	if (isPlainObject(raw.tutorials) && Array.isArray(raw.tutorials.done))
		out.tutorials.done = [...new Set(raw.tutorials.done.filter((x): x is string => typeof x === "string"))];

	return out;
}

/**
 * Default sanitizer for a module's settings: every key of `defaults` takes the stored value
 * when it has the same JSON type, otherwise the default. Keys not in `defaults` are dropped.
 */
export function mergeWithDefaults<S extends object>(stored: unknown, defaults: S): S {
	const out = { ...defaults } as Record<string, unknown>;
	if (!isPlainObject(stored)) return out as S;
	for (const [key, def] of Object.entries(defaults)) {
		const value = stored[key];
		if (value === undefined || jsonType(value) !== jsonType(def)) continue;
		out[key] = isPlainObject(def) ? mergeWithDefaults(value, def) : Array.isArray(value) ? [...(value as unknown[])] : value;
	}
	return out as S;
}

function jsonType(value: unknown): string {
	if (value === null) return "null";
	if (Array.isArray(value)) return "array";
	if (typeof value === "number" && !Number.isFinite(value)) return "invalid";
	return typeof value;
}
