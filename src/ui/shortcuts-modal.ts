/**
 * The Shortcuts window: every keyboard shortcut of the plugin in one place, searchable, grouped,
 * editable. Two kinds of rows, each kept where it belongs (one source of truth each):
 *
 * - Canvas shortcuts (core/shortcuts/catalog.ts): keys that work inside a canvas, often only in a
 *   situation (a card selected, while drawing, in a presentation). Stored in the plugin's
 *   data.json (`settings.shortcuts`), used live by the modules.
 * - The plugin's commands: their hotkeys live in Obsidian's Hotkeys (hotkeys.json). This window
 *   reads and writes them there, through Obsidian's hotkey manager, so both screens always agree.
 *
 * Recording: press "+" and then the keys. A key that is already taken is reported with what takes
 * it (another canvas shortcut, the canvas itself, an Obsidian hotkey), with Replace / Keep both.
 */
import { Modal, Notice, Platform, setIcon, setTooltip, type App, type Command } from "obsidian";
import type { I18nKey, Translate } from "../i18n";
import { openSettingsTab } from "../internals/app";
import { CATEGORY_ORDER, collisions, contextsOverlap, SHORTCUTS, shortcutDef, type ShortcutDef } from "../core/shortcuts/catalog";
import { comboFromEvent, comboFromHotkey, formatCombo, hotkeyFromCombo, type Combo, type HotkeyLike } from "../core/shortcuts/keys";
import type { ShortcutStore } from "../core/shortcuts/store";

export interface ShortcutsHost {
	app: App;
	store: ShortcutStore;
	t(): Translate;
	pluginId: string;
	pluginName: string;
	/** Whether the module providing a shortcut is on. */
	moduleOn(id: string): boolean;
}

interface HotkeyManagerLike {
	getHotkeys(id: string): HotkeyLike[] | undefined;
	getDefaultHotkeys(id: string): HotkeyLike[] | undefined;
	setHotkeys(id: string, keys: HotkeyLike[]): void;
	removeHotkeys(id: string): void;
	save(): Promise<void> | void;
	bake?(): void;
}

/** Something a key could be taken by. */
interface Taker {
	label: string;
	/** Frees the key (absent: it can't be freed, e.g. the canvas' own keys). */
	free?: () => Promise<void> | void;
}

const CLS = "opc-shortcuts";

export class ShortcutsModal extends Modal {
	private searchEl!: HTMLInputElement;
	private listEl!: HTMLElement;
	private recording: { stop: () => void } | null = null;
	private offStore: (() => void) | null = null;

	constructor(
		private readonly host: ShortcutsHost,
		private query = "",
	) {
		super(host.app);
	}

	private get t(): Translate {
		return this.host.t();
	}

	private get mac(): boolean {
		return this.host.store.mac;
	}

	private get hotkeys(): HotkeyManagerLike | null {
		const m = (this.app as unknown as { hotkeyManager?: Partial<HotkeyManagerLike> }).hotkeyManager;
		return m && typeof m.getHotkeys === "function" && typeof m.setHotkeys === "function" && typeof m.removeHotkeys === "function" ? (m as HotkeyManagerLike) : null;
	}

	override onOpen(): void {
		const t = this.t;
		this.modalEl.addClass(`${CLS}-modal`);
		this.setTitle(t("shortcuts.title"));
		const top = this.contentEl.createDiv({ cls: `${CLS}-top` });
		const search = top.createDiv({ cls: "search-input-container" });
		this.searchEl = search.createEl("input", { type: "search", cls: `${CLS}-search`, attr: { placeholder: t("shortcuts.search"), "aria-label": t("shortcuts.search"), spellcheck: "false" } });
		this.searchEl.value = this.query;
		this.searchEl.addEventListener("input", () => {
			this.query = this.searchEl.value;
			this.filter();
		});
		const resetAll = top.createEl("button", { text: t("shortcuts.resetAll"), cls: `${CLS}-reset-all` });
		resetAll.addEventListener("click", () => void this.confirmResetAll(resetAll));
		const intro = this.contentEl.createDiv({ cls: `${CLS}-intro`, text: t("shortcuts.intro") });
		if (Platform.isMobile) intro.createDiv({ cls: `${CLS}-touch`, text: t("shortcuts.touch") });
		this.listEl = this.contentEl.createDiv({ cls: `${CLS}-list` });
		this.render();
		this.offStore = this.host.store.onChange(() => this.render());
		// Keep the search box free for typing; on a phone don't pop the keyboard up.
		if (!Platform.isMobile) window.setTimeout(() => this.searchEl.focus(), 0);
	}

