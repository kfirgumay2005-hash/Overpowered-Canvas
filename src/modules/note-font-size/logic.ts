/** Reading and stepping the per-note font size property (pure). */

export const MIN_SIZE = 6;
export const MAX_SIZE = 96;

const clamp = (px: number) => Math.round(Math.max(MIN_SIZE, Math.min(MAX_SIZE, px)) * 100) / 100;

/**
 * The size a property value asks for, in CSS pixels, or null when it isn't a size.
 * Numbers and "18" / "18px" are pixels, "13pt" points, "120%" / "1.2em" / "1.2rem" are relative to
 * the vault's text size (Settings → Appearance → Font size), which is `base`.
 */
export function parseFontSize(raw: unknown, base: number): number | null {
	if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? clamp(raw) : null;
	if (typeof raw !== "string") return null;
	const m = /^\s*(\d+(?:\.\d+)?|\.\d+)\s*(px|pt|%|em|rem)?\s*$/i.exec(raw);
	if (!m) return null;
	const n = Number.parseFloat(m[1]!);
	if (!(n > 0)) return null;
	switch ((m[2] ?? "px").toLowerCase()) {
		case "pt":
			return clamp((n * 4) / 3);
		case "%":
			return clamp((base * n) / 100);
		case "em":
		case "rem":
			return clamp(base * n);
		default:
			return clamp(n);
	}
}

/** The next size one step up or down, on whole steps (17 → 18 → 20 with step 2 goes 17 → 18). */
export function stepFontSize(current: number, step: number, direction: 1 | -1): number {
	const s = step > 0 ? step : 1;
	const snapped = direction > 0 ? Math.floor(current / s + 1e-9) * s + s : Math.ceil(current / s - 1e-9) * s - s;
	return clamp(snapped);
}

/** The property key as typed in settings; falls back to the default when blank. */
export function propertyKey(raw: string, fallback: string): string {
	const key = raw.trim();
	return key || fallback;
}
