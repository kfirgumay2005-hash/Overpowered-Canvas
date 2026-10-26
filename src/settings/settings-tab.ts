import { Notice, PluginSettingTab, Setting, setIcon, type App, type ButtonComponent, type ExtraButtonComponent, type Plugin, type SettingDefinitionItem } from "obsidian";
import { SETTINGS_GROUP_ORDER, type AnyModule } from "../core/module";
import type { ModuleManager } from "../core/module-manager";
import type { I18nKey, LanguageSetting, Translate } from "../i18n";
import { en } from "../i18n/locales/en";
import { renderTutorialList, type TutorialListHost } from "../tutorials/list";
import { FolderSuggest, type MoveResult } from "./files-folder";
import { cleanFolderPath, DEFAULT_FILES_FOLDER, type PluginSettings } from "./settings";

export interface SettingsTabHost {
	readonly settings: PluginSettings;
	readonly modules: ModuleManager;
	t(): Translate;
	saveSettings(): Promise<void>;
	setLanguage(language: LanguageSetting): void;
	readonly tutorials: TutorialListHost;
	/** Moves the plugin's files to `to` and makes it the files folder. */
	applyFilesFolder(to: string): Promise<MoveResult>;
}

const COLLAPSED_KEY = "overpowered-canvas:settings-collapsed";

