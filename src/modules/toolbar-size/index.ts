import { Platform, Setting } from "obsidian";
import { defineModule } from "../../core/module";
import { mergeWithDefaults } from "../../settings/settings";

interface ToolbarSizeSettings {
	/** Percent of the default size. */
	desktop: number;
	mobile: number;
}

const DEFAULTS: ToolbarSizeSettings = { desktop: 100, mobile: 100 };
const MIN = 60;
const MAX = 200;
const clampPercent = (n: number, fallback: number) => (Number.isFinite(n) ? Math.min(MAX, Math.max(MIN, Math.round(n))) : fallback);

/** Size of the selection toolbar (the menu above a selected card), separately for desktop and mobile. */
export const toolbarSizeModule = defineModule<ToolbarSizeSettings>({
	id: "toolbar-size",
	name: "toolbarSize.name",
	description: "toolbarSize.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: DEFAULTS,
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return { desktop: clampPercent(s.desktop, defaults.desktop), mobile: clampPercent(s.mobile, defaults.mobile) };
	},

	enable(ctx) {
		const apply = () => {
			const percent = Platform.isMobile ? ctx.settings.mobile : ctx.settings.desktop;
			document.body.style.setProperty("--opc-menu-zoom", String(percent / 100));
			for (const canvas of ctx.canvases()) if (canvas.selection.size > 0) canvas.menu.render(true);
		};
		apply();
		ctx.onSettingsChange(apply);
		ctx.register(() => document.body.style.removeProperty("--opc-menu-zoom"));
	},

	renderSettings(el, ctx) {
		const slider = (name: string, desc: string, key: keyof ToolbarSizeSettings) =>
			new Setting(el)
				.setName(name)
				.setDesc(desc)
				.addSlider((s) =>
					s
						.setLimits(MIN, MAX, 5)
						.setValue(ctx.settings[key])
						.setDynamicTooltip()
						.onChange((v) => ctx.updateSettings({ [key]: v })),
				);
		slider(ctx.t("toolbarSize.desktop.name"), ctx.t("toolbarSize.percent.desc"), "desktop");
		slider(ctx.t("toolbarSize.mobile.name"), ctx.t("toolbarSize.percent.desc"), "mobile");
	},
});
