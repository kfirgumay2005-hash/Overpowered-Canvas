import { setIcon, setTooltip } from "obsidian";
import type { Translate } from "../../i18n";
import { onPress } from "../../ui/press";
import type { PagesSource } from "./api";
import { pagePath } from "./logic";

/** Fills the bar that shows where you are: the index button, then main page › page › page. */
export function renderPagesBar(bar: HTMLElement, source: PagesSource, t: Translate, openIndex: () => void, crumbs = true): void {
	bar.empty();
	const index = bar.createEl("button", { cls: "clickable-icon opc-pages-index", attr: { "aria-label": t("pages.index.open") } });
	setIcon(index, "list-tree");
	setTooltip(index, t("pages.index.open"));
	onPress(index, openIndex);
	const page = source.current();
	const path = [{ id: "" }, ...pagePath(source.pages(), page)];
	(crumbs ? path : path.slice(0, 1)).forEach((c, i) => {
		if (i > 0) bar.createSpan({ cls: "opc-pages-sep", text: "›" });
		const el = bar.createEl("button", { cls: "opc-pages-crumb", text: source.title(c.id) });
		el.toggleClass("is-current", c.id === page);
		onPress(el, () => source.show(c.id));
	});
}
