/**
 * Every keyboard shortcut of the plugin's canvases, in one list: what the Shortcuts window shows and
 * edits, and what the modules bind (by id). Pure data (unit-tested).
 *
 * Obsidian's own hotkeys for the plugin's commands are not here: they stay in Obsidian (Settings →
 * Hotkeys) and the Shortcuts window reads and writes them there (see shortcuts-modal.ts).
 */
import type { Combo } from "./keys";

export type ShortcutCategory = "tools" | "drawing" | "mindmap" | "stickies" | "presentation" | "walk" | "pages" | "editing" | "canvas";

export const CATEGORY_ORDER: readonly ShortcutCategory[] = ["tools", "drawing", "mindmap", "stickies", "presentation", "walk", "pages", "editing", "canvas"];

/**
 * When a shortcut works. The board contexts (board, card, sticky) are all "a canvas with the focus";
 * the others are modes that take the keys while they run (drawing, a presentation…).
 */
export type ShortcutContext = "board" | "card" | "sticky" | "drawing" | "highlighter" | "lasso" | "slides" | "walk" | "columns" | "placing" | "dragging" | "editor";

const BOARD: ReadonlySet<ShortcutContext> = new Set(["board", "card", "sticky"]);
const WALK: ReadonlySet<ShortcutContext> = new Set(["walk", "columns"]);

export interface ShortcutDef {
	readonly id: string;
	readonly category: ShortcutCategory;
	readonly context: ShortcutContext;
	/** Default combinations (several keys may do the same). */
	readonly defaults: readonly Combo[];
	/** Module that provides it (the window marks it while that module is off). */
	readonly module?: string;
	/** Ids that take the same key on purpose: they act on different cards (stickies vs. mind maps). */
	readonly shares?: readonly string[];
	/** Built into Obsidian's canvas: listed for reference and for conflicts, not editable. */
	readonly fixed?: boolean;
	/** For fixed mouse gestures: a description key instead of combos ("Space + drag"). */
	readonly gesture?: string;
}

const DIRS = ["up", "down", "left", "right"] as const;
export type Dir = (typeof DIRS)[number];
export const ARROW_OF: Record<Dir, string> = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

/** The modifiers that pick the shape of a new child card (the arrow picks the direction). */
type ChildShape = "process" | "terminal" | "decision" | "input-output";
const SHAPE_MODIFIERS: Record<ChildShape, string> = { process: "Alt+Shift+", terminal: "Mod+Alt+", decision: "Mod+Alt+Shift+", "input-output": "Shift+" };

const def = (id: string, category: ShortcutCategory, context: ShortcutContext, defaults: Combo[], module?: string, extra: Partial<ShortcutDef> = {}): ShortcutDef => ({ id, category, context, defaults, module, ...extra });