	override onClose(): void {
		this.recording?.stop();
		this.offStore?.();
		this.contentEl.empty();
	}

	// ---------- rendering ----------

	private render(): void {
		const scroll = this.listEl.scrollTop;
		this.listEl.empty();
		const t = this.t;
		for (const category of CATEGORY_ORDER) {
			const defs = SHORTCUTS.filter((s) => s.category === category);
			const section = this.section(t(`shortcuts.cat.${category}` as I18nKey), category === "canvas" ? t("shortcuts.cat.canvas.hint") : undefined);
			for (const d of defs) this.renderShortcut(section, d);
		}
		const commands = this.commands();
		if (commands.length) {
			const section = this.section(t("shortcuts.cat.commands"), t("shortcuts.cat.commands.hint"));
			const link = section.parentElement!.querySelector(`.${CLS}-section-head`)!.createEl("button", { cls: `mod-muted ${CLS}-hotkeys-link`, text: t("shortcuts.openHotkeys") });
			link.addEventListener("click", () => this.openObsidianHotkeys());
			for (const c of commands) this.renderCommand(section, c);
		}
		this.filter();
		this.listEl.scrollTop = scroll;
	}

	private section(title: string, hint?: string): HTMLElement {
		const wrap = this.listEl.createDiv({ cls: `${CLS}-section` });
		const head = wrap.createDiv({ cls: `${CLS}-section-head` });
		head.createDiv({ cls: `${CLS}-section-title`, text: title });
		if (hint) wrap.createDiv({ cls: `${CLS}-section-hint`, text: hint });
		return wrap.createDiv({ cls: `${CLS}-rows` });
	}

	private renderShortcut(parent: HTMLElement, d: ShortcutDef): void {
		const t = this.t;
		const store = this.host.store;
		const name = t(`shortcuts.action.${d.id}` as I18nKey);
		const when = t(`shortcuts.ctx.${d.context}` as I18nKey);
		const combos = d.fixed ? d.defaults : store.combos(d.id);
		const row = parent.createDiv({ cls: `${CLS}-row`, attr: { "data-shortcut": d.id } });
		const info = row.createDiv({ cls: `${CLS}-info` });
		info.createDiv({ cls: `${CLS}-name`, text: name });
		const meta = info.createDiv({ cls: `${CLS}-when`, text: when });
		if (d.module && !this.host.moduleOn(d.module)) meta.createSpan({ cls: `${CLS}-off`, text: t("shortcuts.featureOff") });
		const right = row.createDiv({ cls: `${CLS}-right` });
		const keys = right.createDiv({ cls: `${CLS}-keys` });
		if (d.gesture) keys.createSpan({ cls: `${CLS}-chip is-gesture`, text: t(d.gesture as I18nKey) });
		for (const c of combos) this.chip(keys, c, d.fixed ? undefined : () => void store.set(d.id, combos.filter((x) => x !== c)));
		if (!d.fixed && combos.length === 0) keys.createSpan({ cls: `${CLS}-none`, text: t("shortcuts.none") });
		// What it is found by: names, situation and keys, in the UI language and in English.
		row.setAttr("data-search", searchable([name, when, t(`shortcuts.cat.${d.category}` as I18nKey), ...combos.flatMap((c) => [c, formatCombo(c, this.mac)]), d.gesture ? t(d.gesture as I18nKey) : ""]));
		if (d.fixed) {
			row.addClass("is-fixed");
			return;
		}
		// Keys taken twice inside the plugin.
		const clashes = combos.flatMap((c) => collisions(d, c, (id) => store.combos(id)).map((o) => `${formatCombo(c, this.mac)}: ${t(`shortcuts.action.${o.id}` as I18nKey)}`));
		if (clashes.length) {
			const warn = info.createDiv({ cls: `${CLS}-warning` });
			setIcon(warn.createSpan(), "alert-triangle");
			warn.createSpan({ text: t("shortcuts.clash", { list: clashes.join(" · ") }) });
		}
		const tools = right.createDiv({ cls: `${CLS}-tools` });
		this.iconButton(tools, "plus", t("shortcuts.add"), (btn) => this.record(row, btn, async (combo) => this.addToShortcut(row, d, combo)));
		if (!store.isDefault(d.id)) this.iconButton(tools, "rotate-ccw", t("shortcuts.reset"), () => void store.reset(d.id));
	}

