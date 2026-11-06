/**
 * Debug mode (a global setting, off by default): short messages on screen about what the plugin
 * did with a press, for devices without developer tools (a tablet). Kept in the plugin on purpose,
 * for checking future reports.
 */
import { Notice } from "obsidian";
import type { I18nKey, I18nVars, Translate } from "../i18n";

let on = false;
let translate: Translate | null = null;

export function configureDebug(enabled: boolean, t: Translate): void {
	on = enabled;
	translate = t;
}

export function debugMode(): boolean {
	return on;
}

/** Shows a debug message (only in debug mode). */
export function debugNotice(key: I18nKey, vars?: I18nVars): void {
	if (!on || !translate) return;
	// Click-through: these sit over the top corner (the bars' buttons) and fade on their own.
	new Notice(translate(key, vars), 5000).containerEl.addClass("opc-debug-notice");
}

/** A translated debug string, for building a message ("" outside debug mode). */
export function debugText(key: I18nKey, vars?: I18nVars): string {
	return on && translate ? translate(key, vars) : "";
}

/** A short description of an element for debug messages: tag and first classes. */
export function describeElement(el: Element | null): string {
	if (!el) return "—";
	const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
	return el.tagName.toLowerCase() + (cls.length ? "." + cls.join(".") : "");
}
