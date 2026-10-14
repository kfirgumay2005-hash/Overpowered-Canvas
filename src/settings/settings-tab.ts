import { Notice, PluginSettingTab, Setting, SettingGroup, type App, type Plugin } from "obsidian";
import { SETTINGS_GROUP_ORDER, type AnyModule } from "../core/module";
import type { ModuleManager } from "../core/module-manager";
import type { LanguageSetting, Translate } from "../i18n";
import type { PluginSettings } from "./settings";

export interface SettingsTabHost {
	readonly settings: PluginSettings;
	readonly modules: ModuleManager;
	t(): Translate;
	saveSettings(): Promise<void>;
	setLanguage(language: LanguageSetting): void;
}

/** Settings grouped by module group; each module has an enable toggle, its options and "reset to defaults". */
export class OpcSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		plugin: Plugin,
		private readonly host: SettingsTabHost,
	) {
		super(app, plugin);
	}

	override display(): void {
		const { containerEl, host } = this;
		const t = host.t();
		containerEl.empty();
		containerEl.addClass("opc-settings");

		new SettingGroup(containerEl).addSetting((s) =>
			s
				.setName(t("settings.language.name"))
				.setDesc(t("settings.language.desc"))
				.addDropdown((d) =>
					d
						.addOptions({ auto: t("settings.language.auto"), en: t("settings.language.en"), he: t("settings.language.he") })
						.setValue(host.settings.language)
						.onChange(async (value) => {
							host.setLanguage(value as LanguageSetting);
							await host.saveSettings();
							new Notice(host.t()("settings.language.reload"));
							this.display();
						}),
				),
		);

		for (const group of SETTINGS_GROUP_ORDER) {
			const modules = host.modules.ordered.filter((m) => m.group === group);
			if (modules.length === 0) continue;
			const settingGroup = new SettingGroup(containerEl).setHeading(t(`group.${group}`));
			for (const def of modules) settingGroup.addSetting((s) => this.renderModule(s, def));
		}

		new SettingGroup(containerEl).addSetting((s) =>
			s
				.setName(t("settings.coexistence.name"))
				.setDesc(t("settings.coexistence.desc"))
				.addButton((b) =>
					b.setButtonText(t("settings.coexistence.button")).onClick(async () => {
						host.settings.coexistence.acknowledged = [];
						await host.saveSettings();
						new Notice(t("settings.coexistence.reset.done"));
					}),
				),
		);
	}

	private renderModule(setting: Setting, def: AnyModule): void {
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

		if (def.renderSettings || Object.keys(def.defaultSettings as object).length > 0) {
			setting.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip(t("settings.module.reset"))
					.onClick(async () => {
						await host.modules.resetSettings(def.id);
						new Notice(t("settings.module.reset.done", { module: t(def.name) }));
						this.display();
					}),
			);
		}

		setting.addToggle((toggle) =>
			toggle
				.setValue(status === "enabled")
				.setDisabled(status === "unavailable")
				.onChange(async (value) => {
					await host.modules.setEnabled(def.id, value);
					this.display();
				}),
		);

		const ctx = host.modules.contextOf(def.id);
		if (status === "enabled" && ctx && def.renderSettings) {
			const optionsEl = setting.settingEl.createDiv({ cls: "opc-module-options" });
			// Put the options right under the module row.
			setting.settingEl.after(optionsEl);
			def.renderSettings(optionsEl, ctx);
		}
	}
}
