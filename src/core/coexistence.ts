import { Modal, Notice, Setting, type App } from "obsidian";
import type { Translate } from "../i18n";
import type { PluginSettings } from "../settings/settings";
import type { ModuleManager } from "./module-manager";
import { findOverlaps, OVERLAPPING_PLUGINS, type Overlap } from "./overlaps";

/** `app.plugins.enabledPlugins` is internal (see docs/INTERNALS.md); fall back to "none" if it changes. */
function enabledCommunityPlugins(app: App): ReadonlySet<string> {
	const plugins = (app as unknown as { plugins?: { enabledPlugins?: unknown } }).plugins;
	return plugins?.enabledPlugins instanceof Set ? (plugins.enabledPlugins as Set<string>) : new Set();
}

/** Shows the one-time overlap notice when Advanced Canvas / Canvas Mindmap run next to our overlapping modules. */
export function checkCoexistence(app: App, manager: ModuleManager, settings: PluginSettings, save: () => Promise<void>, t: Translate): void {
	const overlaps = findOverlaps(enabledCommunityPlugins(app), manager.ordered, new Set(manager.activeIds()), settings.coexistence.acknowledged);
	if (overlaps.length === 0) return;

	const acknowledge = async () => {
		for (const o of overlaps) if (!settings.coexistence.acknowledged.includes(o.plugin)) settings.coexistence.acknowledged.push(o.plugin);
		await save();
	};
	new CoexistenceModal(app, overlaps, manager, t, acknowledge).open();
}

class CoexistenceModal extends Modal {
	private answered = false;

	constructor(
		app: App,
		private readonly overlaps: Overlap[],
		private readonly manager: ModuleManager,
		private readonly t: Translate,
		private readonly acknowledge: () => Promise<void>,
	) {
		super(app);
	}

	override onOpen(): void {
		const { t } = this;
		this.setTitle(t("coexistence.title"));
		this.contentEl.createEl("p", { text: t("coexistence.intro") });
		const list = this.contentEl.createEl("ul");
		for (const o of this.overlaps) {
			const names = o.modules.map((id) => {
				const def = this.manager.get(id);
				return def ? t(def.name) : id;
			});
			list.createEl("li", { text: t("coexistence.row", { plugin: OVERLAPPING_PLUGINS[o.plugin], modules: names.join(", ") }) });
		}
		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText(t("coexistence.disableOurs"))
					.setWarning()
					.onClick(async () => {
						const ids = new Set(this.overlaps.flatMap((o) => o.modules));
						for (const id of ids) await this.manager.setEnabled(id, false);
						new Notice(t("coexistence.disabled", { count: ids.size }));
						await this.finish();
					}),
			)
			.addButton((b) =>
				b
					.setButtonText(t("coexistence.keepBoth"))
					.setCta()
					.onClick(() => this.finish()),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		// Closing with Esc counts as "keep both" — the notice is one-time.
		if (!this.answered) void this.acknowledge();
	}

	private async finish(): Promise<void> {
		this.answered = true;
		await this.acknowledge();
		this.close();
	}
}
