import type { App, Command, EventRef } from "obsidian";
import type { CanvasDataApi } from "../data/access";
import type { I18nKey, Translate } from "../i18n";
import type { CanvasLike, CanvasViewLike } from "../internals/types";
import type { PublicEvents } from "./events";
import type { HistoryApi } from "./history";
import type { PatchFactories, PatchRecord } from "./patcher";

export type SettingsGroup =
	| "core"
	| "nodes"
	| "edges"
	| "vault"
	| "interaction"
	| "mindmap"
	| "drawing"
	| "navigation"
	| "data"
	| "developer";

export const SETTINGS_GROUP_ORDER: readonly SettingsGroup[] = [
	"core",
	"nodes",
	"edges",
	"vault",
	"interaction",
	"mindmap",
	"drawing",
	"navigation",
	"data",
	"developer",
];

/** Community plugins whose features overlap ours (manifest ids). */
export type OverlappingPlugin = "advanced-canvas" | "canvas-mindmap";

/**
 * A feature module. Everything a module registers goes through its ModuleContext and is
 * undone automatically when the module is disabled: zero patches, listeners and DOM remain.
 * Module CSS must be scoped under `body.opc-mod-<id>`, a class present only while enabled.
 */
export interface ModuleDefinition<S extends object = Record<string, never>> {
	/** kebab-case; used as settings key, CSS scope and command-id prefix. Never rename. */
	readonly id: string;
	readonly name: I18nKey;
	readonly description: I18nKey;
	readonly group: SettingsGroup;
	readonly defaultEnabled: boolean;
	readonly defaultSettings: S;
	/** Modules that must be enabled first. Disabling one of them disables this module too. */
	readonly dependsOn?: readonly string[];
	readonly overlapsWith?: readonly OverlappingPlugin[];
	readonly platforms?: "all" | "desktop-only";
	/** Pure; turns stored settings (possibly from an older version) into valid settings. */
	readonly sanitizeSettings?: (raw: unknown, defaults: S) => S;

	enable(ctx: ModuleContext<S>): void | Promise<void>;
	/** Only for cleanup the context cannot track. */
	disable?(): void;
	renderSettings?(containerEl: HTMLElement, ctx: ModuleContext<S>): void;
}

export interface ModuleContext<S extends object> {
	readonly moduleId: string;
	readonly app: App;
	readonly t: Translate;
	readonly settings: Readonly<S>;
	updateSettings(patch: Partial<S>): Promise<void>;
	onSettingsChange(cb: (next: Readonly<S>, prev: Readonly<S>) => void): void;

	/** monkey-around patch, reverted on disable. `label` names it in diagnostics. */
	patch<T extends object>(label: string, target: T, factories: PatchFactories<T>): void;
	/** Called for every open and future canvas view; the returned function runs on close or disable. */
	onCanvas(cb: (canvas: CanvasLike, view: CanvasViewLike) => (() => void) | void): void;
	/** Command id is prefixed with "<module-id>:". */
	addCommand(command: Command): Command;
	addStatusBarItem(): HTMLElement;
	registerEvent(ref: EventRef): void;
	registerDomEvent<K extends keyof HTMLElementEventMap>(
		el: HTMLElement,
		type: K,
		cb: (ev: HTMLElementEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void;
	registerDomEvent<K extends keyof WindowEventMap>(
		el: Window,
		type: K,
		cb: (ev: WindowEventMap[K]) => unknown,
		options?: boolean | AddEventListenerOptions,
	): void;
	registerInterval(id: number): number;
	register(cleanup: () => void): void;

	readonly data: CanvasDataApi;
	readonly history: HistoryApi;
	readonly events: PublicEvents;
	/** Read-only view of the plugin's own state, for diagnostics. */
	readonly inspect: PluginInspector;
}

export interface PluginInspector {
	patches(): PatchRecord[];
	activeModules(): string[];
	openCanvasCount(): number;
}

/** Type-erased definition for the registry. */
export type AnyModule = ModuleDefinition<any>;

/** Identity helper that keeps the settings type inferred. */
export function defineModule<S extends object>(definition: ModuleDefinition<S>): ModuleDefinition<S> {
	return definition;
}