	private renderCommand(parent: HTMLElement, cmd: Command): void {
		const t = this.t;
		const hk = this.hotkeys;
		const combos = this.commandCombos(cmd.id);
		const name = this.commandName(cmd);
		const row = parent.createDiv({ cls: `${CLS}-row is-command`, attr: { "data-command": cmd.id } });
		const info = row.createDiv({ cls: `${CLS}-info` });
		info.createDiv({ cls: `${CLS}-name`, text: name });
		const right = row.createDiv({ cls: `${CLS}-right` });
		const keys = right.createDiv({ cls: `${CLS}-keys` });
		for (const c of combos) this.chip(keys, c, hk ? () => void this.setCommandCombos(cmd.id, combos.filter((x) => x !== c)) : undefined);
		if (combos.length === 0) keys.createSpan({ cls: `${CLS}-none`, text: t("shortcuts.none") });
		row.setAttr("data-search", searchable([name, cmd.id, t("shortcuts.cat.commands"), ...combos.flatMap((c) => [c, formatCombo(c, this.mac)])]));
		if (!hk) return;
		const tools = right.createDiv({ cls: `${CLS}-tools` });
		this.iconButton(tools, "plus", t("shortcuts.add"), (btn) => this.record(row, btn, async (combo) => this.addToCommand(row, cmd, combo)));
		if (hk.getHotkeys(cmd.id) !== undefined) this.iconButton(tools, "rotate-ccw", t("shortcuts.reset"), () => void this.resetCommand(cmd.id));
	}

	private chip(parent: HTMLElement, combo: Combo, remove?: () => void): void {
		const chip = parent.createSpan({ cls: `${CLS}-chip` });
		chip.createSpan({ text: formatCombo(combo, this.mac) });
		if (!remove) return;
		const x = chip.createSpan({ cls: `${CLS}-chip-remove clickable-icon`, attr: { role: "button", "aria-label": this.t("shortcuts.remove") } });
		setIcon(x, "x");
		setTooltip(x, this.t("shortcuts.remove"));
		x.addEventListener("click", (e) => {
			e.stopPropagation();
			remove();
		});
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, onClick: (btn: HTMLElement) => void): HTMLElement {
		const b = parent.createEl("button", { cls: `clickable-icon ${CLS}-icon`, attr: { "aria-label": label } });
		setIcon(b, icon);
		setTooltip(b, label);
		b.addEventListener("click", () => onClick(b));
		return b;
	}

	private filter(): void {
		const words = searchable([this.query]).split(" ").filter(Boolean);
		for (const section of Array.from(this.listEl.querySelectorAll<HTMLElement>(`.${CLS}-section`))) {
			let any = false;
			for (const row of Array.from(section.querySelectorAll<HTMLElement>(`.${CLS}-row`))) {
				const text = row.getAttribute("data-search") ?? "";
				const compact = text.replace(/[\s+]/g, "");
				const show = words.every((w) => text.includes(w) || compact.includes(w.replace(/\+/g, "")));
				row.toggleClass("is-hidden", !show);
				any ||= show;
			}
			section.toggleClass("is-hidden", !any);
		}
		const empty = this.listEl.querySelector(`.${CLS}-empty`);
		const none = !this.listEl.querySelector(`.${CLS}-section:not(.is-hidden)`);
		if (none && !empty) this.listEl.createDiv({ cls: `${CLS}-empty`, text: this.t("shortcuts.noMatch") });
		else if (!none) empty?.remove();
	}

	// ---------- recording ----------

	/** Waits for a key combination; Esc cancels. `apply` runs with the combination pressed. */
	private record(row: HTMLElement, button: HTMLElement, apply: (combo: Combo) => Promise<void>): void {
		this.recording?.stop();
		const keys = row.querySelector<HTMLElement>(`.${CLS}-keys`)!;
		const prompt = keys.createSpan({ cls: `${CLS}-chip is-recording`, text: this.t("shortcuts.press") });
		button.addClass("is-active");
		const win = this.modalEl.win;
		const onKey = (evt: KeyboardEvent) => {
			const combo = comboFromEvent(evt, this.mac);
			if (!combo) return;
			evt.preventDefault();
			evt.stopPropagation();
			evt.stopImmediatePropagation();
			stop();
			if (combo === "Escape") return;
			void apply(combo);
		};
		const onDown = (evt: PointerEvent) => {
			if (!prompt.contains(evt.target as Node) && evt.target !== button && !button.contains(evt.target as Node)) stop();
		};
		const stop = () => {
			win.removeEventListener("keydown", onKey, true);
			win.removeEventListener("pointerdown", onDown, true);
			prompt.remove();
			button.removeClass("is-active");
			if (this.recording?.stop === stop) this.recording = null;
		};
		win.addEventListener("keydown", onKey, true);
		win.addEventListener("pointerdown", onDown, true);
		this.recording = { stop };
	}

