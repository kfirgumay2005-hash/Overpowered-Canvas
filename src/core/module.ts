import type { App, Command, EventRef, Menu, ViewCreator } from "obsidian";
import type { CanvasDataApi } from "../data/access";
import type { I18nKey, Translate } from "../i18n";
import type { CanvasEdgeLike, CanvasLike, CanvasNodeLike, CanvasViewLike } from "../internals/types";
import type { DataTransformer, HookMap, HookName, InterceptorMap, InterceptorName } from "./canvas-hooks";
import type { CanvasKeySpec, CardMenuButtonSpec, EdgeDecorator, MenuButtonSpec, NodeDecorator } from "./canvas-ui";
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
export type OverlappingPlugin = "advanced-canvas" | "canvas-mindmap" | "cammvas" | "canvas-kit";

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
	sanitizeSettings?(raw: unknown, defaults: S): S;

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

	/** Canvas hooks (see core/canvas-hooks.ts); unsubscribed on disable. */
	on<K extends HookName>(name: K, listener: (...args: HookMap[K]) => void): void;
	intercept<K extends InterceptorName>(name: K, fn: (...args: InterceptorMap[K]) => unknown): void;
	/** Rewrites what canvas.getData() returns (saving, history, copy). Must not mutate its input. */
	transformData(fn: DataTransformer): void;
	decorateNodes(decorator: NodeDecorator): void;
	decorateEdges(decorator: EdgeDecorator): void;
	/** Returns a function that removes the button early; it is removed on disable anyway. */
	addMenuButton(spec: MenuButtonSpec): () => void;
	addCardMenuButton(spec: CardMenuButtonSpec): () => void;
	/** A canvas-local key (shared dispatch by priority; see CanvasUi.addCanvasKey). */
	addCanvasKey(spec: CanvasKeySpec): void;
	/** A workspace view type; its leaves are closed and the type unregistered on disable. */
	registerView(type: string, factory: ViewCreator): void;
	/** Context menus of nodes / edges / multi-selections (public workspace events). */
	onNodeMenu(cb: (menu: Menu, node: CanvasNodeLike) => void): void;
	onEdgeMenu(cb: (menu: Menu, edge: CanvasEdgeLike) => void): void;
	onSelectionMenu(cb: (menu: Menu, canvas: CanvasLike) => void): void;
	/** Open canvases right now. */
	canvases(): CanvasLike[];
	/** The canvas of the most recent canvas leaf, if it is the active view. */
	activeCanvas(): CanvasLike | null;
}

export interface PluginInspector {
	patches(): PatchRecord[];
	activeModules(): string[];
	openCanvasCount(): number;
}

/** Type-erased definition for the registry. */
export type AnyModule = ModuleDefinition<object>;

/** Identity helper that keeps the settings type inferred. */
export function defineModule<S extends object>(definition: ModuleDefinition<S>): ModuleDefinition<S> {
	return definition;
}
