/**
 * The current key of every canvas shortcut: the defaults of the catalog, with the user's changes
 * from data.json (`settings.shortcuts`: id → combos; an empty list switches a shortcut off).
 */
import { isPlainObject } from "../../data/validate";
import { SHORTCUTS, shortcutDef, type ShortcutId } from "./catalog";
import { comboFromEvent, normalizeCombo, type Combo, type KeyEventLike } from "./keys";

export type ShortcutOverrides = Record<string, Combo[]>;

/** Stored overrides, cleaned: known, editable ids only, valid combos, no duplicates. */
export function sanitizeOverrides(raw: unknown): ShortcutOverrides {
	const out: ShortcutOverrides = {};
	if (!isPlainObject(raw)) return out;
	for (const [id, list] of Object.entries(raw)) {
		const d = shortcutDef(id);
		if (!d || d.fixed || !Array.isArray(list)) continue;
		const combos = [...new Set(list.filter((c): c is string => typeof c === "string").map(normalizeCombo).filter((c): c is Combo => !!c))];
		out[id] = combos;
	}
	return out;
}

/**
 * Overrides from the settings that used to choose keys, for data.json files from before the
 * Shortcuts window: the mind map's "Key for a sibling card" and smart groups' "Ctrl/Cmd+G in
 * canvases". Nobody loses a key they chose.
 */
export function migrateLegacyShortcuts(modules: Record<string, { settings?: Record<string, unknown> } | undefined>): ShortcutOverrides {
	const out: ShortcutOverrides = {};
	if (modules.mindmap?.settings?.siblingKey === "Shift+Enter") out["mindmap.sibling"] = ["Shift+Enter"];
	if (modules["smart-groups"]?.settings?.keys === false) {
		out["groups.group"] = [];
		out["groups.ungroup"] = [];
	}
	return out;
}

const sameList = (a: readonly Combo[], b: readonly Combo[]) => a.length === b.length && a.every((c, i) => c === b[i]);

export class ShortcutStore {
	private readonly listeners = new Set<() => void>();

	constructor(
		/** The settings object's map, changed in place (the settings tab and sync share it). */
		private readonly overrides: () => ShortcutOverrides,
		private readonly save: () => Promise<void>,
		readonly mac: boolean,
	) {}

	combos(id: ShortcutId): readonly Combo[] {
		return this.overrides()[id] ?? shortcutDef(id)?.defaults ?? [];
	}

	isDefault(id: ShortcutId): boolean {
		return !(id in this.overrides());
	}

	/** True when this key press is one of the shortcut's keys. */
	matches(id: ShortcutId, evt: KeyEventLike): boolean {
		const combo = comboFromEvent(evt, this.mac);
		return !!combo && this.combos(id).includes(combo);
	}

	/** The first of `ids` this key press belongs to. */
	match<T extends ShortcutId>(evt: KeyEventLike, ids: readonly T[]): T | null {
		const combo = comboFromEvent(evt, this.mac);
		if (!combo) return null;
		return ids.find((id) => this.combos(id).includes(combo)) ?? null;
	}

	async set(id: ShortcutId, combos: readonly Combo[]): Promise<void> {
		const d = shortcutDef(id);
		if (!d || d.fixed) return;
		const list = [...new Set(combos)];
		const map = this.overrides();
		if (sameList(list, d.defaults)) delete map[id];
		else map[id] = list;
		await this.changed();
	}

	async reset(id: ShortcutId): Promise<void> {
		delete this.overrides()[id];
		await this.changed();
	}

	async resetAll(): Promise<void> {
		const map = this.overrides();
		for (const key of Object.keys(map)) delete map[key];
		await this.changed();
	}

	/** Several changes as one save (replacing a key taken by another shortcut). */
	async batch(changes: { id: ShortcutId; combos: readonly Combo[] }[]): Promise<void> {
		const map = this.overrides();
		for (const { id, combos } of changes) {
			const d = shortcutDef(id);
			if (!d || d.fixed) continue;
			const list = [...new Set(combos)];
			if (sameList(list, d.defaults)) delete map[id];
			else map[id] = list;
		}
		await this.changed();
	}

	/** Tells listeners (key bindings, open windows) to re-read; also after a settings sync. */
	notify(): void {
		for (const cb of [...this.listeners]) cb();
	}

	onChange(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => this.listeners.delete(cb);
	}

	/** A copy of the user's changes, to put back later (tutorials that change keys). */
	snapshot(): ShortcutOverrides {
		return Object.fromEntries(Object.entries(this.overrides()).map(([id, list]) => [id, [...list]]));
	}

	async restore(snapshot: ShortcutOverrides): Promise<void> {
		const map = this.overrides();
		const same = JSON.stringify(Object.entries(map).sort()) === JSON.stringify(Object.entries(snapshot).sort());
		if (same) return;
		for (const key of Object.keys(map)) delete map[key];
		Object.assign(map, this.snapshotOf(snapshot));
		await this.changed();
	}

	private snapshotOf(s: ShortcutOverrides): ShortcutOverrides {
		return Object.fromEntries(Object.entries(s).map(([id, list]) => [id, [...list]]));
	}

	/** Ids whose keys differ from the defaults. */
	changedIds(): ShortcutId[] {
		return SHORTCUTS.filter((s) => !s.fixed && !this.isDefault(s.id)).map((s) => s.id);
	}

	private async changed(): Promise<void> {
		this.notify();
		await this.save();
	}
}
