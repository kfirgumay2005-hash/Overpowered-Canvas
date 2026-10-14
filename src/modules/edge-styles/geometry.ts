/** Arrowhead shapes shared by edges and free lines. */
import type { ArrowStyle } from "../../data/schema";

/**
 * Arrowheads in the core's local frame: tip at (0,0), body along +y (away from the node),
 * core triangle is 13 wide and 10.4 long.
 */
export const ARROW_GEOMETRY: Record<Exclude<ArrowStyle, "none">, { d: string; filled: boolean }> = {
	triangle: { d: "M0 0 L6.5 10.4 L-6.5 10.4 Z", filled: true },
	"triangle-outline": { d: "M0 0 L6.5 10.4 L-6.5 10.4 Z", filled: false },
	"halved-triangle": { d: "M0 0 L6.5 10.4 L0 10.4 Z", filled: true },
	"thin-triangle": { d: "M-6.5 10.4 L0 0 L6.5 10.4", filled: false },
	diamond: { d: "M0 0 L5.5 7.5 L0 15 L-5.5 7.5 Z", filled: true },
	"diamond-outline": { d: "M0 0 L5.5 7.5 L0 15 L-5.5 7.5 Z", filled: false },
	circle: { d: "M0 0 A5.5 5.5 0 1 1 0 11 A5.5 5.5 0 1 1 0 0 Z", filled: true },
	"circle-outline": { d: "M0 0 A5.5 5.5 0 1 1 0 11 A5.5 5.5 0 1 1 0 0 Z", filled: false },
	blunted: { d: "M-6.5 0 L6.5 0 L6.5 2.5 L-6.5 2.5 Z", filled: true },
};

export function arrowPreview(style: ArrowStyle): string {
	if (style === "none") return `<svg viewBox="0 0 26 16" width="26" height="16"><path d="M3 8 L23 8" stroke="currentColor" stroke-width="1.6"/></svg>`;
	const g = ARROW_GEOMETRY[style];
	return `<svg viewBox="0 0 26 16" width="26" height="16"><path d="M3 8 L14 8" stroke="currentColor" stroke-width="1.6"/><g transform="translate(23 8) rotate(90)"><path d="${g.d}" fill="${g.filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></g></svg>`;
}
