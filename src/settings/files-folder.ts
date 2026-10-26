/**
 * Moving the plugin's files folder (note data, tutorial practice files) to another vault folder,
 * and a folder picker for the setting.
 */
import { AbstractInputSuggest, TFile, TFolder, normalizePath, type App } from "obsidian";

export interface MoveResult {
	moved: number;
	/** Files left where they were because the new folder already has a file with that name. */
	kept: number;
}

async function ensureFolder(app: App, path: string): Promise<void> {
	let current = "";
	for (const part of path.split("/")) {
		current = current ? `${current}/${part}` : part;
		const existing = app.vault.getAbstractFileByPath(current);
		if (existing instanceof TFolder) continue;
		if (existing) throw new Error(`"${current}" is a file`);
		await app.vault.createFolder(current);
	}
}

/** Every file under `folder`, and its folders, each after its sub-folders (the order to remove them in). */
function collect(folder: TFolder, skip: string, files: TFile[], folders: TFolder[]): void {
	for (const child of folder.children) {
		if (child.path === skip) continue;
		if (child instanceof TFile) files.push(child);
		else if (child instanceof TFolder) collect(child, skip, files, folders);
	}
	folders.push(folder);
}

/**
 * Moves everything in `from` to `to`, keeping sub-folders, through the vault so open tabs and
 * links follow. A file whose name is already taken in `to` stays where it is. Empty folders left
 * behind are removed. `to` may be inside `from` or the other way round.
 */
export async function moveFilesFolder(app: App, from: string, to: string): Promise<MoveResult> {
	from = normalizePath(from);
	to = normalizePath(to);
	const result: MoveResult = { moved: 0, kept: 0 };
	const source = app.vault.getAbstractFileByPath(from);
	if (from === to || !(source instanceof TFolder)) {
		await ensureFolder(app, to);
		return result;
	}
	const files: TFile[] = [];
	const folders: TFolder[] = [];
	// When the new folder is inside the old one, its own content is not moved into itself.
	collect(source, to, files, folders);
	await ensureFolder(app, to);
	for (const file of files) {
		const target = normalizePath(`${to}/${file.path.slice(from.length + 1)}`);
		if (app.vault.getAbstractFileByPath(target)) {
			result.kept++;
			continue;
		}
		const parent = target.slice(0, target.lastIndexOf("/"));
		if (parent) await ensureFolder(app, parent);
		await app.fileManager.renameFile(file, target);
		result.moved++;
	}
	for (const folder of folders) {
		const current = app.vault.getAbstractFileByPath(folder.path);
		if (current instanceof TFolder && current.children.length === 0 && !to.startsWith(`${folder.path}/`) && folder.path !== to) await app.fileManager.trashFile(current);
	}
	return result;
}

/** Suggests vault folders while typing a path. */
export class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private readonly input: HTMLInputElement,
		private readonly onPick: (path: string) => void,
	) {
		super(app, input);
	}

	protected getSuggestions(query: string): TFolder[] {
		const q = query.toLowerCase();
		return this.app.vault
			.getAllLoadedFiles()
			.filter((f): f is TFolder => f instanceof TFolder && !f.isRoot() && f.path.toLowerCase().includes(q))
			.sort((a, b) => a.path.localeCompare(b.path))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.setText(folder.path);
	}

	override selectSuggestion(folder: TFolder): void {
		this.input.value = folder.path;
		this.onPick(folder.path);
		this.close();
	}
}
