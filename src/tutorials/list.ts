/**
 * The list of tutorials: cards with an icon, a summary, the step count and whether it's done.
 * Shown at the top of the settings tab and in a modal (command, canvas controls).
 */
import { Modal, SearchComponent, setIcon, type App } from "obsidian";
import type { ModuleManager } from "../core/module-manager";
import type { I18nKey, Translate } from "../i18n";
import { en } from "../i18n/locales/en";
import { matches, normalize, queryWords } from "../settings/search";
import { plainText } from "./rich";
import type { TutorialDefinition } from "./types";

export interface TutorialListHost {
	readonly app: App;
	readonly modules: ModuleManager;
	readonly catalog: readonly TutorialDefinition[];
	t(): Translate;
	isDone(id: string): boolean;
	/** Starts a tutorial (after the caller closed whatever showed the list). */
	start(def: TutorialDefinition): void;
	/** Ends the running tutorial, if any (its practice files are deleted). */
	stop(): Promise<void>;
}

/**
 * What a tutorial is found by: its number, title, summary, step titles and the names of its
 * features, in the current language and in English.
 */
function searchTextOf(def: TutorialDefinition, index: number, host: TutorialListHost): string {
	const t = host.t();
	const keys: I18nKey[] = [def.title, def.summary, ...def.steps.map((s) => s.title)];
	for (const id of def.modules) {
		const name = host.modules.get(id)?.name;
		if (name) keys.push(name as I18nKey);
	}
	return normalize([String(index + 1), ...keys.flatMap((k) => [plainText(t(k)), plainText(en[k] ?? "")])].join(" | "));
}

/**
 * Renders the list; the returned function filters the cards (an empty query shows them all).
 * With `search`, a search box above the cards calls it.
 */
export function renderTutorialList(el: HTMLElement, host: TutorialListHost, beforeStart: () => void = () => {}, search = false): (query: string) => number {
	const t = host.t();
	const done = host.catalog.filter((d) => host.isDone(d.id)).length;
	const head = el.createDiv({ cls: "opc-tutorials-progress" });
	head.createSpan({ text: t("tutorial.progress", { n: done, total: host.catalog.length }) });
	const bar = head.createDiv({ cls: "opc-tutorials-progress-bar" });
	bar.createDiv().setCssProps({ "--opc-progress": `${(done / host.catalog.length) * 100}%` });

	const box = search ? new SearchComponent(el.createDiv({ cls: "opc-tutorials-search" })).setPlaceholder(t("tutorial.search")) : null;
	const grid = el.createDiv({ cls: "opc-tutorials-grid" });
	const empty = el.createDiv({ cls: "opc-tutorials-empty", text: t("tutorial.noMatch") });
	empty.hide();
	const cards: { el: HTMLElement; text: string }[] = [];
	const filter = (query: string) => {
		const words = queryWords(query);
		let shown = 0;
		for (const card of cards) {
			const match = matches(words, card.text);
			card.el.toggle(match);
			if (match) shown++;
		}
		empty.toggle(shown === 0);
		return shown;
	};
	box?.onChange(filter);
	host.catalog.forEach((def, i) => {
		const finished = host.isDone(def.id);
		const item = grid.createEl("button", { cls: "opc-tutorials-card", attr: { "aria-label": t(def.title) } });
		cards.push({ el: item, text: searchTextOf(def, i, host) });
		item.toggleClass("is-done", finished);
		const top = item.createDiv({ cls: "opc-tutorials-card-top" });
		const icon = top.createDiv({ cls: "opc-tutorials-card-icon" });
		setIcon(icon, def.icon);
		top.createSpan({ cls: "opc-tutorials-card-number", text: String(i + 1) });
		if (finished) {
			const badge = top.createSpan({ cls: "opc-tutorials-card-badge" });
			setIcon(badge.createSpan(), "check");
			badge.createSpan({ text: t("tutorial.doneBadge") });
		}
		item.createDiv({ cls: "opc-tutorials-card-title", text: t(def.title) });
		item.createDiv({ cls: "opc-tutorials-card-summary", text: t(def.summary) });
		const foot = item.createDiv({ cls: "opc-tutorials-card-foot" });
		foot.createSpan({ text: t("tutorial.steps", { n: def.steps.length }) });
		const off = def.modules.filter((id) => host.modules.status(id) === "disabled").map((id) => {
			const m = host.modules.get(id);
			return m ? t(m.name) : id;
		});
		if (off.length > 0) foot.createSpan({ cls: "opc-tutorials-card-note", text: t("tutorial.turnsOn", { modules: off.join(", ") }) });
		const go = foot.createSpan({ cls: "opc-tutorials-card-go" });
		go.createSpan({ text: t(finished ? "tutorial.again" : "tutorial.start") });
		setIcon(go.createSpan(), "arrow-right");
		item.addEventListener("click", () => {
			beforeStart();
			host.start(def);
		});
	});
	if (box) window.setTimeout(() => box.inputEl.focus());
	return filter;
}

export class TutorialListModal extends Modal {
	constructor(
		app: App,
		private readonly host: TutorialListHost,
	) {
		super(app);
	}

	override onOpen(): void {
		const t = this.host.t();
		this.modalEl.addClass("opc-tutorials-modal");
		this.setTitle(t("tutorial.heading"));
		this.contentEl.createDiv({ cls: "opc-tutorials-intro", text: t("tutorial.intro") });
		renderTutorialList(this.contentEl, this.host, () => this.close(), true);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
