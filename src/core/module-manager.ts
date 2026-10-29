import { ChoiceModal } from "../ui/choice-modal";
import type { ChoiceAnchor } from "../ui/picker";
import { Component, Notice, Platform, type App, type Command, type Plugin } from "obsidian";
import type { CanvasDataApi } from "../data/access";
import type { Translate } from "../i18n";
import { mergeWithDefaults, type ModuleState, type PluginSettings } from "../settings/settings";
import { getActiveCanvas } from "../internals/guards";
import type { CanvasHooks } from "./canvas-hooks";
import type { CanvasTracker } from "./canvas-tracker";
import type { CanvasUi } from "./canvas-ui";
import type { PublicEvents } from "./events";
import type { HistoryApi } from "./history";
import type { AnyModule, ModuleContext, PluginInspector } from "./module";
import type { Patcher } from "./patcher";
import { sortByDependencies } from "./dependencies";
import { logError } from "./log";

export interface ModuleHost {
	readonly app: App;
	readonly plugin: Plugin;
	readonly patcher: Patcher;
	readonly tracker: CanvasTracker;
	readonly hooks: CanvasHooks;
	readonly ui: CanvasUi;
	readonly data: CanvasDataApi;
	readonly history: HistoryApi;
	readonly events: PublicEvents;
	readonly settings: PluginSettings;
	t(): Translate;
	saveSettings(): Promise<void>;
	/** Called whenever the number of enabled modules changes. */
	onActiveModulesChange?(count: number): void;
}

export type ModuleStatus = "enabled" | "disabled" | "failed" | "unavailable";

type SettingsListener = (next: Readonly<object>, prev: Readonly<object>) => void;

interface ActiveModule {
	readonly def: AnyModule;
	readonly component: Component;
	readonly ctx: ModuleContext<object>;
	readonly listeners: Set<SettingsListener>;
	current: object;
}

/** Owns the enable/disable lifecycle of every module, in dependency order, with error isolation. */
export class ModuleManager {
	private readonly byId = new Map<string, AnyModule>();
	private readonly active = new Map<string, ActiveModule>();
	private readonly failed = new Set<string>();
	/** Topological order: dependencies before dependents. */
	readonly ordered: readonly AnyModule[];

	constructor(
		private readonly host: ModuleHost,
		modules: readonly AnyModule[],
	) {
		for (const def of modules) {
			if (this.byId.has(def.id)) throw new Error(`Duplicate module id "${def.id}"`);
			this.byId.set(def.id, def);
		}
		this.ordered = sortByDependencies(modules);
	}

	get(id: string): AnyModule | undefined {
		return this.byId.get(id);
	}

	isAvailable(def: AnyModule): boolean {
		return def.platforms !== "desktop-only" || !Platform.isMobile;
	}

	status(id: string): ModuleStatus {
		const def = this.byId.get(id);
		if (!def || !this.isAvailable(def)) return "unavailable";
		if (this.active.has(id)) return "enabled";
		if (this.failed.has(id)) return "failed";
		return "disabled";
	}

	activeIds(): string[] {
		return [...this.active.keys()];
	}

	/** The live context of an enabled module (for its settings UI). */
	contextOf(id: string): ModuleContext<object> | undefined {
		return this.active.get(id)?.ctx;
	}

	/** Stored settings of a module merged with its defaults. */
	settingsOf(def: AnyModule): object {
		return this.resolveSettings(def, this.state(def).settings);
	}

	async startAll(): Promise<void> {
		for (const def of this.ordered) {
			if (this.active.has(def.id) || !this.state(def).enabled || !this.isAvailable(def)) continue;
			if (!(def.dependsOn ?? []).every((dep) => this.active.has(dep))) continue;
			await this.activate(def);
		}
	}

	/** Brings running modules in line with the stored settings (after an external change). */
	async reconcile(): Promise<void> {
		for (const def of [...this.ordered].reverse()) {
			const shouldRun = this.state(def).enabled && this.isAvailable(def) && (def.dependsOn ?? []).every((dep) => this.state(this.byId.get(dep)!).enabled);
			if (!shouldRun && this.active.has(def.id)) this.deactivate(def.id);
		}
		for (const mod of this.active.values()) this.applySettings(mod, this.settingsOf(mod.def));
		await this.startAll();
	}

	async stopAll(): Promise<void> {
		for (const def of [...this.ordered].reverse()) if (this.active.has(def.id)) this.deactivate(def.id);
	}

