/**
 * A card's text shown as a one-line title outside the card (the table of contents' title, the
 * pages bar and index, text pages' links): its first line, rendered by Obsidian's own Markdown
 * renderer like the card itself (highlights and text colors the plugin writes as HTML, ==marks==,
 * bold, links, emoji…), on one line, cut with an ellipsis. Never the raw Markdown or HTML.
 */
import { Component, MarkdownRenderer, type App } from "obsidian";
import { escapeMarkdown, plainTitle, titleMarkdown } from "./title-text";

export { escapeMarkdown, plainTitle, titleMarkdown };

/** Characters that may need rendering; a title without any is shown as it is. */
const NEEDS_RENDER = /[<>*_~=`[\]$\\&#%^|]/;

/**
 * Shows `markdown` (one line, see titleMarkdown) in `el` as a formatted title. The plain text is
 * shown at once (it takes the same room), the formatted one replaces it once rendered.
 */
export function renderTitle(app: App, el: HTMLElement, markdown: string, sourcePath: string): void {
	el.addClass("opc-title");
	// Its own text's direction, as on the card (the bar or list it is in may run the other way).
	el.setAttr("dir", "auto");
	el.setText(plainTitle(markdown));
	el.dataset.opcTitle = markdown;
	if (!NEEDS_RENDER.test(markdown)) return;
	const holder = createDiv();
	const owner = new Component();
	owner.load();
	MarkdownRenderer.render(app, markdown, holder, sourcePath, owner)
		.then(() => {
			// Re-rendered meanwhile.
			if (el.dataset.opcTitle !== markdown) return;
			const block = holder.firstElementChild;
			const nodes = block && holder.childElementCount === 1 && /^(P|H[1-6])$/.test(block.tagName) ? Array.from(block.childNodes) : Array.from(holder.childNodes);
			if (!nodes.length) return;
			el.empty();
			for (const node of nodes) el.appendChild(node);
			// The title is part of a control (a crumb, a page in a list): its links don't take the press.
			el.querySelectorAll("a").forEach((a) => a.setAttr("tabindex", "-1"));
		})
		.catch(() => {
			// The plain text stays.
		})
		.finally(() => owner.unload());
}

/** A card's first line as a formatted title (see renderTitle). */
export function renderCardTitle(app: App, el: HTMLElement, text: string, sourcePath: string): void {
	renderTitle(app, el, titleMarkdown(text), sourcePath);
}