export const SHORTCUTS: readonly ShortcutDef[] = [
	// Tools: on the board.
	def("search.open", "tools", "board", ["Mod+F"], "canvas-search"),
	def("drawing.toggle", "tools", "board", ["P"], "drawing"),
	def("highlight.toggle", "tools", "board", ["H"], "text-highlight"),
	def("lasso.toggle", "tools", "board", ["L"], "lasso"),
	def("minimap.toggle", "tools", "board", ["M"], "minimap"),
	def("groups.group", "tools", "board", ["Mod+G"], "smart-groups"),
	def("groups.ungroup", "tools", "board", ["Mod+Shift+G"], "smart-groups"),

	// While a tool runs.
	def("drawing.done", "drawing", "drawing", ["Escape"], "drawing"),
	def("drawing.delete", "drawing", "drawing", ["Delete", "Backspace"], "drawing"),
	def("highlight.done", "drawing", "highlighter", ["Escape"], "text-highlight"),
	def("lasso.done", "drawing", "lasso", ["Escape"], "lasso"),

	// Mind maps: one card selected.
	def("mindmap.child", "mindmap", "card", ["Tab"], "mindmap", { shares: ["sticky.next"] }),
	def("mindmap.sibling", "mindmap", "card", ["Enter"], "mindmap"),
	...DIRS.map((d) => def(`mindmap.go.${d}`, "mindmap", "card", [`Alt+${ARROW_OF[d]}`], "mindmap")),
	...DIRS.map((d) => def(`mindmap.floating.${d}`, "mindmap", "card", [`Mod+${ARROW_OF[d]}`], "mindmap", { shares: [`sticky.${d}`] })),
	...DIRS.map((d) => def(`mindmap.childAt.${d}`, "mindmap", "card", [`Mod+Shift+${ARROW_OF[d]}`], "mindmap")),
	// A child in a flowchart shape, in that direction.
	...(Object.entries(SHAPE_MODIFIERS) as [ChildShape, string][]).flatMap(([shape, mods]) => DIRS.map((d) => def(`mindmap.shape.${shape}.${d}`, "mindmap", "card", [`${mods}${ARROW_OF[d]}`], "mindmap"))),

	// Sticky notes: one sticky selected (they come before the mind map keys on stickies).
	def("sticky.next", "stickies", "sticky", ["Tab"], "sticky-notes", { shares: ["mindmap.child"] }),
	...DIRS.map((d) => def(`sticky.${d}`, "stickies", "sticky", [`Mod+${ARROW_OF[d]}`], "sticky-notes", { shares: [`mindmap.floating.${d}`] })),

	// Presentations and frame shows.
	def("slides.next", "presentation", "slides", ["ArrowRight", "ArrowDown", "PageDown", "Space", "Enter"], "presentation"),
	def("slides.previous", "presentation", "slides", ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"], "presentation"),
	def("slides.first", "presentation", "slides", ["Home"], "presentation"),
	def("slides.last", "presentation", "slides", ["End"], "frames"),
	def("slides.end", "presentation", "slides", ["Escape"], "presentation"),

	// Walking through a map, and the column view.
	...DIRS.map((d) => def(`walk.${d}`, "walk", "walk", [ARROW_OF[d]], "presentation")),
	def("walk.start", "walk", "walk", ["Home"], "presentation"),
	def("walk.zoomIn", "walk", "walk", ["+", "="], "presentation"),
	def("walk.zoomOut", "walk", "walk", ["-"], "presentation"),
	def("walk.end", "walk", "walk", ["Escape"], "presentation"),
	def("columns.child", "walk", "columns", ["Tab"], "presentation"),
	def("columns.sibling", "walk", "columns", ["Enter"], "presentation"),
	def("columns.edit", "walk", "columns", ["F2"], "presentation"),

	// Pages.
	def("pages.cancelPlacing", "pages", "placing", ["Escape"], "pages"),

	// Editing.
	def("edit.save", "editing", "editor", ["Mod+Enter"]),
	def("edit.cancel", "editing", "editor", ["Escape"]),
	def("noteBlocks.cancel", "editing", "dragging", ["Escape"], "note-blocks"),

	// Obsidian's canvas itself (the old "Canvas help" list): reference only.
	def("core.pan", "canvas", "board", [], undefined, { fixed: true, gesture: "shortcuts.gesture.pan" }),
	def("core.zoom", "canvas", "board", [], undefined, { fixed: true, gesture: "shortcuts.gesture.zoom" }),
	def("core.zoomFit", "canvas", "board", ["Shift+1"], undefined, { fixed: true }),
	def("core.zoomSelection", "canvas", "board", ["Shift+2"], undefined, { fixed: true }),
	def("core.selectAll", "canvas", "board", ["Mod+A"], undefined, { fixed: true }),
	def("core.addToSelection", "canvas", "board", [], undefined, { fixed: true, gesture: "shortcuts.gesture.addToSelection" }),
	def("core.clone", "canvas", "board", [], undefined, { fixed: true, gesture: "shortcuts.gesture.clone" }),
	def("core.constrain", "canvas", "board", [], undefined, { fixed: true, gesture: "shortcuts.gesture.constrain" }),
	def("core.noSnap", "canvas", "board", [], undefined, { fixed: true, gesture: "shortcuts.gesture.noSnap" }),
	def("core.remove", "canvas", "board", ["Backspace", "Delete"], undefined, { fixed: true }),
	def("core.undo", "canvas", "board", ["Mod+Z"], undefined, { fixed: true }),
	def("core.redo", "canvas", "board", ["Mod+Y", "Mod+Shift+Z"], undefined, { fixed: true }),
];

export type ShortcutId = string;

const BY_ID = new Map(SHORTCUTS.map((s) => [s.id, s]));

export function shortcutDef(id: ShortcutId): ShortcutDef | undefined {
	return BY_ID.get(id);
}

/** Two shortcuts can be pressed in the same situation, so they must not share a key. */
export function contextsOverlap(a: ShortcutContext, b: ShortcutContext): boolean {
	return a === b || (BOARD.has(a) && BOARD.has(b)) || (WALK.has(a) && WALK.has(b));
}

/** True when a and b may not have the same key (they overlap and don't share it on purpose). */
export function clash(a: ShortcutDef, b: ShortcutDef): boolean {
	if (a.id === b.id || !contextsOverlap(a.context, b.context)) return false;
	return !(a.shares?.includes(b.id) || b.shares?.includes(a.id));
}

/** The shortcuts (other than `self`) that `combo` would collide with, given the current bindings. */
export function collisions(self: ShortcutDef, combo: Combo, bindings: (id: ShortcutId) => readonly Combo[]): ShortcutDef[] {
	return SHORTCUTS.filter((other) => clash(self, other) && bindings(other.id).includes(combo));
}