	private async addToShortcut(row: HTMLElement, d: ShortcutDef, combo: Combo): Promise<void> {
		const store = this.host.store;
		const current = store.combos(d.id);
		if (current.includes(combo)) return;
		const takers: Taker[] = [];
		for (const o of collisions(d, combo, (id) => store.combos(id)))
			takers.push({
				label: o.fixed ? this.t("shortcuts.taken.canvas", { name: this.t(`shortcuts.action.${o.id}` as I18nKey) }) : this.t("shortcuts.taken.shortcut", { name: this.t(`shortcuts.action.${o.id}` as I18nKey) }),
				free: o.fixed ? undefined : () => store.set(o.id, store.combos(o.id).filter((c) => c !== combo)),
			});
		takers.push(...this.obsidianTakers(combo, null));
		await this.confirmTaken(row, combo, takers, () => store.set(d.id, [...current, combo]));
	}

	private async addToCommand(row: HTMLElement, cmd: Command, combo: Combo): Promise<void> {
		const current = this.commandCombos(cmd.id);
		if (current.includes(combo)) return;
		const store = this.host.store;
		const takers: Taker[] = [];
		// In a canvas the canvas shortcuts come first: the command's key would not reach it there.
		for (const d of SHORTCUTS)
			if (contextsOverlap(d.context, "board") && (d.fixed ? d.defaults : store.combos(d.id)).includes(combo))
				takers.push({
					label: d.fixed ? this.t("shortcuts.taken.canvas", { name: this.t(`shortcuts.action.${d.id}` as I18nKey) }) : this.t("shortcuts.taken.shortcut", { name: this.t(`shortcuts.action.${d.id}` as I18nKey) }),
					free: d.fixed ? undefined : () => store.set(d.id, store.combos(d.id).filter((c) => c !== combo)),
				});
		takers.push(...this.obsidianTakers(combo, cmd.id));
		await this.confirmTaken(row, combo, takers, () => this.setCommandCombos(cmd.id, [...current, combo]));
	}

	/**
	 * With nothing in the way the key is added; otherwise a small panel in the row says what has it:
	 * Replace (frees it where it can, then adds), Keep both, or Cancel.
	 */
	private async confirmTaken(row: HTMLElement, combo: Combo, takers: Taker[], add: () => Promise<void>): Promise<void> {
		if (takers.length === 0) {
			await add();
			return;
		}
		const t = this.t;
		row.querySelector(`.${CLS}-conflict`)?.remove();
		const panel = row.createDiv({ cls: `${CLS}-conflict` });
		const head = panel.createDiv({ cls: `${CLS}-conflict-head` });
		setIcon(head.createSpan(), "alert-triangle");
		head.createSpan({ text: t("shortcuts.taken", { key: formatCombo(combo, this.mac) }) });
		const list = panel.createEl("ul");
		for (const x of takers) list.createEl("li", { text: x.label });
		const buttons = panel.createDiv({ cls: `${CLS}-conflict-buttons` });
		const freeable = takers.some((x) => x.free);
		if (freeable) {
			const replace = buttons.createEl("button", { cls: "mod-cta", text: t("shortcuts.replace") });
			replace.addEventListener("click", async () => {
				panel.remove();
				for (const x of takers) await x.free?.();
				await add();
			});
		}
		const keep = buttons.createEl("button", { text: freeable ? t("shortcuts.keepBoth") : t("shortcuts.useAnyway") });
		keep.addEventListener("click", async () => {
			panel.remove();
			await add();
		});
		buttons.createEl("button", { text: t("shortcuts.cancel") }).addEventListener("click", () => panel.remove());
	}

