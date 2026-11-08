/**
 * The emoji picker's content (shown in a popover above the bottom bar): search, category tabs,
 * recently used, skin tones, and a grid of every emoji. Made for touch too: big targets, tabs
 * that scroll the list, no hover needed.
 */
import { Platform, setIcon, setTooltip } from "obsidian";
import type { Translate, I18nKey } from "../../i18n";
import { CATEGORIES, searchEmoji, TONES, withTone, type Emoji, type Tone } from "./logic";

export interface PanelHost {
	t: Translate;
	emoji: readonly Emoji[];
	recent(): readonly string[];
	tone(): Tone;
	setTone(tone: Tone): void;
	/** Inserts the emoji (with its tone already applied). */
	pick(emoji: string): void;
}

const CLS = "opc-emoji";
/** A hand to show the chosen skin tone on the tone button. */
const TONE_SAMPLE = ["✋", "✋🏻", "✋🏼", "✋🏽", "✋🏾", "✋🏿"];

export class EmojiPanel {
	private readonly el: HTMLElement;
	private readonly search: HTMLInputElement;
	private readonly scroll: HTMLElement;
	private readonly tabs = new Map<string, HTMLElement>();
	private readonly sections = new Map<string, HTMLElement>();
	private readonly toned: { button: HTMLElement; e: Emoji }[] = [];
	private readonly preview: HTMLElement;
	private toneButton!: HTMLElement;
	private tonesRow!: HTMLElement;
	private resultsEl: HTMLElement | null = null;
	private searchTimer = 0;
	/** Buttons → their emoji, for the one click listener of the grid. */
	private readonly byButton = new WeakMap<HTMLElement, { e: Emoji | null; text: string }>();