	/** Returns false when the change was refused (missing dependency or failed start). */
	async setEnabled(id: string, enabled: boolean): Promise<boolean> {
		const def = this.byId.get(id);
		if (!def || !this.isAvailable(def)) return false;
		const t = this.host.t();

		if (enabled) {
			const missing = (def.dependsOn ?? []).find((dep) => !this.active.has(dep));
			if (missing) {
				const dependency = this.byId.get(missing);
				new Notice(t("module.enable.missingDependency", { dependency: dependency ? t(dependency.name) : missing, module: t(def.name) }));
				return false;
			}
			this.state(def).enabled = true;
			await this.host.saveSettings();
			return this.active.has(id) || (await this.activate(def));
		}

		const dependents = this.dependentsOf(id).filter((d) => this.active.has(d.id));
		for (const dep of [...dependents].reverse()) {
			this.deactivate(dep.id);
			this.state(dep).enabled = false;
		}
		if (dependents.length > 0)
			new Notice(t("module.disable.cascade", { modules: dependents.map((d) => t(d.name)).join(", "), module: t(def.name) }));
		this.deactivate(id);
		this.failed.delete(id);
		this.state(def).enabled = false;
		await this.host.saveSettings();
		return true;
	}

	async resetSettings(id: string): Promise<void> {
		const def = this.byId.get(id);
		if (!def) return;
		this.state(def).settings = {};
		await this.host.saveSettings();
		const mod = this.active.get(id);
		if (mod) this.applySettings(mod, this.resolveSettings(def, {}));
	}

	private state(def: AnyModule): ModuleState {
		const all = this.host.settings.modules;
		return (all[def.id] ??= { enabled: def.defaultEnabled, settings: {} });
	}

	private resolveSettings(def: AnyModule, stored: unknown): object {
		const defaults = def.defaultSettings;
		try {
			return def.sanitizeSettings ? def.sanitizeSettings(stored, defaults) : mergeWithDefaults(stored, defaults);
		} catch (error) {
			logError(`[overpowered-canvas] settings of "${def.id}" are invalid; using defaults`, error);
			return { ...defaults };
		}
	}

	private applySettings(mod: ActiveModule, next: object): void {
		const prev = mod.current;
		mod.current = Object.freeze({ ...next });
		for (const listener of mod.listeners) {
			try {
				listener(mod.current, prev);
			} catch (error) {
				logError(`[overpowered-canvas] settings listener of "${mod.def.id}" threw`, error);
			}
		}
	}

	private dependentsOf(id: string): AnyModule[] {
		const result: AnyModule[] = [];
		const visit = (target: string) => {
			for (const def of this.ordered) {
				if (def.dependsOn?.includes(target) && !result.includes(def)) {
					result.push(def);
					visit(def.id);
				}
			}
		};
		visit(id);
		return result;
	}

