import { Setting, type Menu } from "obsidian";
import { isNode } from "../../core/canvas-ui";
import { logError } from "../../core/log";
import { defineModule, type ModuleContext } from "../../core/module";
import { SCHEMA_KEY } from "../../data/schema";
import type { CanvasItemLike, CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { BackgroundDoubleClick, DOUBLE_CLICK_PRESETS } from "../better-defaults/double-click";
import { isHiddenNode, mutate, nodeType, randomId, renderedZ, selectedNodes } from "../shared";
import { fixSelection, leavesGroup, regroupCopies } from "./logic";

export interface SmartGroupSettings {
	/** Ctrl/Cmd+G groups and Ctrl/Cmd+Shift+G ungroups while a canvas has the focus. */
	/** Group / ungroup button in the selection toolbar. */
	toolbar: boolean;
}

type Ctx = ModuleContext<SmartGroupSettings>;

/** A pointer that went down this recently (ms) still counts for the selection it caused. */
const POINTER_GRACE = 450;
/** A press on the board this recently (ms) is where its long-press menu was opened. */
const MENU_GRACE = 3000;
/** Pointer presses on these never pick cards (toolbars, bars, handles). */
const NOT_ON_BOARD = ".canvas-menu-container, .canvas-card-menu, .canvas-controls, .opc-tutorial, .modal-container, .menu";

/** The smart group of a node, read straight from its data (off-screen nodes have no decorations). */
export function smartGroupOf(item: CanvasItemLike): string | undefined {
	if (!isNode(item)) return undefined;
	const g = (item.unknownData[SCHEMA_KEY] as { smartGroup?: unknown } | undefined)?.smartGroup;
	return typeof g === "string" && g ? g : undefined;
}

/** Members of a group that are on the board right now (not on another page or a hidden layer). */
function membersOf(canvas: CanvasLike, group: string): CanvasNodeLike[] {
	return [...canvas.nodes.values()].filter((n) => smartGroupOf(n) === group && !isHiddenNode(n));
}

interface PointerState {
	down: boolean;
	at: number;
	/** Shift (or Ctrl/Cmd) was held: a click toggles one item in or out of the selection. */
	toggle: boolean;
}

/**
 * Smart groups (Miro-style): cards grouped with Ctrl/Cmd+G get no frame, border or label; they
 * are picked and dragged as one. Double-click (double-tap) a card of a selected group to pick
 * just that card; double-click it again to edit it. Stored as x-opc `smartGroup` on each card.
 */
export const smartGroupsModule = defineModule<SmartGroupSettings>({
	id: "smart-groups",
	name: "smartGroups.name",
	description: "smartGroups.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: { toolbar: true },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			toolbar: typeof s.toolbar === "boolean" ? s.toolbar : defaults.toolbar,
		};
	},

	enable(ctx: Ctx) {
		/** Per canvas: the group whose cards are picked one at a time ("entered", as in Miro). */
		const entered = new Map<CanvasLike, string>();
		const pointers = new WeakMap<CanvasLike, PointerState>();
		/** Double-taps of a finger or pen (touch screens send no double-click for them). */
		const taps = new WeakMap<CanvasLike, BackgroundDoubleClick>();
		/** Where the last press on the board was (board coordinates), for its long-press menu. */
		const presses = new WeakMap<CanvasLike, { x: number; y: number; at: number }>();

		/** The card on top at a board point (not a group's box, nor one hidden). */
		const nodeAt = (canvas: CanvasLike, p: { x: number; y: number }): CanvasNodeLike | null => {
			let best: CanvasNodeLike | null = null;
			for (const n of canvas.nodes.values()) {
				if (nodeType(n) === "group" || isHiddenNode(n) || n.id.includes("~")) continue;
				if (p.x < n.x || p.y < n.y || p.x > n.x + n.width || p.y > n.y + n.height) continue;
				if (!best || renderedZ(n) > renderedZ(best)) best = n;
			}
			return best;
		};

		const pointerRecent = (canvas: CanvasLike) => {
			const p = pointers.get(canvas);
			return !!p && (p.down || Date.now() - p.at < POINTER_GRACE);
		};

		// ---- Selecting: a card picked with the pointer brings its whole group --------------------

		const adjust = (canvas: CanvasLike, before: ReadonlySet<CanvasItemLike>) => {
			const sel = canvas.selection;
			const inside = entered.get(canvas);
			if (inside && leavesGroup(sel, smartGroupOf, inside)) entered.delete(canvas);
			// Programmatic selections (commands, mind map keys, search) stay exactly as asked.
			if (sel.size === 0 || !pointerRecent(canvas)) return;
			const p = pointers.get(canvas);
			const fix = fixSelection({ before, after: sel, groupOf: smartGroupOf, entered: entered.get(canvas) ?? null, toggledOff: !!p && !p.down && p.toggle });
			if (fix.add.size === 0 && fix.remove.size === 0) return;
			for (const n of canvas.nodes.values()) {
				const g = smartGroupOf(n);
				if (!g) continue;
				if (fix.add.has(g) && !isHiddenNode(n)) sel.add(n);
				else if (fix.remove.has(g)) sel.delete(n);
			}
		};

		const patched = new WeakSet<object>();
		ctx.onCanvas((canvas) => {
			const proto = Object.getPrototypeOf(canvas) as CanvasLike;
			if (!patched.has(proto)) {
				patched.add(proto);
				ctx.patch("canvas.updateSelection (smart groups)", proto, {
					// The fix runs inside the core's own update, so everything after it (toolbar,
					// selection-change listeners) sees the whole group.
					updateSelection: (next) =>
						function (this: CanvasLike, fn: () => void) {
							const before = new Set(this.selection);
							next.call(this, () => {
								fn();
								try {
									adjust(this, before);
								} catch (error) {
									logError("[overpowered-canvas] smart groups: selection fix failed", error);
								}
							});
						},
				});
				ctx.patch("canvas.cloneData (smart groups)", proto, {
					// Copies form their own groups instead of joining the original one.
					cloneData: (next) =>
						function (this: CanvasLike, data: Parameters<CanvasLike["cloneData"]>[0], offset: Parameters<CanvasLike["cloneData"]>[1]) {
							const out = next.call(this, data, offset);
							if (!out?.nodes?.length) return out;
							return { ...out, nodes: regroupCopies(out.nodes, SCHEMA_KEY, () => randomId(8)) };
						},
				});
			}

			const wrapper = canvas.wrapperEl;
			const win = wrapper.win;
			const tap = taps.get(canvas) ?? taps.set(canvas, new BackgroundDoubleClick(() => DOUBLE_CLICK_PRESETS.regular)).get(canvas)!;
			const onDown = (e: PointerEvent) => {
				const elsewhere = !!(e.target as HTMLElement | null)?.closest?.(NOT_ON_BOARD);
				// A finger or pen: its double-tap picks one card of a group, as a double-click does.
				if (e.pointerType !== "mouse") tap.pointerDown({ id: e.pointerId, x: e.clientX, y: e.clientY, time: Date.now(), onBackground: !elsewhere, primary: e.isPrimary, leftButton: true, mouse: false });
				if (!e.isPrimary || elsewhere) return;
				pointers.set(canvas, { down: true, at: Date.now(), toggle: e.shiftKey || e.ctrlKey || e.metaKey });
				const at = canvas.posFromEvt(e);
				presses.set(canvas, { x: at.x, y: at.y, at: Date.now() });
			};
			const onMove = (e: PointerEvent) => {
				if (e.pointerType !== "mouse") tap.pointerMove(e.pointerId, e.clientX, e.clientY);
			};
			const onUp = (e: PointerEvent) => {
				if (e.pointerType !== "mouse" && e.type === "pointerup" && tap.pointerUp(e.pointerId, e.clientX, e.clientY, Date.now()) && !canvas.readonly) {
					const node = nodeAt(canvas, canvas.posFromEvt(e));
					// After the core has handled the tap itself.
					if (node && closedGroup(node))
						win.setTimeout(() => {
							if (closedGroup(node) && !node.isEditing) enter(node);
						}, 0);
				} else if (e.type === "pointercancel") tap.cancel();
				const p = pointers.get(canvas);
				if (!p?.down || !e.isPrimary) return;
				pointers.set(canvas, { ...p, down: false, at: Date.now() });
			};
			wrapper.addEventListener("pointerdown", onDown, true);
			win.addEventListener("pointermove", onMove, true);
			win.addEventListener("pointerup", onUp, true);
			win.addEventListener("pointercancel", onUp, true);
			return () => {
				wrapper.removeEventListener("pointerdown", onDown, true);
				win.removeEventListener("pointermove", onMove, true);
				win.removeEventListener("pointerup", onUp, true);
				win.removeEventListener("pointercancel", onUp, true);
				entered.delete(canvas);
			};
		});
		ctx.register(() => entered.clear());

		// ---- Entering a group: double-click (double-tap) picks one card ---------------------------

		const enter = (node: CanvasNodeLike) => {
			const g = smartGroupOf(node);
			if (!g) return;
			entered.set(node.canvas, g);
			node.canvas.selectOnly(node);
			node.canvas.menu.render?.(true);
		};
		/** The card belongs to a group of several cards that the user hasn't entered. */
		const closedGroup = (node: CanvasNodeLike) => {
			const g = smartGroupOf(node);
			return !!g && entered.get(node.canvas) !== g && membersOf(node.canvas, g).length > 1;
		};
		// The core edits a text card on double-click: the first one enters the group instead.
		ctx.intercept("node-start-editing", (node) => {
			if (!closedGroup(node) || !pointerRecent(node.canvas)) return undefined;
			enter(node);
			return true;
		});
		// Cards the core doesn't edit on double-click (images, links, …).
		ctx.on("node-interaction", (node, type) => {
			if (type !== "dblclick" || !closedGroup(node)) return;
			window.setTimeout(() => {
				if (closedGroup(node) && !node.isEditing) enter(node);
			}, 0);
		});

		// ---- Group / ungroup -------------------------------------------------------------------

		const groupable = (canvas: CanvasLike) => selectedNodes(canvas).filter((n) => !isHiddenNode(n));
		/** Groups with a selected card. */
		const selectedGroups = (canvas: CanvasLike) => new Set(selectedNodes(canvas).map(smartGroupOf).filter((g): g is string => !!g));
		/** The selection is exactly one whole group (nothing to group any more). */
		const isOneGroup = (canvas: CanvasLike) => {
			const nodes = groupable(canvas);
			const groups = selectedGroups(canvas);
			if (groups.size !== 1 || nodes.some((n) => !smartGroupOf(n))) return false;
			const [g] = [...groups];
			return membersOf(canvas, g!).every((m) => canvas.selection.has(m));
		};
		const canGroup = (canvas: CanvasLike) => !canvas.readonly && groupable(canvas).length > 1 && !isOneGroup(canvas);
		const canUngroup = (canvas: CanvasLike) => !canvas.readonly && selectedGroups(canvas).size > 0;

		const group = (canvas: CanvasLike): boolean => {
			if (!canGroup(canvas)) return false;
			const nodes = groupable(canvas);
			const id = randomId(8);
			const ok = mutate(ctx, canvas, () => {
				for (const n of nodes) ctx.data.node(n).set({ smartGroup: id });
			});
			if (!ok) return false;
			entered.delete(canvas);
			canvas.menu.render?.(true);
			ctx.events.emit("smart-group-changed", canvas, "group", nodes.length);
			return true;
		};
		const ungroup = (canvas: CanvasLike): boolean => {
			if (!canUngroup(canvas)) return false;
			const groups = selectedGroups(canvas);
			const nodes = [...canvas.nodes.values()].filter((n) => groups.has(smartGroupOf(n) ?? ""));
			const ok = mutate(ctx, canvas, () => {
				for (const n of nodes) ctx.data.node(n).set({ smartGroup: undefined });
			});
			if (!ok) return false;
			entered.delete(canvas);
			canvas.menu.render?.(true);
			ctx.events.emit("smart-group-changed", canvas, "ungroup", nodes.length);
			return true;
		};

		ctx.addCommand({
			id: "group",
			name: ctx.t("smartGroups.group"),
			icon: "group",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || !canGroup(canvas)) return false;
				if (!checking) group(canvas);
				return true;
			},
		});
		ctx.addCommand({
			id: "ungroup",
			name: ctx.t("smartGroups.ungroup"),
			icon: "ungroup",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || !canUngroup(canvas)) return false;
				if (!checking) ungroup(canvas);
				return true;
			},
		});
		ctx.addCommand({
			id: "select-group",
			name: ctx.t("smartGroups.selectGroup"),
			icon: "group",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const groups = canvas ? selectedGroups(canvas) : new Set<string>();
				if (!canvas || groups.size === 0) return false;
				if (!checking) {
					entered.delete(canvas);
					canvas.selectAll(new Set([...canvas.nodes.values()].filter((n) => groups.has(smartGroupOf(n) ?? "") && !isHiddenNode(n))));
				}
				return true;
			},
		});

		// While a canvas has the focus Ctrl/Cmd+G groups (Obsidian opens the graph view with it
		// elsewhere; keys are set in the Shortcuts window). With nothing to group the key is not
		// handled, so it goes on to its usual command (the graph view).
		ctx.addCanvasKey({ shortcut: "groups.group", handle: (canvas) => group(canvas) });
		ctx.addCanvasKey({ shortcut: "groups.ungroup", handle: (canvas) => ungroup(canvas) });

		ctx.addMenuButton({
			id: "smart-group",
			command: false,
			icon: (selection) => (selection.length > 0 && isOneGroupOf(selection) ? "ungroup" : "group"),
			tooltip: () => ctx.t("smartGroups.toggle"),
			order: 88,
			isVisible: (selection, canvas) => ctx.settings.toolbar && (canGroup(canvas) || canUngroup(canvas)),
			isActive: (selection) => isOneGroupOf(selection),
			onClick: ({ canvas }) => (isOneGroup(canvas) ? ungroup(canvas) : canGroup(canvas) ? group(canvas) : ungroup(canvas)),
		});
		/** Every selected node shares one group (toolbar icon only; no canvas at hand). */
		const isOneGroupOf = (selection: CanvasItemLike[]) => {
			const nodes = selection.filter(isNode);
			if (nodes.length === 0) return false;
			const g = smartGroupOf(nodes[0]!);
			return !!g && nodes.every((n) => smartGroupOf(n) === g);
		};

		const addItems = (menu: Menu, canvas: CanvasLike, node?: CanvasNodeLike) => {
			if (canvas.readonly) return;
			if (canGroup(canvas))
				menu.addItem((item) => item.setTitle(ctx.t("smartGroups.group")).setIcon("group").onClick(() => group(canvas)));
			if (canUngroup(canvas))
				menu.addItem((item) => item.setTitle(ctx.t("smartGroups.ungroup")).setIcon("ungroup").onClick(() => ungroup(canvas)));
			// Touch screens: the way into a group without a double-tap.
			if (node && closedGroup(node))
				menu.addItem((item) => item.setTitle(ctx.t("smartGroups.selectOne")).setIcon("mouse-pointer-click").onClick(() => enter(node)));
		};
		ctx.onNodeMenu((menu, node) => addItems(menu, node.canvas, node));
		// A long press (or right-click) on a card of a selected group opens the selection's menu:
		// it offers to pick just the card that was pressed.
		ctx.onSelectionMenu((menu, canvas) => {
			const press = presses.get(canvas);
			const node = press && Date.now() - press.at < MENU_GRACE ? nodeAt(canvas, press) : null;
			addItems(menu, canvas, node && canvas.selection.has(node) ? node : undefined);
		});
	},

	renderSettings(el, ctx: Ctx) {
		new Setting(el)
			.setName(ctx.t("smartGroups.keys.name"))
			.setDesc(ctx.t("smartGroups.keys.desc"))
			.addButton((b) => b.setButtonText(ctx.t("shortcuts.open")).onClick(() => ctx.openShortcuts(ctx.t("shortcuts.action.groups.group"))));
		new Setting(el)
			.setName(ctx.t("smartGroups.toolbar.name"))
			.setDesc(ctx.t("smartGroups.toolbar.desc"))
			.addToggle((t) => t.setValue(ctx.settings.toolbar).onChange((v) => ctx.updateSettings({ toolbar: v })));
	},
});