	constructor(
		parent: HTMLElement,
		private readonly host: PanelHost,
	) {
		const t = host.t;
		this.el = parent.createDiv({ cls: CLS });
		const top = this.el.createDiv({ cls: `${CLS}-top` });
		const box = top.createDiv({ cls: "search-input-container" });
		this.search = box.createEl("input", { type: "search", attr: { placeholder: t("emojiPicker.search"), "aria-label": t("emojiPicker.search"), spellcheck: "false" } });
		this.search.addEventListener("input", () => {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = window.setTimeout(() => this.runSearch(), 90);
		});
		this.search.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter") return;
			evt.preventDefault();
			const first = this.resultsEl?.querySelector<HTMLElement>(`.${CLS}-item`);
			if (first) this.choose(first);
		});
		this.renderTones(top);
		this.renderTabs();
		this.scroll = this.el.createDiv({ cls: `${CLS}-scroll` });
		this.preview = this.el.createDiv({ cls: `${CLS}-preview` });
		this.renderAll();
		this.scroll.addEventListener("click", (evt) => {
			const button = (evt.target as HTMLElement).closest<HTMLElement>(`.${CLS}-item`);
			if (button) this.choose(button);
		});
		const show = (evt: Event) => {
			const button = (evt.target as HTMLElement).closest<HTMLElement>(`.${CLS}-item`);
			if (button) this.showPreview(button);
		};
		this.scroll.addEventListener("pointerover", show);
		this.scroll.addEventListener("focusin", show);
		this.scroll.addEventListener("scroll", () => this.markTab(), { passive: true });
		// On a phone the keyboard would cover half of the picker: search only when tapped.
		if (!Platform.isMobile) window.setTimeout(() => this.search.focus(), 0);
	}

	private renderTones(parent: HTMLElement): void {
		const t = this.host.t;
		this.toneButton = parent.createEl("button", { cls: `clickable-icon ${CLS}-tone-button`, attr: { "aria-label": t("emojiPicker.tone") } });
		this.toneButton.setText(TONE_SAMPLE[this.host.tone()]!);
		setTooltip(this.toneButton, t("emojiPicker.tone"));
		this.tonesRow = this.el.createDiv({ cls: `${CLS}-tones is-hidden`, attr: { role: "radiogroup", "aria-label": t("emojiPicker.tone") } });
		for (const tone of TONES) {
			const b = this.tonesRow.createEl("button", { cls: `clickable-icon ${CLS}-tone`, text: TONE_SAMPLE[tone], attr: { role: "radio", "aria-label": t(`emojiPicker.tone.${tone}` as I18nKey) } });
			b.toggleClass("is-active", tone === this.host.tone());
			b.addEventListener("click", () => {
				this.host.setTone(tone);
				this.tonesRow.querySelectorAll(`.${CLS}-tone`).forEach((x, i) => x.toggleClass("is-active", i === tone));
				this.toneButton.setText(TONE_SAMPLE[tone]!);
				this.tonesRow.addClass("is-hidden");
				this.applyTone();
			});
		}
		this.toneButton.addEventListener("click", () => this.tonesRow.toggleClass("is-hidden", !this.tonesRow.hasClass("is-hidden")));
	}

	private renderTabs(): void {
		const t = this.host.t;
		const bar = this.el.createDiv({ cls: `${CLS}-tabs`, attr: { role: "tablist" } });
		const tab = (id: string, icon: string) => {
			const label = t(`emojiPicker.cat.${id}` as I18nKey);
			const b = bar.createEl("button", { cls: `clickable-icon ${CLS}-tab`, attr: { role: "tab", "aria-label": label, "data-cat": id } });
			setIcon(b, icon);
			setTooltip(b, label, { placement: "top" });
			b.addEventListener("click", () => {
				if (this.search.value) {
					this.search.value = "";
					this.runSearch();
				}
				const section = this.sections.get(id);
				if (section) this.scroll.scrollTo({ top: section.offsetTop });
				this.markTab(id);
			});
			this.tabs.set(id, b);
		};
		tab("recent", "clock");
		for (const c of CATEGORIES) tab(c.id, c.icon);
	}

	private renderAll(): void {
		const t = this.host.t;
		const recent = this.host.recent();
		this.section("recent", t("emojiPicker.cat.recent"), recent.map((text) => ({ e: this.host.emoji.find((e) => e.char === text || e.tones?.includes(text)) ?? null, text })), recent.length ? undefined : t("emojiPicker.noRecent"));
		const tone = this.host.tone();
		for (const c of CATEGORIES)
			this.section(
				c.id,
				t(`emojiPicker.cat.${c.id}` as I18nKey),
				this.host.emoji.filter((e) => e.group === c.group).map((e) => ({ e, text: withTone(e, tone) })),
			);
		this.markTab("recent");
	}

	private section(id: string, title: string, items: { e: Emoji | null; text: string }[], empty?: string): void {
		const section = this.scroll.createDiv({ cls: `${CLS}-section`, attr: { "data-cat": id } });
		section.createDiv({ cls: `${CLS}-heading`, text: title });
		const grid = section.createDiv({ cls: `${CLS}-grid` });
		if (empty) section.createDiv({ cls: `${CLS}-empty`, text: empty });
		const frag = createFragment();
		for (const item of items) {
			const b = this.item(item);
			frag.appendChild(b);
			// Recent emoji keep the tone they were picked with.
			if (item.e?.tones && id !== "recent") this.toned.push({ button: b, e: item.e });
		}
		grid.appendChild(frag);
		this.sections.set(id, section);
	}

	private item(item: { e: Emoji | null; text: string }): HTMLElement {
		const b = createEl("button", { cls: `${CLS}-item`, text: item.text, attr: { "aria-label": this.labelOf(item.e) || item.text } });
		this.byButton.set(b, item);
		return b;
	}

	private labelOf(e: Emoji | null): string {
		if (!e) return "";
		return e.label2 || e.label;
	}

	private runSearch(): void {
		const q = this.search.value.trim();
		this.resultsEl?.remove();
		this.resultsEl = null;
		this.scroll.toggleClass("is-searching", !!q);
		if (!q) {
			this.markTab();
			return;
		}
		for (const tab of this.tabs.values()) tab.removeClass("is-active");
		const found = searchEmoji(this.host.emoji, q);
		const tone = this.host.tone();
		this.resultsEl = this.scroll.createDiv({ cls: `${CLS}-section ${CLS}-results` });
		this.scroll.prepend(this.resultsEl);
		this.resultsEl.createDiv({ cls: `${CLS}-heading`, text: this.host.t("emojiPicker.results") });
		const grid = this.resultsEl.createDiv({ cls: `${CLS}-grid` });
		for (const e of found) grid.appendChild(this.item({ e, text: withTone(e, tone) }));
		if (!found.length) this.resultsEl.createDiv({ cls: `${CLS}-empty`, text: this.host.t("emojiPicker.none") });
		this.scroll.scrollTop = 0;
	}

	private choose(button: HTMLElement): void {
		const item = this.byButton.get(button);
		if (!item) return;
		this.host.pick(item.text);
		this.refreshRecent();
	}

	private refreshRecent(): void {
		const section = this.sections.get("recent");
		const grid = section?.querySelector(`.${CLS}-grid`);
		if (!section || !grid) return;
		grid.empty();
		section.querySelector(`.${CLS}-empty`)?.remove();
		for (const text of this.host.recent()) grid.appendChild(this.item({ e: this.host.emoji.find((e) => e.char === text || e.tones?.includes(text)) ?? null, text }));
	}

	private applyTone(): void {
		const tone = this.host.tone();
		for (const { button, e } of this.toned) {
			const text = withTone(e, tone);
			button.setText(text);
			this.byButton.set(button, { e, text });
		}
		if (this.search.value.trim()) this.runSearch();
	}

	private showPreview(button: HTMLElement): void {
		const item = this.byButton.get(button);
		if (!item) return;
		this.preview.empty();
		this.preview.createSpan({ cls: `${CLS}-preview-emoji`, text: item.text });
		this.preview.createSpan({ cls: `${CLS}-preview-name`, text: this.labelOf(item.e) });
	}

	/** Highlights the tab of the section at the top of the list. */
	private markTab(force?: string): void {
		let id = force;
		if (!id) {
			const top = this.scroll.scrollTop + 8;
			for (const [cat, section] of this.sections) if (section.offsetTop <= top) id = cat;
		}
		for (const [cat, tab] of this.tabs) tab.toggleClass("is-active", cat === id);
	}
}