	private async activate(def: AnyModule): Promise<boolean> {
		const { host } = this;
		const component = new Component();
		component.load();
		const bodyClass = `opc-mod-${def.id}`;
		document.body.addClass(bodyClass);
		component.register(() => document.body.removeClass(bodyClass));

		const mod: ActiveModule = {
			def,
			component,
			listeners: new Set(),
			current: Object.freeze({ ...this.settingsOf(def) }),
			ctx: undefined as unknown as ModuleContext<object>,
		};
		const inspect: PluginInspector = {
			patches: () => host.patcher.list(),
			activeModules: () => this.activeIds(),
			openCanvasCount: () => host.tracker.openCanvases().length,
		};
		const ctx: ModuleContext<object> = {
			moduleId: def.id,
			app: host.app,
			get t() {
				return host.t();
			},
			get settings() {
				return mod.current;
			},
			filesFolder: () => host.settings.filesFolder,
			updateSettings: async (patch) => {
				const next = this.resolveSettings(def, { ...mod.current, ...patch });
				this.state(def).settings = { ...next };
				await host.saveSettings();
				this.applySettings(mod, next);
			},
			onSettingsChange: (cb) => {
				const listener = cb;
				mod.listeners.add(listener);
				component.register(() => mod.listeners.delete(listener));
			},
			patch: (label, target, factories) => {
				component.register(host.patcher.apply(def.id, label, target, factories));
			},
			onCanvas: (cb) => {
				component.register(host.tracker.subscribe(cb));
			},
			addCommand: (command: Command) => {
				const id = `${def.id}:${command.id}`;
				const added = host.plugin.addCommand({ ...command, id });
				component.register(() => host.plugin.removeCommand(id));
				return added;
			},
			addStatusBarItem: () => {
				const el = host.plugin.addStatusBarItem();
				component.register(() => el.remove());
				return el;
			},
			addCanvasKey: (spec) => component.register(host.ui.addCanvasKey(spec)),
			registerView: (type, factory) => {
				const app = host.plugin.app;
				host.plugin.registerView(type, factory);
				component.register(() => {
					app.workspace.detachLeavesOfType(type);
					(app as unknown as { viewRegistry: { unregisterView(type: string): void } }).viewRegistry.unregisterView(type);
				});
			},
			registerEvent: (ref) => component.registerEvent(ref),
			registerDomEvent: (el: HTMLElement | Window, type: string, cb: (ev: Event) => unknown, options?: boolean | AddEventListenerOptions) =>
				component.registerDomEvent(el as HTMLElement, type as keyof HTMLElementEventMap, cb, options),
			registerInterval: (id) => component.registerInterval(id),
			register: (cleanup) => component.register(cleanup),
			data: host.data,
			history: host.history,
			events: host.events,
			inspect,
			on: (name, listener) => component.register(host.hooks.on(name, listener)),
			intercept: (name, fn) => component.register(host.hooks.intercept(name, fn)),
			transformData: (fn) => component.register(host.hooks.transformData(fn)),
			decorateNodes: (decorator) => component.register(host.ui.decorateNodes(decorator)),
			decorateEdges: (decorator) => component.register(host.ui.decorateEdges(decorator)),
			addMenuButton: (spec) => {
				const offButton = host.ui.addMenuButton(spec);
				let offCommand = () => {};
				if (spec.command !== false) {
					// Every toolbar action is also a command on the current selection.
					const id = `${def.id}:selection-${spec.id}`;
					const label = typeof spec.tooltip === "function" ? spec.tooltip() : spec.tooltip;
					host.plugin.addCommand({
						id,
						name: host.t()("common.selectionCommand", { name: label }),
						checkCallback: (checking) => {
							const canvas = getActiveCanvas(host.app);
							if (!canvas) return false;
							const selection = [...canvas.selection];
							if (selection.length === 0 || (canvas.readonly && !spec.readonly) || !spec.isVisible(selection, canvas)) return false;
							if (!checking) {
								const anchor = createDiv() as ChoiceAnchor;
								anchor.opcChoose = (sections, onPick) =>
									new ChoiceModal(
										host.app,
										label,
										sections.flatMap((s) => s.items.map((i) => ({ ...i, id: i.id, label: s.title ? `${s.title}: ${i.label}` : i.label, svg: typeof i.svg === "string" ? i.svg : undefined }))),
										onPick,
									).open();
								spec.onClick({ canvas, selection, buttonEl: anchor });
							}
							return true;
						},
					});
					offCommand = () => host.plugin.removeCommand(id);
				}
				const off = () => {
					offButton();
					offCommand();
				};
				component.register(off);
				return off;
			},
			addRibbonIcon: (icon, title, onClick) => {
				const el = host.plugin.addRibbonIcon(icon, title, onClick);
				component.register(() => el.detach());
				return el;
			},
			addCardMenuButton: (spec) => {
				const off = host.ui.addCardMenuButton(spec);
				component.register(off);
				return off;
			},
			onNodeMenu: (cb) => component.registerEvent(workspaceOn(host.app, "canvas:node-menu", cb as (...a: unknown[]) => void)),
			onEdgeMenu: (cb) => component.registerEvent(workspaceOn(host.app, "canvas:edge-menu", cb as (...a: unknown[]) => void)),
			onSelectionMenu: (cb) => component.registerEvent(workspaceOn(host.app, "canvas:selection-menu", cb as (...a: unknown[]) => void)),
			canvases: () => host.tracker.openCanvases().map((v) => v.canvas),
			activeCanvas: () => getActiveCanvas(host.app),
		};
		(mod as { ctx: ModuleContext<object> }).ctx = ctx;

		try {
			await def.enable(ctx);
		} catch (error) {
			logError(`[overpowered-canvas] module "${def.id}" failed to enable`, error);
			this.teardown(mod);
			this.failed.add(def.id);
			new Notice(host.t()("module.enable.failed", { module: host.t()(def.name) }));
			return false;
		}
		this.failed.delete(def.id);
		this.active.set(def.id, mod);
		host.onActiveModulesChange?.(this.active.size);
		host.events.emit("module-enabled", def.id);
		return true;
	}

	private deactivate(id: string): void {
		const mod = this.active.get(id);
		if (!mod) return;
		this.active.delete(id);
		this.teardown(mod);
		this.host.onActiveModulesChange?.(this.active.size);
		this.host.events.emit("module-disabled", id);
	}

	private teardown(mod: ActiveModule): void {
		try {
			mod.def.disable?.();
		} catch (error) {
			logError(`[overpowered-canvas] module "${mod.def.id}" threw in disable()`, error);
		}
		try {
			mod.component.unload();
		} catch (error) {
			logError(`[overpowered-canvas] cleanup of "${mod.def.id}" failed`, error);
		}
	}
}

/** Workspace events Obsidian fires for canvas context menus are not in the public typings. */
function workspaceOn(app: App, name: string, cb: (...args: unknown[]) => void) {
	return (app.workspace as unknown as { on(name: string, cb: (...args: unknown[]) => void): import("obsidian").EventRef }).on(name, (...args: unknown[]) => {
		try {
			cb(...args);
		} catch (error) {
			logError(`[overpowered-canvas] ${name} handler failed`, error);
		}
	});
}
