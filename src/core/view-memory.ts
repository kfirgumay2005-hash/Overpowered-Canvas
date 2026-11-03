/**
 * Where each canvas and note was last looked at: the page, the view of a canvas, the scroll of a
 * note. Kept per vault and device (Obsidian's local storage), so it survives closing a file and
 * restarting Obsidian. The view-memory module turns it on; while it is off, `page()` gives the
 * main page, as files open without it.
 */
import type { App } from "obsidian";

export interface CanvasSpot {
	/** "" for the main page. */
	page: string;
	x: number;
	y: number;
	zoom: number;
}

export interface NoteSpot {
	/** The page of a note with pages ("" = main, absent = the whole note). */
	page?: string;
	/** Reading position, as Obsidian's own view state gives it. */
	scroll?: number;
}

interface Stored {
	canvases: Record<string, CanvasSpot & { at: number }>;
	notes: Record<string, NoteSpot & { at: number }>;
}

const KEY = "overpowered-canvas:view-memory";
/** Files remembered at most (the ones looked at longest ago go first). */
const LIMIT = 400;
const SAVE_DELAY = 800;

function trim<T extends { at: number }>(map: Record<string, T>): Record<string, T> {
	const entries = Object.entries(map);
	if (entries.length <= LIMIT) return map;
	return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, LIMIT));
}

export class ViewMemory {
	private app: App | null = null;
	private stored: Stored = { canvases: {}, notes: {} };
	private timer = 0;
	/** Canvases and notes (each can be turned off in the module's settings). */
	canvases = false;
	notes = false;

	attach(app: App): void {
		if (this.app === app) return;
		this.app = app;
		try {
			const raw = app.loadLocalStorage(KEY) as Partial<Stored> | null;
			this.stored = { canvases: raw?.canvases ?? {}, notes: raw?.notes ?? {} };
		} catch {
			this.stored = { canvases: {}, notes: {} };
		}
	}

	private save(): void {
		if (!this.app || this.timer) return;
		this.timer = window.setTimeout(() => this.flush(), SAVE_DELAY);
	}

	flush(): void {
		if (this.timer) window.clearTimeout(this.timer);
		this.timer = 0;
		if (!this.app) return;
		this.stored = { canvases: trim(this.stored.canvases), notes: trim(this.stored.notes) };
		this.app.saveLocalStorage(KEY, this.stored);
	}

	canvas(path: string): CanvasSpot | null {
		return this.canvases ? (this.stored.canvases[path] ?? null) : null;
	}

	setCanvas(path: string, spot: CanvasSpot): void {
		if (!this.canvases) return;
		const prev = this.stored.canvases[path];
		if (prev && prev.page === spot.page && prev.x === spot.x && prev.y === spot.y && prev.zoom === spot.zoom) return;
		this.stored.canvases[path] = { ...spot, at: Date.now() };
		this.save();
	}

	note(path: string): NoteSpot | null {
		return this.notes ? (this.stored.notes[path] ?? null) : null;
	}

	setNote(path: string, spot: NoteSpot): void {
		if (!this.notes) return;
		const prev = this.stored.notes[path];
		const next = { ...prev, ...spot };
		if (prev && prev.page === next.page && prev.scroll === next.scroll) return;
		this.stored.notes[path] = { ...next, at: Date.now() };
		this.save();
	}

	/** The page a note with pages opens on: where it was left, else the main page. */
	page(path: string): string {
		return this.note(path)?.page ?? "";
	}

	setPage(path: string, page: string): void {
		this.setNote(path, { page });
	}

	renamed(oldPath: string, newPath: string): void {
		for (const map of [this.stored.canvases, this.stored.notes] as Record<string, { at: number }>[]) {
			if (!map[oldPath]) continue;
			map[newPath] = map[oldPath]!;
			delete map[oldPath];
			this.save();
		}
	}

	deleted(path: string): void {
		if (!this.stored.canvases[path] && !this.stored.notes[path]) return;
		delete this.stored.canvases[path];
		delete this.stored.notes[path];
		this.save();
	}
}

/** The one memory of the plugin (the canvas and note modules read it). */
export const viewMemory = new ViewMemory();