/** Lower case, accents removed: the form both the query and the searched text are compared in. */
function normalize(text: string): string {
	return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Everything a row can be found by: these strings in the current language and in English. */
function searchText(t: Translate, keys: readonly I18nKey[]): string {
	return normalize(keys.flatMap((k) => [t(k), en[k]]).join(" | "));
}

/**
 * Settings grouped by module group; each module has an enable toggle, its options and "reset to
 * defaults". Declarative, so Obsidian's settings search finds modules and their options.
 */
export class OpcSettingTab extends PluginSettingTab {
	/** Text in our search box; survives re-renders (module toggles call update()). */
	private query = "";
	/** Collapsed group ids ("core", "nodes"…, "general"), remembered per vault. */
	private readonly collapsed: Set<string>;

	constructor(
		app: App,
		plugin: Plugin,
		private readonly host: SettingsTabHost,
	) {
		super(app, plugin);
		let stored: unknown = null;
		try {
			stored = app.loadLocalStorage(COLLAPSED_KEY);
		} catch {
			// No storage: everything starts expanded.
		}
		this.collapsed = new Set(Array.isArray(stored) ? stored.filter((x): x is string => typeof x === "string") : []);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const { host } = this;
		const t = host.t();
		const items: SettingDefinitionItem[] = [
			{
				type: "group",
				heading: t("tutorial.heading"),
				cls: "opc-settings-tutorials",
				items: [{ name: t("tutorial.heading"), desc: t("tutorial.intro"), searchable: false, render: (s) => this.renderTutorials(s) }],
			},
			{
				type: "group",
				cls: "opc-settings-search-group",
				items: [{ name: t("settings.search.placeholder"), searchable: false, render: (s) => this.renderSearch(s) }],
			},
			{
				name: t("settings.filesFolder.name"),
				desc: t("settings.filesFolder.desc"),
				render: (s) => this.renderFilesFolder(s),
			},
			{
				name: t("settings.language.name"),
				desc: t("settings.language.desc"),
				render: (s) => {
					s.settingEl.setAttr("data-opc-search", searchText(t, ["settings.language.name", "settings.language.desc", "settings.language.simple"]));
					addSimpleLine(s.descEl, t("settings.language.simple"));
					s.addDropdown((d) =>
						d
							.addOptions({
								auto: t("settings.language.auto"),
								en: t("settings.language.en"),
								zh: t("settings.language.zh"),
								ja: t("settings.language.ja"),
								hi: t("settings.language.hi"),
							})
							.setValue(host.settings.language)
							.onChange(async (value) => {
								host.setLanguage(value as LanguageSetting);
								await host.saveSettings();
								new Notice(host.t()("settings.language.reload"));
								this.update();
							}),
					);
				},
			},
		];

		for (const group of SETTINGS_GROUP_ORDER) {
			const modules = host.modules.ordered.filter((m) => m.group === group);
			if (modules.length === 0) continue;
			items.push({
				type: "group",
				heading: t(`group.${group}`),
				cls: this.groupCls(group),
				extraButtons: [(b) => this.collapseButton(b, group)],
				items: modules.map((def) => ({
					name: t(def.name),
					desc: t(def.description),
					aliases: optionNames(def, t),
					render: (s) => this.renderModule(s, def),
				})),
			});
		}

		items.push({
			type: "group",
			items: [
				{
					name: t("settings.coexistence.name"),
					desc: t("settings.coexistence.desc"),
					render: (s) => {
						s.settingEl.setAttr("data-opc-search", searchText(t, ["settings.coexistence.name", "settings.coexistence.desc", "settings.coexistence.simple"]));
						addSimpleLine(s.descEl, t("settings.coexistence.simple"));
						s.addButton((b) =>
							b.setButtonText(t("settings.coexistence.button")).onClick(async () => {
								host.settings.coexistence.acknowledged = [];
								await host.saveSettings();
								new Notice(t("settings.coexistence.reset.done"));
							}),
						);
					},
				},
			],
		});
		return items;
	}

	private groupCls(group: string): string {
		return `opc-settings-group${this.collapsed.has(group) ? " is-opc-collapsed" : ""}`;
	}

	private saveCollapsed(): void {
		try {
			this.app.saveLocalStorage(COLLAPSED_KEY, [...this.collapsed]);
		} catch {
			// Not remembered; harmless.
		}
	}

	private setCollapsed(groupEl: HTMLElement, group: string, collapsed: boolean): void {
		if (collapsed) this.collapsed.add(group);
		else this.collapsed.delete(group);
		groupEl.toggleClass("is-opc-collapsed", collapsed);
		const button = groupEl.querySelector<HTMLElement>(".opc-collapse-button");
		if (button) setIcon(button, collapsed ? "chevron-right" : "chevron-down");
	}

	/** The arrow in a group heading; clicking the heading text toggles it too. */
	private collapseButton(b: ExtraButtonComponent, group: string): void {
		const t = this.host.t();
		b.extraSettingsEl.addClass("opc-collapse-button");
		b.setIcon(this.collapsed.has(group) ? "chevron-right" : "chevron-down").setTooltip(t("settings.collapse.toggle"));
		const toggle = () => {
			const groupEl = b.extraSettingsEl.closest<HTMLElement>(".setting-group");
			if (!groupEl) return;
			this.setCollapsed(groupEl, group, !this.collapsed.has(group));
			this.saveCollapsed();
		};
		b.onClick(toggle);
		// The heading exists once the group is mounted.
		window.setTimeout(() => {
			const heading = b.extraSettingsEl.closest<HTMLElement>(".setting-item-heading");
			const nameEl = heading?.querySelector<HTMLElement>(".setting-item-name");
			if (!nameEl || nameEl.hasClass("opc-collapse-name")) return;
			nameEl.addClass("opc-collapse-name");
			nameEl.addEventListener("click", toggle);
		});
	}

	/** The folder for the plugin's files: type or pick one, then Apply moves the files there. */
	private renderFilesFolder(s: Setting): void {
		const { host } = this;
		const t = host.t();
		s.settingEl.setAttr("data-opc-search", searchText(t, ["settings.filesFolder.name", "settings.filesFolder.desc", "settings.filesFolder.simple"]));
		addSimpleLine(s.descEl, t("settings.filesFolder.simple"));
		let value = host.settings.filesFolder;
		let apply: ButtonComponent | null = null;
		const refresh = () => {
			const clean = cleanFolderPath(value);
			apply?.setDisabled(!clean || clean === host.settings.filesFolder);
		};
		s.addText((text) => {
			text.setPlaceholder(DEFAULT_FILES_FOLDER)
				.setValue(value)
				.onChange((v) => {
					value = v;
					refresh();
				});
			new FolderSuggest(this.app, text.inputEl, (path) => {
				value = path;
				refresh();
			});
		});
		s.addButton((b) => {
			apply = b;
			b.setButtonText(t("settings.filesFolder.apply"))
				.setCta()
				.onClick(async () => {
					const to = cleanFolderPath(value);
					if (!to) {
						new Notice(t("settings.filesFolder.invalid"));
						return;
					}
					b.setDisabled(true);
					try {
						const result = await host.applyFilesFolder(to);
						const kept = result.kept ? ` ${t("settings.filesFolder.kept", { count: result.kept })}` : "";
						new Notice(t("settings.filesFolder.done", { path: to, count: result.moved }) + kept);
					} catch (error) {
						console.error("[overpowered-canvas] could not move the plugin's files", error);
						new Notice(t("settings.filesFolder.failed"));
					}
					this.update();
				});
		});
		refresh();
	}

	/** The tutorial cards; starting one closes the settings window. */
	private renderTutorials(s: Setting): void {
		s.settingEl.addClass("opc-settings-tutorials-row");
		s.nameEl.remove();
		const list = s.settingEl.createDiv({ cls: "opc-tutorials-in-settings" });
		renderTutorialList(list, this.host.tutorials, () => (this.app as unknown as { setting?: { close(): void } }).setting?.close());
	}

	/** Search box and collapse / expand all, below the tutorials and above everything else. */
	private renderSearch(s: Setting): void {
		const t = this.host.t();
		s.settingEl.addClass("opc-settings-search");
		s.infoEl.remove();
		s.addSearch((search) => {
			search.setPlaceholder(t("settings.search.placeholder")).setValue(this.query);
			search.onChange((value) => {
				this.query = value;
				this.applyFilter();
			});
		});
		s.addExtraButton((b) =>
			b
				.setIcon("chevrons-down-up")
				.setTooltip(t("settings.collapse.all"))
				.onClick(() => this.collapseAll(true)),
		);
		s.addExtraButton((b) =>
			b
				.setIcon("chevrons-up-down")
				.setTooltip(t("settings.collapse.none"))
				.onClick(() => this.collapseAll(false)),
		);
		// Rows render after this one; filter them once they exist.
		window.setTimeout(() => this.applyFilter());
	}

	private collapseAll(collapsed: boolean): void {
		for (const groupEl of Array.from(this.containerEl.querySelectorAll<HTMLElement>(".setting-group.opc-settings-group"))) {
			const group = SETTINGS_GROUP_ORDER.find((g) => groupEl.querySelector(`[data-opc-group="${g}"]`));
			if (group) this.setCollapsed(groupEl, group, collapsed);
		}
		this.saveCollapsed();
	}

	/** Hides rows that don't match the query and groups left empty; a query shows collapsed groups. */
	private applyFilter(): void {
		const words = normalize(this.query).split(/\s+/).filter(Boolean);
		this.containerEl.toggleClass("opc-settings-searching", words.length > 0);
		for (const groupEl of Array.from(this.containerEl.querySelectorAll<HTMLElement>(".setting-group"))) {
			if (groupEl.hasClass("opc-settings-search-group")) continue;
			let any = false;
			for (const row of Array.from(groupEl.querySelectorAll<HTMLElement>(".setting-items > .setting-item[data-opc-search]"))) {
				const text = row.getAttribute("data-opc-search") ?? "";
				const match = words.every((w) => text.includes(w));
				row.toggleClass("opc-search-hidden", !match);
				any ||= match;
			}
			groupEl.toggleClass("opc-search-hidden", words.length > 0 && !any);
		}
	}

	/** The module row; returns the cleanup of its options block. */
	private renderModule(setting: Setting, def: AnyModule): () => void {
		const { host } = this;
		const t = host.t();
		const status = host.modules.status(def.id);
		const prefix = def.name.replace(/name$/, "");
		setting.settingEl.setAttr("data-opc-search", searchText(t, (Object.keys(en) as I18nKey[]).filter((k) => k.startsWith(prefix))));
		setting.settingEl.setAttr("data-opc-group", def.group);
		setting.setName(t(def.name));

		const desc = createFragment((f) => {
			f.appendText(t(def.description));
			const simple = simpleKey(def.name);
			if (simple) addSimpleLine(f, t(simple));
			const notes: string[] = [];
			if (status === "unavailable") notes.push(t("settings.module.desktopOnly"));
			if (status === "failed") notes.push(t("settings.module.failed"));
			if (def.dependsOn?.length)
				notes.push(t("settings.module.requires", { modules: def.dependsOn.map((id) => { const d = host.modules.get(id); return d ? t(d.name) : id; }).join(", ") }));
			for (const note of notes) {
				f.createEl("br");
				f.createSpan({ cls: "opc-setting-note", text: note });
			}
		});
		setting.setDesc(desc);

		if (def.renderSettings || Object.keys(def.defaultSettings).length > 0) {
			setting.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip(t("settings.module.reset"))
					.onClick(async () => {
						await host.modules.resetSettings(def.id);
						new Notice(t("settings.module.reset.done", { module: t(def.name) }));
						this.update();
					}),
			);
		}

		setting.addToggle((toggle) =>
			toggle
				.setValue(status === "enabled")
				.setDisabled(status === "unavailable")
				.onChange(async (value) => {
					await host.modules.setEnabled(def.id, value);
					this.update();
				}),
		);

		const ctx = host.modules.contextOf(def.id);
		if (status === "enabled" && ctx && def.renderSettings) {
			// Inside the row (the settings framework owns the list of rows), wrapped onto its own line.
			setting.settingEl.addClass("opc-has-options");
			const optionsEl = setting.settingEl.createDiv({ cls: "opc-module-options" });
			def.renderSettings(optionsEl, ctx);
			addOptionSimpleLines(optionsEl, def, t);
			return () => {
				optionsEl.remove();
				setting.settingEl.removeClass("opc-has-options");
			};
		}
		return () => {};
	}
}

