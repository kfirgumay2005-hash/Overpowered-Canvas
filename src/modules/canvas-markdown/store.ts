/**
 * Separate data files of clean notes: one JSON file per note in a vault folder, named after the
 * note (plus a hash of its path, so notes with the same name in different folders don't clash).
 * Uses the vault adapter only, so it works on mobile; renamed and deleted notes and canvases are
 * followed while the plugin runs.
 */
import { normalizePath, type App } from "obsidian";
import { formatData, readData, type NoteData } from "./note";

/** FNV-1a, 32 bit, as 8 hex digits. */
function hash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(16).padStart(8, "0");
}

export class DataStore {
	constructor(
		private readonly app: App,
		private readonly folder: () => string,
	) {}

	private get root(): string {
		return normalizePath(this.folder() || "Overpowered Canvas data");
	}

	pathFor(notePath: string): string {
		const name = notePath.slice(notePath.lastIndexOf("/") + 1).replace(/\.md$/i, "").replace(/[\\/:*?"<>|#^[\]]/g, "_");
		return normalizePath(`${this.root}/${name} ${hash(notePath)}.json`);
	}

	/** The data of a note, if it has a data file that belongs to it. */
	async load(notePath: string): Promise<NoteData | null> {
		const path = this.pathFor(notePath);
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(path))) return null;
		try {
			const data = readData(JSON.parse(await adapter.read(path)));
			return data && (data.note === undefined || data.note === notePath) ? data : null;
		} catch {
			return null;
		}
	}

	async save(notePath: string, data: NoteData): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.root))) await this.app.vault.createFolder(this.root).catch(() => adapter.mkdir(this.root));
		const text = `${formatData({ ...data, note: notePath })}\n`;
		const path = this.pathFor(notePath);
		if ((await adapter.exists(path)) && (await adapter.read(path)) === text) return;
		await adapter.write(path, text);
	}

	async remove(notePath: string): Promise<void> {
		const path = this.pathFor(notePath);
		if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
		await this.removeFolderIfEmpty();
	}

	/** Every data file's content (unreadable files are skipped). */
	async all(): Promise<NoteData[]> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.root))) return [];
		const out: NoteData[] = [];
		for (const file of (await adapter.list(this.root)).files) {
			if (!file.endsWith(".json")) continue;
			try {
				const data = readData(JSON.parse(await adapter.read(file)));
				if (data?.note) out.push(data);
			} catch {
				// Not ours: leave it.
			}
		}
		return out;
	}

	/** The note whose data file says it mirrors `canvasPath`. */
	async noteFor(canvasPath: string): Promise<string | null> {
		const exists = (p: string) => this.app.vault.getAbstractFileByPath(p) !== null;
		return (await this.all()).find((d) => d.canvas === canvasPath && exists(d.note!))?.note ?? null;
	}

	/** A note was renamed: its data file follows. */
	async noteRenamed(oldPath: string, newPath: string): Promise<void> {
		const data = await this.load(oldPath);
		if (!data) return;
		await this.save(newPath, data);
		const old = this.pathFor(oldPath);
		if (old !== this.pathFor(newPath)) await this.app.vault.adapter.remove(old);
	}

	/** A canvas was renamed: data files pointing at it follow. */
	async canvasRenamed(oldPath: string, newPath: string): Promise<void> {
		for (const data of await this.all()) if (data.canvas === oldPath) await this.save(data.note!, { ...data, canvas: newPath });
	}

	private async removeFolderIfEmpty(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.root))) return;
		const list = await adapter.list(this.root);
		if (!list.files.length && !list.folders.length) await adapter.rmdir(this.root, false);
	}
}
