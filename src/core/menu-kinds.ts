/**
 * Which kind of menu is about to open: a right-click (context) menu, the "More options" (⋮) menu of
 * a view, or another one (toolbars, the gear…), and whether it belongs to a canvas. The modules
 * that change menus use it: Customize the bars (which items they show) and the right-click menu
 * style. Each kind applies inside canvases, or everywhere when its "Apply to the whole vault"
 * switch is on (set by Customize the bars).
 *
 * Menus get classes on their element: `opc-menu-in-canvas`, `opc-menu-context` / `opc-menu-more`.
 */
import { Menu, type App, type EventRef, type Plugin } from "obsidian";
import type { Patcher } from "./patcher";
import { logError } from "./log";

export type MenuKind = "context" | "more";

export interface MenuShow {
	menu: Menu;
	kind: MenuKind | null;
	inCanvas: boolean;
	/** The kind's changes apply to it: in a canvas, or anywhere when that kind is set to the whole vault. */
	applies: boolean;
}

/** A press this long ago or less still explains the menu that opens now. */
const RECENT_MS = 800;
const CANVAS = '.workspace-leaf-content[data-type="canvas"], .canvas-wrapper';
const MORE_ICON = "svg.lucide-more-vertical, svg.lucide-more-horizontal, svg.lucide-ellipsis-vertical, svg.lucide-ellipsis";

export class MenuKinds {
	/** "Apply to the whole vault", per kind. */
	readonly scope: Record<MenuKind, boolean> = { context: false, more: false };
	private readonly showListeners = new Set<(m: MenuShow) => void>();
	private readonly scopeListeners = new Set<() => void>();
	private readonly canvasMenus = new WeakSet<Menu>();
	private readonly moreMenus = new WeakMap<Menu, boolean>();
	private lastContext: { at: number; target: Element | null } | null = null;
	private lastMore: { at: number; inCanvas: boolean } | null = null;

	/** Called before a menu shows (its items can still be changed). */
	onShow(cb: (m: MenuShow) => void): () => void {
		this.showListeners.add(cb);
		return () => void this.showListeners.delete(cb);
	}

	onScopeChange(cb: () => void): () => void {
		this.scopeListeners.add(cb);
		return () => void this.scopeListeners.delete(cb);
	}

	setScope(kind: MenuKind, allVault: boolean): void {
		if (this.scope[kind] === allVault) return;
		this.scope[kind] = allVault;
		for (const cb of [...this.scopeListeners]) cb();
	}

	install(app: App, plugin: Plugin, patcher: Patcher): void {
		const onContext = (evt: MouseEvent) => (this.lastContext = { at: performance.now(), target: evt.target as Element | null });
		const onPress = (evt: Event) => {
			const button = (evt.target as HTMLElement | null)?.closest?.(".clickable-icon, .view-action");
			if (!button?.querySelector(MORE_ICON) || !button.closest(".view-header, .view-actions")) return;
			this.lastMore = { at: performance.now(), inCanvas: !!button.closest(CANVAS) };
		};
		const listen = (win: Window) => {
			win.addEventListener("contextmenu", onContext, true);
			win.addEventListener("pointerdown", onPress, true);
			win.addEventListener("click", onPress, true);
			return () => {
				win.removeEventListener("contextmenu", onContext, true);
				win.removeEventListener("pointerdown", onPress, true);
				win.removeEventListener("click", onPress, true);
			};
		};
		plugin.register(listen(window));
		plugin.registerEvent(app.workspace.on("window-open", (w) => plugin.register(listen(w.win))));
		const ws = app.workspace as unknown as { on(name: string, cb: (...args: unknown[]) => void): EventRef };
		for (const name of ["canvas:node-menu", "canvas:edge-menu", "canvas:selection-menu"]) plugin.registerEvent(ws.on(name, (menu) => this.canvasMenus.add(menu as Menu)));
		// The ⋮ menu of a file view (a canvas is one) says so itself.
		plugin.registerEvent(
			ws.on("file-menu", (menu, _file, source, leaf) => {
				if (source !== "more-options") return;
				const view = (leaf as { view?: { getViewType?(): string } } | undefined)?.view;
				this.moreMenus.set(menu as Menu, view?.getViewType?.() === "canvas");
			}),
		);

		const announce = (menu: Menu, pos: { x: number; y: number }, doc?: Document) => this.announce(menu, pos, doc);
		plugin.register(
			patcher.apply("core", "Menu.showAtPosition (menu kinds)", Menu.prototype, {
				showAtPosition: (next) =>
					function (this: Menu, pos: { x: number; y: number }, doc?: Document) {
						try {
							announce(this, pos, doc);
						} catch (error) {
							logError("[overpowered-canvas] menu kind failed", error);
						}
						return next.call(this, pos, doc);
					},
			}),
		);
	}

	private announce(menu: Menu, pos: { x: number; y: number }, doc?: Document): void {
		const now = performance.now();
		const recentMore = this.lastMore && now - this.lastMore.at < RECENT_MS ? this.lastMore : null;
		const recentContext = this.lastContext && now - this.lastContext.at < RECENT_MS ? this.lastContext : null;
		let kind: MenuKind | null = null;
		let inCanvas = false;
		if (this.moreMenus.has(menu) || recentMore) {
			kind = "more";
			inCanvas = this.moreMenus.get(menu) ?? recentMore?.inCanvas ?? false;
			this.lastMore = null;
		} else if (this.canvasMenus.has(menu)) {
			kind = "context";
			inCanvas = true;
		} else if (recentContext) {
			kind = "context";
			inCanvas = !!recentContext.target?.closest?.(CANVAS);
		} else {
			const parent = (menu as Menu & { parentEl?: HTMLElement | null }).parentEl;
			const at = (doc ?? activeDocument).elementFromPoint(pos.x, pos.y);
			inCanvas = !!parent?.closest?.(CANVAS) || !!at?.closest?.(CANVAS);
		}
		if (kind === "context") this.lastContext = null;
		const dom = (menu as Menu & { dom?: HTMLElement }).dom;
		dom?.toggleClass("opc-menu-in-canvas", inCanvas);
		dom?.toggleClass("opc-menu-context", kind === "context");
		dom?.toggleClass("opc-menu-more", kind === "more");
		const show: MenuShow = { menu, kind, inCanvas, applies: !!kind && (inCanvas || this.scope[kind]) };
		for (const cb of [...this.showListeners]) cb(show);
	}
}
