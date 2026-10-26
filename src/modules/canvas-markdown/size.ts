/**
 * Size of a new text card from its text (pure). A rough estimate, close enough for layout: the
 * card is as wide as its longest line (up to `maxWidth`) and as tall as its wrapped lines.
 */
const CHAR = 9;
const LINE = 26;
const PAD_X = 56;
const PAD_Y = 34;

export function estimateSize(text: string, maxWidth: number): { width: number; height: number } {
	const lines = text.split("\n");
	const longest = Math.max(0, ...lines.map((l) => [...l].length));
	const width = Math.round(Math.min(maxWidth, Math.max(120, longest * CHAR + PAD_X)));
	const perLine = Math.max(1, Math.floor((width - PAD_X) / CHAR));
	const rows = lines.reduce((sum, l) => sum + Math.max(1, Math.ceil([...l].length / perLine)), 0);
	return { width, height: Math.round(Math.max(60, rows * LINE + PAD_Y)) };
}
