/**
 * Shared UI extension points built on CanvasHooks: node/edge decorators, popup-menu buttons
 * and card-menu (bottom bar) buttons. Every registration returns a disposer that removes all
 * DOM it created, so a disabled module leaves nothing behind.
 */
import { Menu, setIcon, setTooltip, type Scope } from "obsidian";
import { readEdge, readNode } from "../data/validate";
import { SCHEMA_KEY, type OpcEdge, type OpcNode } from "../data/schema";
import type { CanvasEdgeLike, CanvasItemLike, CanvasLike, CanvasMenuLike, CanvasNodeLike, CanvasViewLike, Point } from "../internals/types";
import type { CanvasHooks } from "./canvas-hooks";
import type { CanvasTracker } from "./canvas-tracker";
import { logError } from "./log";
import type { ShortcutId } from "./shortcuts/catalog";
import { comboFromEvent } from "./shortcuts/keys";
import type { ShortcutStore } from "./shortcuts/store";

export interface NodeDecorator {
	/** Called after render, setData and our own writes. Must be idempotent and cheap. */
	apply(node: CanvasNodeLike, extra: Readonly<OpcNode>): void;
	/** Remove everything apply() added. */
	clear(node: CanvasNodeLike): void;
}

export interface EdgeDecorator {
	apply(edge: CanvasEdgeLike, extra: Readonly<OpcEdge>): void;
	clear(edge: CanvasEdgeLike): void;
}

export interface MenuButtonContext {
	canvas: CanvasLike;
	selection: CanvasItemLike[];
	buttonEl: HTMLElement;
	/** Absent when run from the command palette. */
	evt?: MouseEvent;
}

export interface MenuButtonSpec {
	id: string;
	icon: string | ((selection: CanvasItemLike[]) => string);
	tooltip: string | (() => string);
	/** Lower comes first. Core buttons come before all of ours. */
	order?: number;
	/** Shown in read-only mode too (default: hidden). */
	readonly?: boolean;
	/**
	 * Also offered as a command acting on the selection (default true); its picker opens as a
	 * searchable list. Set false when the module has its own command for it.
	 */
	command?: boolean;
	isVisible(selection: CanvasItemLike[], canvas: CanvasLike): boolean;
	/** Toggle buttons: highlighted while true. */
	isActive?(selection: CanvasItemLike[], canvas: CanvasLike): boolean;
	onClick(ctx: MenuButtonContext): void;
}

export interface CardMenuButtonSpec {
	id: string;
	icon: string;
	tooltip: string | (() => string);
	order?: number;
	/** Click on the button. */
	onClick(canvas: CanvasLike, evt: MouseEvent): void;
	/** Drag from the button to place an item, like the core card buttons. */
	drag?: { size(canvas: CanvasLike): { width: number; height: number }; drop(canvas: CanvasLike, pos: Point): void };
	/** Right-click on the button. */
	onContextMenu?(canvas: CanvasLike, evt: MouseEvent): void;
}

export interface CanvasKeySpec {
	/** Which shortcut of the catalog (core/shortcuts/catalog.ts); its keys come from the Shortcuts window. */
	shortcut: ShortcutId;
	/** Higher runs first. */
	priority?: number;
	/** Return true when handled (stops other handlers and the default). */
	handle(canvas: CanvasLike, evt: KeyboardEvent): boolean;
	/** Run even while the user types in a card or input (default false). */
	whileTyping?: boolean;
}

/** True while the user is typing somewhere (card editor, label, input). */
export function isTyping(evt: KeyboardEvent): boolean {
	const t = evt.target as HTMLElement | null;
	return !!t?.closest?.("input, textarea, select, [contenteditable=true], .markdown-source-view, iframe");
}

export const isNode = (item: CanvasItemLike): item is CanvasNodeLike => "nodeEl" in item;
export const isEdge = (item: CanvasItemLike): item is CanvasEdgeLike => "lineGroupEl" in item;

/**
 * Text cards edit inside an iframe. The node's data-* attributes (ours and custom style
 * attributes), dir and our CSS variables (--opc-*) are mirrored onto that iframe's <body>, so
 * CSS keyed on them also styles the editor.
 */