/** "<x>.name" → "<x>.simple", any other key → "<key>.simple", if that plain-language explanation exists. */
function simpleKey(key: I18nKey): I18nKey | null {
	const simple = (key.endsWith(".name") ? key.replace(/name$/, "simple") : `${key}.simple`) as I18nKey;
	return simple in en ? simple : null;
}

function addSimpleLine(parent: DocumentFragment | HTMLElement, text: string): void {
	const line = parent.createDiv({ cls: "opc-setting-simple" });
	setIcon(line.createSpan({ cls: "opc-setting-simple-icon" }), "lightbulb");
	line.createSpan({ text });
}

/** Adds the plain-language line to each option row, found by its (translated) name. */
function addOptionSimpleLines(optionsEl: HTMLElement, def: AnyModule, t: Translate): void {
	const prefix = def.name.replace(/name$/, "");
	const byName = new Map<string, I18nKey>();
	for (const key of Object.keys(en) as I18nKey[]) if (key !== def.name && key.startsWith(prefix) && simpleKey(key)) byName.set(t(key), key);
	for (const row of Array.from(optionsEl.querySelectorAll<HTMLElement>(".setting-item"))) {
		const name = row.querySelector(".setting-item-name")?.textContent ?? "";
		const key = byName.get(name);
		const descEl = row.querySelector<HTMLElement>(".setting-item-description");
		const simple = key && simpleKey(key);
		if (simple && descEl) addSimpleLine(descEl, t(simple));
	}
}

/** Names of a module's own settings (keys "<module>.….name"), so the settings search finds them. */
function optionNames(def: AnyModule, t: Translate): string[] {
	const prefix = def.name.replace(/name$/, "");
	return (Object.keys(en) as I18nKey[]).filter((k) => k !== def.name && k.startsWith(prefix) && k.endsWith(".name")).map((k) => t(k));
}
