import type { GuideData } from "../../data/schema";

/** The selectable handle of a line (a small invisible card on the line). */
export const HANDLE_LONG = 160;
export const HANDLE_SHORT = 24;
/** Handle of a slanted line: square, so the dashed selection box looks the same at any angle. */
export const HANDLE_SQUARE = 48;

/** Any angle in degrees → [0, 180): an infinite line looks the same turned by half a turn. */
export function normalizeAngle(deg: number): number {
	if (!Number.isFinite(deg)) return 0;
	const a = ((deg % 180) + 180) % 180;
	// Snap float noise (179.9999…, 1e-13) so 0 and 90 stay exact.
	const r = Math.round(a * 1000) / 1000;
	return r >= 180 ? 0 : r;
}

export function angleOf(guide: GuideData): number {
	return guide.angle ?? (guide.axis === "v" ? 90 : 0);
}

/** The guide for an angle; `axis` keeps the nearest of horizontal / vertical for older readers. */
export function withAngle(guide: GuideData, deg: number): GuideData {
	const angle = normalizeAngle(deg);
	const axis = angle >= 45 && angle < 135 ? "v" : "h";
	const next: GuideData = { ...guide, axis };
	if (angle === 0 || angle === 90) delete next.angle;
	else next.angle = angle;
	return next;
}

export function handleSize(angle: number): { width: number; height: number } {
	if (angle === 0) return { width: HANDLE_LONG, height: HANDLE_SHORT };
	if (angle === 90) return { width: HANDLE_SHORT, height: HANDLE_LONG };
	return { width: HANDLE_SQUARE, height: HANDLE_SQUARE };
}

/** The point of the line through `center` at `angle` nearest to `p`. */
export function projectOnLine(center: { x: number; y: number }, angle: number, p: { x: number; y: number }): { x: number; y: number } {
	const rad = (angle * Math.PI) / 180;
	const dx = Math.cos(rad);
	const dy = Math.sin(rad);
	const t = (p.x - center.x) * dx + (p.y - center.y) * dy;
	return { x: center.x + t * dx, y: center.y + t * dy };
}
