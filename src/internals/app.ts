/**
 * Typed access to undocumented App members (see docs/INTERNALS.md → "App"). Each accessor
 * returns null when the member is missing, so callers can degrade gracefully.
 */
import type { App, Command, TFile } from "obsidian";
import type { CoreCanvasIndexEntry } from "../modules/canvas-metadata/build";

export interface MetadataCacheInternal {
	getCache(path: string): unknown;
	iterateFileCache(cb: (path: string, meta: unknown) => void): void;
	isUserIgnored?(path: string): boolean;
	trigger(name: string, ...args: unknown[]): void;
}

export interface CoreCanvasPluginLike {
	index: { getForPath(path: string): CoreCanvasIndexEntry | null };
	options: Record<string, unknown>;
}

export interface EmbedContext {
	app: App;
	containerEl: HTMLElement;
	linktext: string;
	sourcePath: string;
	showInline?: boolean;
	depth?: number;
}

export type EmbedCreator = (ctx: EmbedContext, file: TFile, subpath: string) => unknown;

export function coreCanvasPlugin(app: App): CoreCanvasPluginLike | null {
	const instance = (app as unknown as { internalPlugins?: { plugins?: { canvas?: { enabled?: boolean; instance?: unknown } } } }).internalPlugins?.plugins?.canvas;
	const plugin = instance?.instance as CoreCanvasPluginLike | undefined;
	return plugin && typeof plugin.index?.getForPath === "function" ? plugin : null;
}

export function embedRegistry(app: App): { embedByExtension: Record<string, EmbedCreator> } | null {
	const reg = (app as unknown as { embedRegistry?: { embedByExtension?: Record<string, EmbedCreator> } }).embedRegistry;
	return reg?.embedByExtension ? (reg as { embedByExtension: Record<string, EmbedCreator> }) : null;
}

/** The app's command list (the command palette reads the same one). */
export function commandRunner(app: App): { listCommands(): Command[]; executeCommandById(id: string): boolean } | null {
	const commands = (app as unknown as { commands?: { listCommands?: unknown; executeCommandById?: unknown } }).commands;
	return typeof commands?.listCommands === "function" && typeof commands.executeCommandById === "function" ? (commands as { listCommands(): Command[]; executeCommandById(id: string): boolean }) : null;
}

export function metadataCacheInternal(app: App): MetadataCacheInternal | null {
	const mc = app.metadataCache as unknown as MetadataCacheInternal;
	return typeof mc.getCache === "function" && typeof mc.iterateFileCache === "function" ? mc : null;
}