export function mirrorToFrame(node: CanvasNodeLike): void {
	const frame = node.contentEl?.querySelector<HTMLIFrameElement>("iframe.embed-iframe");
	const body = frame?.contentDocument?.body;
	if (!body) return;
	// Remember which attributes we put there, so we only ever remove our own.
	const mine = new Set((body.getAttribute("data-opc-mirrored") ?? "").split(" ").filter(Boolean));
	for (const name of mine) if (!node.nodeEl.hasAttribute(name)) body.removeAttribute(name);
	const next: string[] = [];
	for (const attr of [...node.nodeEl.attributes]) {
		if (!attr.name.startsWith("data-") && attr.name !== "dir") continue;
		body.setAttribute(attr.name, attr.value);
		next.push(attr.name);
	}
	body.setAttribute("data-opc-mirrored", next.join(" "));
	const vars: Record<string, string> = {};
	for (const name of (body.getAttribute("data-opc-mirrored-vars") ?? "").split(" ").filter(Boolean)) vars[name] = "";
	const style = node.nodeEl.style;
	for (let i = 0; i < style.length; i++) {
		const name = style.item(i);
		if (name.startsWith("--opc-")) vars[name] = style.getPropertyValue(name);
	}
	body.setCssProps(vars);
	body.setAttribute("data-opc-mirrored-vars", Object.keys(vars).filter((k) => vars[k]).join(" "));
}

export class CanvasUi {
	private readonly menuButtons = new Set<MenuButtonSpec>();
	private menuHookOff: (() => void) | null = null;
	private readonly cardButtons = new Map<CardMenuButtonSpec, Map<CanvasLike, HTMLElement>>();
	private cardTrackOff: (() => void) | null = null;
	private readonly keySpecs = new Set<CanvasKeySpec>();
	private keyTrackOff: (() => void) | null = null;
	/** Per view: the one scope handler that dispatches every canvas shortcut. */
	private readonly keyHandlers = new Map<CanvasViewLike, unknown>();

	constructor(
		private readonly hooks: CanvasHooks,
		private readonly tracker: CanvasTracker,
		private readonly shortcuts: ShortcutStore,
	) {}

	decorateNodes(decorator: NodeDecorator): () => void {
		const run = (node: CanvasNodeLike) => {
			try {
				decorator.apply(node, readNode(node.unknownData[SCHEMA_KEY]));
				if (node.isEditing) mirrorToFrame(node);
			} catch (error) {
				logError("[overpowered-canvas] node decorator failed", error);
			}
		};
		// The editor iframe is created asynchronously after edit mode starts.
		const onEditing = (node: CanvasNodeLike, editing: boolean) => {
			if (!editing) return;
			let tries = 0;
			const attempt = () => {
				mirrorToFrame(node);
				if (!node.contentEl?.querySelector("iframe.embed-iframe")?.getAttribute("data-opc-synced") && tries++ < 10) {
					const frame = node.contentEl?.querySelector<HTMLIFrameElement>("iframe.embed-iframe");
					if (frame?.contentDocument?.body) frame.setAttribute("data-opc-synced", "1");
					else window.setTimeout(attempt, 50);
				}
			};
			attempt();
		};
		const offs = [
			this.hooks.on("node-render", run),
			this.hooks.on("node-set-data", run),
			this.hooks.on("node-extra-change", run),
			this.hooks.on("node-editing", onEditing),
		];
		this.hooks.forEachNode(run);
		return () => {
			for (const off of offs) off();
			this.hooks.forEachNode((node) => {
				decorator.clear(node);
				mirrorToFrame(node);
			});
			// Nodes of canvases closed meanwhile are gone with their views.
		};
	}

	decorateEdges(decorator: EdgeDecorator): () => void {
		const run = (edge: CanvasEdgeLike) => {
			try {
				decorator.apply(edge, readEdge(edge.unknownData[SCHEMA_KEY]));
			} catch (error) {
				logError("[overpowered-canvas] edge decorator failed", error);
			}
		};
		const offs = [this.hooks.on("edge-render", run), this.hooks.on("edge-set-data", run), this.hooks.on("edge-extra-change", run)];
		this.hooks.forEachEdge(run);
		return () => {
			for (const off of offs) off();
			this.hooks.forEachEdge((edge) => decorator.clear(edge));
		};
	}

