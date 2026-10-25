/**
 * The little markup tutorial texts use: **bold**, `Key` (shown as a key cap) and blank lines
 * between paragraphs. Built with DOM nodes, never innerHTML.
 */
export function renderRich(el: HTMLElement, text: string): void {
	for (const para of text.split(/\n\s*\n/)) {
		const p = el.createEl("p");
		for (const part of para.split(/(\*\*[^*]+\*\*|`[^`]+`)/)) {
			if (!part) continue;
			if (part.startsWith("**") && part.endsWith("**")) p.createEl("strong", { text: part.slice(2, -2) });
			else if (part.startsWith("`") && part.endsWith("`")) for (const [i, key] of part.slice(1, -1).split("+").entries()) {
				if (i > 0) p.appendText("+");
				p.createEl("kbd", { text: key });
			}
			else p.appendText(part.replace(/\n/g, " "));
		}
	}
}

/** The text with the markup removed (for search and tooltips). */
export function plainText(text: string): string {
	return text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
}
