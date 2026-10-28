import type { App } from "obsidian";
import type { CanvasDataApi } from "../data/access";
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData } from "../data/json-canvas";
import type { OpcEdge, OpcNode, OpcRoot } from "../data/schema";
import type { I18nKey, Translate } from "../i18n";
import type { CanvasLike, CanvasNodeLike } from "../internals/types";

/**
 * Everything a tutorial step can look at and do. Checks read the live canvas; demos ("Show me")
 * change it the way the user would, so the result stays on the board to play with.
 */
export interface TutorialRuntime {
	readonly app: App;
	readonly canvas: CanvasLike;
	readonly t: Translate;
	readonly data: CanvasDataApi;
	/** Where the tutorial's practice files are (see TutorialDefinition.files). */
	readonly folder: string;
	/** The canvas as it is now. */
	now(): CanvasFileData;
	/** The canvas as it was when the step started. */
	readonly before: CanvasFileData;
	/** A public "overpowered-canvas:<name>" event (or a canvas hook) fired since the step started. */
	seen(name: string, test?: (...args: unknown[]) => boolean): boolean;
	node(id: string): CanvasNodeLike | undefined;
	/** The x-opc data of a node / edge / the root, as stored now. */
	extra(id: string): OpcNode;
	edgeExtra(id: string): OpcEdge;
	root(): OpcRoot;
	/** A module setting, as stored now. */
	setting(module: string, key: string): unknown;
	/** True while a workspace leaf of that view type is open. */
	viewOpen(type: string): boolean;
	/** Ids of the selected items. */
	selected(): string[];
	select(ids: string[]): void;
	/** Runs a plugin command ("<module>:<id>") or a core one ("app:…"). */
	command(id: string): boolean;
	/** Adds nodes / edges as one undo step and returns the created nodes. */
	add(nodes: CanvasNodeData[], edges?: CanvasEdgeData[]): CanvasNodeLike[];
	/** One undo step of x-opc writes and other canvas changes. */
	change(fn: () => void): void;
	/** Smoothly frames the given items (all of them when empty). */
	look(ids?: string[], padding?: number): void;
	/** Resolves after `ms`; demos use it to pace what they show. */
	wait(ms: number): Promise<void>;
}

export interface TutorialStep {
	title: I18nKey;
	body: I18nKey;
	/** The "Try it" task. Steps without a task are read-only and just need Next. */
	task?: I18nKey;
	/** How to do the task without a keyboard (shown on phones and tablets). */
	touch?: I18nKey;
	/** Done when this returns true (checked on every change and a few times a second). */
	check?(rt: TutorialRuntime): boolean;
	/** "Show me": does the task live on the board. */
	demo?: (rt: TutorialRuntime) => void | Promise<void>;
	/** Control to point at: a selector searched in the canvas first, then the whole window, or a function finding it. */
	target?: string | ((rt: TutorialRuntime) => HTMLElement | null | undefined);
	/** Items to frame when the step starts. */
	focus?: string[];
	/** Runs once when the step starts (e.g. selecting the card the step is about). */
	enter?(rt: TutorialRuntime): void;
}

export interface TutorialDefinition {
	id: string;
	icon: string;
	title: I18nKey;
	summary: I18nKey;
	/** Modules the tutorial needs; offered to turn on before it starts. */
	modules: readonly string[];
	/** Module settings the tutorial may change, put back as they were when it ends. */
	restoreSettings?: readonly { module: string; key: string }[];
	/**
	 * Practice files (notes, other canvases) the board uses, written to the tutorial's own folder
	 * before the board and deleted with it. Paths are relative to that folder.
	 */
	files?(t: Translate): readonly { path: string; content: string }[];
	/** The demo board, in the UI language; `folder` holds its practice files. Node ids are stable so steps can refer to them. */
	board(t: Translate, folder: string): { nodes: CanvasNodeData[]; edges: CanvasEdgeData[]; root?: Partial<OpcRoot> };
	steps: readonly TutorialStep[];
}
