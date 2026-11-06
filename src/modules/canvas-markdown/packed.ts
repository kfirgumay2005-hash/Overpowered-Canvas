/**
 * Packed plain notes in reading view (pure, unit-tested).
 *
 * A packed note (see WriteOptions.plain) has no blank line between the lines of a heading:
 *
 *     Esami ematici
 *     - Emocromo
 *     - EGA
 *     Esami delle urine
 *
 * Markdown reads "Esami delle urine" as the continuation of the bullet above it ("EGA"), and two
 * plain lines in a row as one paragraph. In reading view such a block is drawn from a copy with a
 * blank line before each plain line at the start of a line (each its own paragraph), and the
 * block's paragraphs and lists get no margins, so it still reads as one block with no gaps. The
 * note's text stays as written.
 */

const BULLET = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const FENCE = /^[ \t]*(?:`{3,}|~{3,})/;

/** A section of plain lines and bullets only (no heading, code or comment): part of a packed block. */
export function isBlockSection(lines: readonly string[]): boolean {
	return lines.some((l) => l.trim() !== "") && !lines.some((l) => HEADING.test(l) || FENCE.test(l) || l.trimStart().startsWith("%%"));
}

/**
 * The lines of one reading-view section as Markdown that shows each first-level line on its own:
 * a blank line before each plain line at the start of a line that follows another line of the
 * block. Null when nothing needs it, or the block holds code or a comment block.
 */
export function packedSection(lines: readonly string[]): string | null {
	// Code, and the hidden data block (a comment), are left as they are.
	if (lines.some((l) => FENCE.test(l) || l.trimStart().startsWith("%%"))) return null;
	const out: string[] = [];
	let changed = false;
	let previous = false;
	for (const line of lines) {
		const blank = line.trim() === "";
		const plainStart = !blank && !/^[ \t]/.test(line) && !BULLET.test(line) && !HEADING.test(line);
		if (plainStart && previous) {
			out.push("");
			changed = true;
		}
		out.push(line);
		previous = !blank && !HEADING.test(line);
	}
	return changed ? out.join("\n") : null;
}
