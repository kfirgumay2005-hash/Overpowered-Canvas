import { setIcon, setTooltip, type App } from "obsidian";
import { renderTitle } from "../../ui/card-title";
import type { Translate } from "../../i18n";
import { navControl } from "../../ui/nav-controls";
import type { PagesSource } from "./api";
import { pagePath } from "./logic";

/**
 * Fills the bar that shows where you are: the index button, then main page › page › page. The
 * same on a board, in a note with pages and in text pages; presses go through navControl.
 */
export function renderPagesBar(app: App, bar: HTMLElement, source: PagesSource, t: Translate, openIndex: () => void, crumbs = true): void {
	bar.empty();
	const index = bar.createEl("button", { cls: "clickable-icon opc-pages-index", attr: { "aria-label": t("pages.index.open") } });
	setIcon(index, "list-tree");
	setTooltip(index, t("pages.index.open"));
	navControl(index, openIndex);
	const page = source.current();
	const path = [{ id: "" }, ...pagePath(source.pages(), page)];
	(crumbs ? path : path.slice(0, 1)).forEach((c, i) => {
		if (i > 0) bar.createSpan({ cls: "opc-pages-sep", text: "›" });
		const el = bar.createEl("button", { cls: "opc-pages-crumb" });
		// The page's title formatted as on its card (highlights, colors, emoji), never raw Markdown.
		renderTitle(app, el.createSpan({ cls: "opc-pages-crumb-text" }), source.title(c.id), source.path ?? "");
		el.toggleClass("is-current", c.id === page);
		navControl(el, () => source.show(c.id));
	});
}
