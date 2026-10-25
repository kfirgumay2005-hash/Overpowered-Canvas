import { getLanguage, Notice, Plugin, setIcon, setTooltip } from "obsidian";
import { CanvasHooks } from "./core/canvas-hooks";
import { CanvasTracker } from "./core/canvas-tracker";
import { CanvasUi } from "./core/canvas-ui";
import { checkCoexistence } from "./core/coexistence";
import { PublicEvents } from "./core/events";
import { createHistoryApi } from "./core/history";
import { ModuleManager } from "./core/module-manager";
import { Patcher } from "./core/patcher";
import { SaveGuard } from "./core/save-guard";
import { createCanvasDataApi, type CanvasDataApi } from "./data/access";
import { SCHEMA_VERSION } from "./data/schema";
import { createTranslator, resolveLocale, type LanguageSetting, type Translate } from "./i18n";
import type { CanvasLike } from "./internals/types";
import { MODULES } from "./modules/registry";
import { OpcSettingTab } from "./settings/settings-tab";
import { sanitizeSettings, type PluginSettings } from "./settings/settings";
import { TUTORIALS } from "./tutorials/catalog";
import { TutorialListModal, type TutorialListHost } from "./tutorials/list";
import { TutorialRunner } from "./tutorials/runner";

export default class OverpoweredCanvasPlugin extends Plugin {
	declare settings: PluginSettings;
	modules!: ModuleManager;
	/** Exposed for the developer console and diagnostics; not a stable API. */
	patcher = new Patcher();
	hooks!: CanvasHooks;
	private translate!: Translate;
	private readOnlyWarned = new WeakSet<CanvasLike>();

	override async onload(): Promise<void> {
		this.settings = sanitizeSettings(await this.loadData());
		this.setLanguage(this.settings.language);

		const history = createHistoryApi();
		const tracker = new CanvasTracker(this.app, (problems) => {
			console.error("[overpowered-canvas] Canvas internals changed; this canvas is left untouched.", problems);
		});
		const hooks = (this.hooks = new CanvasHooks(this.patcher, tracker));
		const saveGuard = new SaveGuard(this.patcher, tracker, () => this.translate("saveGuard.dropped"));
		this.register(() => saveGuard.setActive(false));
		const ui = new CanvasUi(hooks, tracker);
		const data: CanvasDataApi = createCanvasDataApi(
			history,
			(canvas, found) => this.warnReadOnly(canvas, found),
			(change) => {
				if ("node" in change) hooks.emit("node-extra-change", change.node);
				else if ("edge" in change) hooks.emit("edge-extra-change", change.edge);
				else hooks.emit("root-extra-change", change.root);
			},
		);

		this.modules = new ModuleManager(
			{
				app: this.app,
				plugin: this,
				patcher: this.patcher,
				tracker,
				hooks,
				ui,
				data,
				history,
				events: new PublicEvents(this.app.workspace),
				settings: this.settings,
				t: () => this.translate,
				saveSettings: () => this.saveSettings(),
				onActiveModulesChange: (count) => saveGuard.setActive(count > 0),
			},
			MODULES,
		);

		const tutorials = this.setupTutorials(tracker, data, history, hooks);
		this.addSettingTab(
			new OpcSettingTab(this.app, this, {
				settings: this.settings,
				modules: this.modules,
				t: () => this.translate,
				saveSettings: () => this.saveSettings(),
				setLanguage: (language) => this.setLanguage(language),
				tutorials,
			}),
		);

		this.app.workspace.onLayoutReady(async () => {
			await this.modules.startAll();
			checkCoexistence(this.app, this.modules, this.settings, () => this.saveSettings(), this.translate);
		});
	}

	override onunload(): void {
		void this.modules?.stopAll();
	}

	/**
	 * Tutorials: each opens a temporary practice board with a coach panel. Listed at the top of
	 * the settings and in a modal from the ribbon, a command and every canvas' side controls.
	 */
	private setupTutorials(tracker: CanvasTracker, data: CanvasDataApi, history: ReturnType<typeof createHistoryApi>, hooks: CanvasHooks): TutorialListHost {
		let open = () => {};
		const runner = new TutorialRunner({
			app: this.app,
			pluginId: this.manifest.id,
			modules: this.modules,
			data,
			history,
			hooks,
			catalog: TUTORIALS,
			t: () => this.translate,
			openList: () => open(),
			markDone: (id) => {
				if (this.settings.tutorials.done.includes(id)) return;
				this.settings.tutorials.done.push(id);
				void this.saveSettings();
			},
		});
		const list: TutorialListHost = {
			app: this.app,
			modules: this.modules,
			catalog: TUTORIALS,
			t: () => this.translate,
			isDone: (id) => this.settings.tutorials.done.includes(id),
			start: (def) => void runner.start(def),
		};
		open = () => new TutorialListModal(this.app, list).open();
		this.register(() => void runner.stop());
		this.app.workspace.onLayoutReady(() => void runner.cleanUp());
		this.addRibbonIcon("graduation-cap", this.translate("tutorial.open"), open);
		this.addCommand({ id: "tutorials", name: this.translate("tutorial.open"), icon: "graduation-cap", callback: open });
		this.register(
			tracker.subscribe((canvas) => {
				const group = canvas.wrapperEl.querySelector(".canvas-controls")?.createDiv({ cls: "canvas-control-group mod-raised opc-tutorials-control" });
				const item = group?.createDiv({ cls: "canvas-control-item", attr: { "aria-label": this.translate("tutorial.open") } });
				if (item) {
					setIcon(item, "graduation-cap");
					setTooltip(item, this.translate("tutorial.open"), { placement: "left" });
					item.addEventListener("click", open);
				}
				return () => group?.remove();
			}),
		);
		return list;
	}

	/** data.json changed on disk (e.g. synced from another device): adopt it without restarting. */
	override async onExternalSettingsChange(): Promise<void> {
		const next = sanitizeSettings(await this.loadData());
		// Mutate in place: the module manager and settings tab hold this object.
		Object.assign(this.settings, next);
		this.setLanguage(this.settings.language);
		await this.modules.reconcile();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	setLanguage(language: LanguageSetting): void {
		this.settings.language = language;
		this.translate = createTranslator(resolveLocale(language, getLanguage()));
	}

	private warnReadOnly(canvas: CanvasLike, found: number | string): void {
		if (this.readOnlyWarned.has(canvas)) return;
		this.readOnlyWarned.add(canvas);
		new Notice(this.translate("data.newerSchema", { file: canvas.view.file?.path ?? "?", found, supported: SCHEMA_VERSION }), 15_000);
	}
}