	addMenuButton(spec: MenuButtonSpec): () => void {
		if (this.menuButtons.has(spec)) return () => {};
		this.menuButtons.add(spec);
		if (!this.menuHookOff) this.menuHookOff = this.hooks.on("menu-render", (menu) => this.renderMenuButtons(menu));
		this.rerenderMenus();
		return () => {
			if (!this.menuButtons.delete(spec)) return;
			if (this.menuButtons.size === 0) {
				this.menuHookOff?.();
				this.menuHookOff = null;
			}
			this.rerenderMenus();
		};
	}

	addCardMenuButton(spec: CardMenuButtonSpec): () => void {
		this.cardButtons.set(spec, new Map());
		if (!this.cardTrackOff) {
			this.cardTrackOff = this.tracker.subscribe((canvas) => {
				for (const s of this.cardButtons.keys()) this.mountCardButton(s, canvas);
				return () => {
					for (const map of this.cardButtons.values()) {
						map.get(canvas)?.remove();
						map.delete(canvas);
					}
					markCardMenu(canvas.cardMenuEl);
				};
			});
		} else for (const view of this.tracker.openCanvases()) this.mountCardButton(spec, view.canvas);
		return () => {
			const map = this.cardButtons.get(spec);
			if (!map) return;
			for (const el of map.values()) {
				const menu = el.parentElement;
				el.remove();
				if (menu) markCardMenu(menu);
			}
			this.cardButtons.delete(spec);
			if (this.cardButtons.size === 0) {
				this.cardTrackOff?.();
				this.cardTrackOff = null;
			}
		};
	}

	/**
	 * Canvas-local shortcuts, shared between modules. Each canvas view gets one handler at the front
	 * of its keymap scope: it turns the key press into a combo, runs the shortcuts bound to it (keys
	 * from the Shortcuts window, read on every press, so a change works at once) by priority, and
	 * lets anything it doesn't handle through to the canvas' own keys and Obsidian's hotkeys.
	 */
	addCanvasKey(spec: CanvasKeySpec): () => void {
		this.keySpecs.add(spec);
		if (!this.keyTrackOff) {
			this.keyTrackOff = this.tracker.subscribe((canvas, view) => {
				this.bindKeys(canvas, view);
				return () => this.unbindKeys(view);
			});
		}
		return () => {
			if (!this.keySpecs.delete(spec)) return;
			if (this.keySpecs.size === 0) {
				this.keyTrackOff?.();
				this.keyTrackOff = null;
			}
		};
	}

	private bindKeys(canvas: CanvasLike, view: CanvasViewLike): void {
		const scope = (view as CanvasViewLike & { scope: (Scope & { keys?: unknown[] }) | null }).scope;
		if (!scope || this.keyHandlers.has(view)) return;
		const handler = scope.register(null, null, (evt) => {
			const combo = comboFromEvent(evt, this.shortcuts.mac);
			if (!combo) return undefined;
			const typing = isTyping(evt);
			const specs = [...this.keySpecs].filter((s) => (!typing || s.whileTyping) && this.shortcuts.combos(s.shortcut).includes(combo)).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
			for (const s of specs) {
				try {
					if (s.handle(canvas, evt)) return false;
				} catch (error) {
					logError("[overpowered-canvas] key handler failed", error);
				}
			}
			// Not ours: the canvas' own keys and Obsidian's hotkeys get it.
			return undefined;
		}) as unknown;
		// First in the scope, so a key moved onto one the canvas uses itself still reaches us.
		const keys = scope.keys;
		if (Array.isArray(keys) && keys[keys.length - 1] === handler) keys.unshift(keys.pop());
		this.keyHandlers.set(view, handler);
	}

	private unbindKeys(view: CanvasViewLike): void {
		const handler = this.keyHandlers.get(view);
		const scope = (view as CanvasViewLike & { scope: Scope | null }).scope;
		if (handler && scope) scope.unregister(handler as never);
		this.keyHandlers.delete(view);
	}