	/** Obsidian hotkeys (of any plugin or the core) on this key, other than `except`. */
	private obsidianTakers(combo: Combo, except: string | null): Taker[] {
		const hk = this.hotkeys;
		if (!hk) return [];
		const out: Taker[] = [];
		const commands = (this.app as unknown as { commands: { commands: Record<string, Command> } }).commands.commands;
		for (const cmd of Object.values(commands)) {
			if (cmd.id === except) continue;
			const own = hk.getHotkeys(cmd.id) ?? hk.getDefaultHotkeys(cmd.id) ?? [];
			if (!own.some((h) => comboFromHotkey(h, this.mac) === combo)) continue;
			out.push({
				label: this.t("shortcuts.taken.hotkey", { name: cmd.name }),
				free: () => this.setCommandHotkeys(cmd.id, own.filter((h) => comboFromHotkey(h, this.mac) !== combo)),
			});
		}
		return out;
	}

	// ---------- Obsidian hotkeys of the plugin's commands ----------

	private commands(): Command[] {
		const all = (this.app as unknown as { commands: { commands: Record<string, Command> } }).commands.commands;
		return Object.values(all)
			.filter((c) => c.id.startsWith(`${this.host.pluginId}:`))
			.sort((a, b) => this.commandName(a).localeCompare(this.commandName(b)));
	}

	private commandName(cmd: Command): string {
		const prefix = `${this.host.pluginName}: `;
		return cmd.name.startsWith(prefix) ? cmd.name.slice(prefix.length) : cmd.name;
	}

	private commandCombos(id: string): Combo[] {
		const hk = this.hotkeys;
		const list = hk ? (hk.getHotkeys(id) ?? hk.getDefaultHotkeys(id) ?? []) : [];
		return list.map((h) => comboFromHotkey(h, this.mac)).filter((c): c is Combo => !!c);
	}

	private async setCommandCombos(id: string, combos: Combo[]): Promise<void> {
		await this.setCommandHotkeys(id, combos.map(hotkeyFromCombo).filter((h): h is HotkeyLike => !!h));
	}

	private async setCommandHotkeys(id: string, list: HotkeyLike[]): Promise<void> {
		const hk = this.hotkeys;
		if (!hk) return;
		try {
			hk.setHotkeys(id, list);
			await hk.save();
			hk.bake?.();
		} catch {
			new Notice(this.t("shortcuts.saveFailed"));
		}
		this.render();
	}

	private async resetCommand(id: string): Promise<void> {
		const hk = this.hotkeys;
		if (!hk) return;
		hk.removeHotkeys(id);
		await hk.save();
		hk.bake?.();
		this.render();
	}

	/** Obsidian's Hotkeys tab, filtered to this plugin. */
	private openObsidianHotkeys(): void {
		this.close();
		if (!openSettingsTab(this.app, "hotkeys")) return;
		const tab = (this.app as unknown as { setting?: { activeTab?: { searchComponent?: { setValue(v: string): void; inputEl?: HTMLInputElement }; updateHotkeyVisibility?(): void } } }).setting?.activeTab;
		tab?.searchComponent?.setValue(this.host.pluginName);
		tab?.searchComponent?.inputEl?.dispatchEvent(new Event("input"));
		tab?.updateHotkeyVisibility?.();
	}

	// ---------- reset all ----------

	private async confirmResetAll(button: HTMLButtonElement): Promise<void> {
		const t = this.t;
		if (!button.hasClass("is-confirming")) {
			button.addClass("is-confirming", "mod-warning");
			button.setText(t("shortcuts.resetAll.confirm"));
			window.setTimeout(() => {
				if (!button.isConnected) return;
				button.removeClass("is-confirming", "mod-warning");
				button.setText(t("shortcuts.resetAll"));
			}, 4000);
			return;
		}
		button.removeClass("is-confirming", "mod-warning");
		button.setText(t("shortcuts.resetAll"));
		await this.host.store.resetAll();
		// The plugin's command hotkeys too: everything this window shows goes back to its default.
		const hk = this.hotkeys;
		if (hk) {
			for (const cmd of this.commands()) if (hk.getHotkeys(cmd.id) !== undefined) hk.removeHotkeys(cmd.id);
			await hk.save();
			hk.bake?.();
		}
		this.render();
		new Notice(t("shortcuts.resetAll.done"));
	}
}

/** Lower case, without accents, words separated by single spaces. */
function searchable(parts: string[]): string {
	return parts
		.join(" ")
		.toLocaleLowerCase()
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** For the tutorial and the settings: is this shortcut row on screen? */
export function shortcutRow(doc: Document, id: string): HTMLElement | null {
	return doc.querySelector<HTMLElement>(`.${CLS}-modal .${CLS}-row[data-shortcut="${CSS.escape(id)}"]`);
}

