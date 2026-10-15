import { Notice, PluginSettingTab, Setting, type App, type Plugin, type SettingDefinitionItem } from "obsidian";
import { SETTINGS_GROUP_ORDER, type AnyModule } from "../core/module";
import type { ModuleManager } from "../core/module-manager";
import type { I18nKey, LanguageSetting, Translate } from "../i18n";
import { en } from "../i18n/locales/en";
import type { PluginSettings } from "./settings";

export interface SettingsTabHost {
	readonly settings: PluginSettings;
	readonly modules: ModuleManager;
	t(): Translate;
	saveSettings(): Promise<void>;
	setLanguage(language: LanguageSetting): void;
}

/**
 * Settings grouped by module group; each module has an enable toggle, its options and "reset to
 * defaults". Declarative, so Obsidian's settings search finds modules and their options.
 */
export class OpcSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private readonly host: SettingsTabHost,
	) {
		super(app, plugin);
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const { host } = this;
		const t = host.t();
		const items: SettingDefinitionItem[] = [
			{
				name: t("settings.language.name"),
				desc: t("settings.language.desc"),
				render: (s) => {
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

	/** The module row; returns the cleanup of its options block. */
	private renderModule(setting: Setting, def: AnyModule): () => void {
		const { host } = this;
		const t = host.t();
		const status = host.modules.status(def.id);
		setting.setName(t(def.name));

		const desc = createFragment((f) => {
			f.appendText(t(def.description));
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
			return () => {
				optionsEl.remove();
				setting.settingEl.removeClass("opc-has-options");
			};
		}
		return () => {};
	}
}

/** Names of a module's own settings (keys "<module>.….name"), so the settings search finds them. */
function optionNames(def: AnyModule, t: Translate): string[] {
	const prefix = def.name.replace(/name$/, "");
	return (Object.keys(en) as I18nKey[]).filter((k) => k !== def.name && k.startsWith(prefix) && k.endsWith(".name")).map((k) => t(k));
}