	/** Shows an Obsidian menu anchored under a toolbar button, like the core align menu. */
	static menuUnder(buttonEl: HTMLElement, build: (menu: Menu) => void): void {
		if (buttonEl.hasClass("has-active-menu")) return;
		const menu = new Menu();
		menu.setUseNativeMenu(false);
		build(menu);
		const rect = buttonEl.getBoundingClientRect();
		(menu as Menu & { setParentElement?(el: HTMLElement): Menu }).setParentElement?.(buttonEl);
		menu.showAtPosition({ x: rect.x, y: rect.bottom, width: rect.width, overlap: true });
	}

	private rerenderMenus(): void {
		for (const view of this.tracker.openCanvases()) {
			const canvas = view.canvas;
			if (canvas.selection.size > 0) {
				try {
					canvas.menu.render(true);
				} catch (error) {
					logError("[overpowered-canvas] menu re-render failed", error);
				}
			}
		}
	}

	private renderMenuButtons(menu: CanvasMenuLike): void {
		const canvas = menu.canvas;
		const selection = [...canvas.selection];
		const specs = [...this.menuButtons].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
		for (const spec of specs) {
			if (canvas.readonly && !spec.readonly) continue;
			let visible = false;
			try {
				visible = spec.isVisible(selection, canvas);
			} catch (error) {
				logError(`[overpowered-canvas] menu button ${spec.id} failed`, error);
			}
			if (!visible) continue;
			const button = menu.menuEl.createEl("button", { cls: `clickable-icon opc-menu-button opc-menu-${spec.id}` });
			setIcon(button, typeof spec.icon === "function" ? spec.icon(selection) : spec.icon);
			setTooltip(button, typeof spec.tooltip === "function" ? spec.tooltip() : spec.tooltip, { placement: "top" });
			if (spec.isActive?.(selection, canvas)) {
				button.addClass("is-active");
				button.setAttribute("aria-pressed", "true");
			}
			button.addEventListener("click", (evt) => {
				try {
					spec.onClick({ canvas, selection: [...canvas.selection], buttonEl: button, evt });
				} catch (error) {
					logError(`[overpowered-canvas] menu button ${spec.id} failed`, error);
				}
			});
		}
	}

	private mountCardButton(spec: CardMenuButtonSpec, canvas: CanvasLike): void {
		const map = this.cardButtons.get(spec);
		if (!map || map.has(canvas)) return;
		const el = createDiv({ cls: `canvas-card-menu-button opc-card-button opc-card-${spec.id}${spec.drag ? " mod-draggable" : ""}` });
		el.dataset.opcOrder = String(spec.order ?? 100);
		setIcon(el, spec.icon);
		setTooltip(el, typeof spec.tooltip === "function" ? spec.tooltip() : spec.tooltip, { placement: "top" });
		el.addEventListener("click", (evt) => spec.onClick(canvas, evt));
		if (spec.drag) {
			const drag = spec.drag;
			el.addEventListener("pointerdown", (evt) => {
				if (canvas.readonly) return;
				canvas.dragTempNode(evt, drag.size(canvas), (pos) => drag.drop(canvas, pos));
			});
		}
		if (spec.onContextMenu) {
			el.addEventListener("contextmenu", (evt) => {
				evt.preventDefault();
				spec.onContextMenu?.(canvas, evt);
			});
		}
		// Keep our buttons sorted after the core ones.
		const siblings = [...canvas.cardMenuEl.querySelectorAll<HTMLElement>(".opc-card-button")];
		const before = siblings.find((s) => Number(s.dataset.opcOrder) > (spec.order ?? 100));
		if (before) canvas.cardMenuEl.insertBefore(el, before);
		else canvas.cardMenuEl.appendChild(el);
		map.set(canvas, el);
		markCardMenu(canvas.cardMenuEl);
	}
}

/** Marks a card bar holding our buttons (another plugin may hide the bar; ours keep it). */
function markCardMenu(menu: HTMLElement): void {
	menu.toggleClass("opc-has-card-buttons", !!menu.querySelector(":scope > .opc-card-button"));
}
