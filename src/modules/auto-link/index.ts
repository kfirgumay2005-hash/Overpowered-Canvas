import { Notice, Setting, TFile, debounce, normalizePath, parseFrontMatterAliases, type App } from "obsidian";
import { defineModule } from "../../core/module";
import { logError } from "../../core/log";
import type { CanvasFileData } from "../../data/json-canvas";
import { metadataCacheInternal } from "../../internals/app";
import type { CanvasLike, CanvasNodeLike, CanvasViewLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { tutorialsFolder } from "../../tutorials/runner";
import { readFrontmatter } from "../canvas-metadata/build";
import { isDrawing } from "../canvas-markdown/structure";
import { isTextBox, mutate, nodeType } from "../shared";
import { buildTrie, linkPaths, linkText, unlinkText, type Created, type Found, type Linked, type Title, type Trie } from "./match";
import { AutoLinkModal, type FilePlan, type ModalHost } from "./modal";

export type AutoLinkScope = "file" | "folder" | "vault";

export interface AutoLinkSettings {
	scope: AutoLinkScope;
	/** Scan Markdown notes as well as canvas cards. */
	notes: boolean;
	aliases: boolean;
	minLength: number;
	excludedFolders: string[];
	excludedTitles: string[];
	firstOnly: boolean;
	/** Also link a card when its editor closes. */
	live: boolean;
}

const SCOPES: AutoLinkScope[] = ["file", "folder", "vault"];
/** Notes other plugins own: their text is data, and links would change it. */
const OWNED_NOTE_KEYS = ["excalidraw-plugin", "kanban-plugin"];
const UNDO_FILE = "auto-link-last-run.json";
/** Characters a link's target or display text cannot hold. */
const UNLINKABLE = /[[\]|#^\n]/;
/** Files scanned between two yields to the UI. */
const SCAN_BATCH = 25;

interface RunUnit {
	/** Card id; absent for a note. */
	id?: string;
	links: Pick<Created, "link" | "text">[];
}
interface RunFile {
	path: string;
	units: RunUnit[];
}
interface Run {
	at: number;
	files: RunFile[];
}

const lines = (value: string) => value.split("\n").map((l) => l.trim()).filter(Boolean);
const withoutExtension = (path: string) => path.replace(/\.[^./]+$/, "");
/** The same file, or a canvas and the note of the same name beside it. */
const isSelf = (a: string, b: string) => withoutExtension(a) === withoutExtension(b);
const isCanvasFile = (file: TFile) => file.extension === "canvas";

function textCards(data: CanvasFileData): { id: string; text: string }[] {
	return (data.nodes ?? []).filter((n) => n.type === "text" && !isDrawing(n) && typeof n.text === "string").map((n) => ({ id: n.id, text: n.text as string }));
}

function openCanvasFor(app: App, file: TFile): CanvasLike | null {
	for (const leaf of app.workspace.getLeavesOfType("canvas")) {
		const view = leaf.view as CanvasViewLike;
		if (view.file === file && view.canvas) return view.canvas;
	}
	return null;
}

/**
 * Auto-link: finds note and canvas titles (and aliases) mentioned in canvas cards and notes and
 * turns them into real links, so the graph and the backlinks show the connection. The core
 * indexes links in text cards like links in notes, so a link in a card is all it takes.
 */
export const autoLinkModule = defineModule<AutoLinkSettings>({
	id: "auto-link",
	name: "autoLink.name",
	description: "autoLink.desc",
	group: "vault",
	defaultEnabled: true,
	defaultSettings: { scope: "vault", notes: false, aliases: true, minLength: 3, excludedFolders: [], excludedTitles: [], firstOnly: true, live: false },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		const strings = (v: unknown, fallback: string[]) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : fallback);
		return {
			scope: SCOPES.includes(s.scope) ? s.scope : defaults.scope,
			notes: s.notes === true,
			aliases: s.aliases !== false,
			minLength: Number.isFinite(s.minLength) ? Math.min(50, Math.max(1, Math.round(s.minLength))) : defaults.minLength,
			excludedFolders: strings(s.excludedFolders, defaults.excludedFolders),
			excludedTitles: strings(s.excludedTitles, defaults.excludedTitles),
			firstOnly: s.firstOnly !== false,
			live: s.live === true,
		};
	},

	enable(ctx) {
		const app = ctx.app;
		const mc = app.metadataCache;
		const internal = metadataCacheInternal(app);

		/**
		 * A tutorial's files. A scan started there sees nothing else, whatever the scope says, so
		 * practice can't write to the vault; any other scan skips them.
		 */
		const isPractice = (path: string) => path.startsWith(`${tutorialsFolder(ctx.filesFolder())}/`);
		const isExcluded = (path: string) => {
			if (isPractice(path)) return true;
			const folders = [ctx.filesFolder(), ...ctx.settings.excludedFolders].filter(Boolean).map((f) => normalizePath(f));
			return folders.some((f) => path === f || path.startsWith(`${f}/`)) || !!internal?.isUserIgnored?.(path);
		};
		const isSource = (file: TFile, notes: boolean) => {
			if (isExcluded(file.path)) return false;
			if (isCanvasFile(file)) return true;
			if (!notes || file.extension !== "md" || file.path.endsWith(".excalidraw.md")) return false;
			const front = mc.getFileCache(file)?.frontmatter;
			return !(front && OWNED_NOTE_KEYS.some((k) => k in front));
		};

		// ---------- the titles of the vault ----------

		const buildIndex = async (practice = false): Promise<Trie> => {
			const refused = new Set(ctx.settings.excludedTitles.map((t) => t.toLowerCase()));
			const titles: Title[] = [];
			const add = (phrase: string, file: TFile) => {
				const text = phrase.trim();
				if ([...text].length < ctx.settings.minLength || !/\p{L}/u.test(text) || UNLINKABLE.test(text) || refused.has(text.toLowerCase())) return;
				titles.push({ phrase: text, target: file.path });
			};
			for (const file of app.vault.getFiles()) {
				if ((file.extension !== "md" && !isCanvasFile(file)) || (practice ? !isPractice(file.path) : isExcluded(file.path))) continue;
				add(file.basename, file);
				if (!ctx.settings.aliases) continue;
				let front: unknown = mc.getFileCache(file)?.frontmatter;
				if (isCanvasFile(file)) {
					try {
						front = readFrontmatter(JSON.parse(await app.vault.cachedRead(file)));
					} catch {
						continue; // An empty or broken canvas has no aliases.
					}
				}
				for (const alias of parseFrontMatterAliases(front as Parameters<typeof parseFrontMatterAliases>[0]) ?? []) add(alias, file);
			}
			return buildTrie(titles);
		};

		/** The text with its links, as seen from `source`. */
		const link = (trie: Trie, text: string, source: TFile, note: boolean): Linked => {
			const pick = (found: Found) => {
				if (found.targets.some((t) => isSelf(t, source.path))) return null;
				if (found.targets.length === 1) return found.targets[0]!;
				const best = mc.getFirstLinkpathDest(found.text, source.path);
				if (best && found.targets.includes(best.path)) return best.path;
				return found.targets.find((t) => t.endsWith(".md")) ?? found.targets[0]!;
			};
			const render = (target: string, original: string, inTable: boolean) => {
				const file = app.vault.getFileByPath(target);
				const linktext = file ? mc.fileToLinktext(file, source.path, true) : target;
				return linktext === original ? `[[${original}]]` : `[[${linktext}${inTable ? "\\|" : "|"}${original}]]`;
			};
			const linked = new Set<string>();
			for (const path of linkPaths(text)) {
				const dest = mc.getFirstLinkpathDest(path, source.path);
				if (dest) linked.add(dest.path);
			}
			return linkText(text, trie, { pick, render, linked, firstOnly: ctx.settings.firstOnly, note });
		};

		// ---------- scanning ----------

		const sourcesIn = (scope: AutoLinkScope, active: TFile | null): TFile[] => {
			const notes = ctx.settings.notes;
			if (scope === "file") return active && isSource(active, notes) ? [active] : [];
			const folder = scope === "folder" ? (active?.parent?.path ?? null) : "/";
			if (folder === null) return [];
			const within = (f: TFile) => folder === "/" || f.path.startsWith(`${folder}/`);
			return app.vault.getFiles().filter((f) => within(f) && isSource(f, notes));
		};

		const readCanvas = async (file: TFile): Promise<CanvasFileData | null> => {
			const live = openCanvasFor(app, file);
			if (live) return live.getData();
			try {
				const text = await app.vault.cachedRead(file);
				return text.trim() ? (JSON.parse(text) as CanvasFileData) : null;
			} catch {
				return null; // Not a readable canvas: nothing to link in it.
			}
		};

		const planFile = async (trie: Trie, file: TFile): Promise<FilePlan | null> => {
			const created: Created[] = [];
			if (isCanvasFile(file)) {
				const data = await readCanvas(file);
				for (const card of data ? textCards(data) : []) created.push(...link(trie, card.text, file, false).created);
			} else created.push(...link(trie, await app.vault.cachedRead(file), file, true).created);
			return created.length ? { file, created } : null;
		};

		const scan = async (scope: AutoLinkScope, active: TFile | null): Promise<FilePlan[]> => {
			const board = active && isPractice(active.path) ? active : null;
			const trie = await buildIndex(!!board);
			const plans: FilePlan[] = [];
			const files = board ? [board] : sourcesIn(scope, active);
			for (let i = 0; i < files.length; i++) {
				const plan = await planFile(trie, files[i]!);
				if (plan) plans.push(plan);
				if (i % SCAN_BATCH === SCAN_BATCH - 1) await new Promise((r) => window.setTimeout(r));
			}
			return plans;
		};

		// ---------- writing ----------

		const undoPath = () => normalizePath(`${ctx.filesFolder() || "."}/${UNDO_FILE}`);
		const ensureFolder = async () => {
			const folder = ctx.filesFolder();
			if (folder && !(await app.vault.adapter.exists(folder))) await app.vault.createFolder(folder).catch(() => app.vault.adapter.mkdir(folder));
		};

		/** Rewrites the cards of a canvas: in the open view (one undo step), else in the file. */
		const editCanvas = async (file: TFile, edit: (id: string, text: string) => string): Promise<void> => {
			const canvas = openCanvasFor(app, file);
			if (canvas) {
				const data = canvas.getData();
				mutate(ctx, canvas, () => {
					for (const card of textCards(data)) {
						const node = canvas.nodes.get(card.id);
						if (!node || node.isEditing) continue;
						const text = edit(card.id, card.text);
						if (text !== card.text) node.setData({ ...node.getData(), text });
					}
				});
				return;
			}
			await app.vault.process(file, (raw) => {
				const doc = JSON.parse(raw) as CanvasFileData;
				let changed = false;
				for (const node of doc.nodes ?? []) {
					if (node.type !== "text" || isDrawing(node) || typeof node.text !== "string") continue;
					const text = edit(node.id, node.text);
					if (text === node.text) continue;
					node.text = text;
					changed = true;
				}
				return changed ? JSON.stringify(doc, null, "\t") : raw;
			});
		};

		/** The last run on a practice board: it must not replace the real one on disk. */
		let practiceRun: Run | null = null;

		const run = async (files: TFile[]): Promise<void> => {
			const practice = files.every((f) => isPractice(f.path));
			const trie = await buildIndex(practice);
			const done: RunFile[] = [];
			let links = 0;
			for (const file of files) {
				// By card: a write that runs again replaces what it recorded.
				const units = new Map<string, RunUnit>();
				const record = (created: Created[], id?: string) => {
					if (created.length) units.set(id ?? "", { ...(id ? { id } : {}), links: created.map(({ link, text }) => ({ link, text })) });
					else units.delete(id ?? "");
				};
				try {
					// Linked again from the current text: it may have changed since the preview.
					if (isCanvasFile(file)) {
						await editCanvas(file, (id, text) => {
							const r = link(trie, text, file, false);
							record(r.created, id);
							return r.text;
						});
					} else {
						await app.vault.process(file, (text) => {
							const r = link(trie, text, file, true);
							record(r.created);
							return r.text;
						});
					}
				} catch (error) {
					logError(`[overpowered-canvas] auto-link: could not write ${file.path}`, error);
					new Notice(ctx.t("autoLink.failed", { name: file.path }));
					continue;
				}
				if (!units.size) continue;
				done.push({ path: file.path, units: [...units.values()] });
				for (const unit of units.values()) links += unit.links.length;
			}
			const lastRun: Run = { at: Date.now(), files: done };
			if (done.length && practice) practiceRun = lastRun;
			else if (done.length) {
				await ensureFolder();
				await app.vault.adapter.write(undoPath(), JSON.stringify(lastRun));
			}
			new Notice(ctx.t("autoLink.done", { links, files: done.length }));
		};

		const undo = async (): Promise<void> => {
			const path = undoPath();
			const active = app.workspace.getActiveFile();
			const practice = !!active && isPractice(active.path);
			let last = practice ? practiceRun : null;
			try {
				if (!practice && (await app.vault.adapter.exists(path))) last = JSON.parse(await app.vault.adapter.read(path)) as Run;
			} catch (error) {
				logError("[overpowered-canvas] auto-link: could not read the last run", error);
			}
			if (!last?.files?.length) {
				new Notice(ctx.t("autoLink.nothingToUndo"));
				return;
			}
			let undone = 0;
			for (const entry of last.files) {
				const file = app.vault.getFileByPath(entry.path);
				if (!file) continue;
				const byId = new Map(entry.units.map((u) => [u.id ?? "", u.links]));
				if (isCanvasFile(file)) {
					await editCanvas(file, (id, text) => {
						const links = byId.get(id);
						if (!links) return text;
						const r = unlinkText(text, links);
						undone += r.undone;
						return r.text;
					});
				} else {
					await app.vault.process(file, (text) => {
						const r = unlinkText(text, byId.get("") ?? []);
						undone = r.undone + undone;
						return r.text;
					});
				}
			}
			if (practice) practiceRun = null;
			else await app.vault.adapter.remove(path);
			new Notice(ctx.t("autoLink.undone", { links: undone }));
		};

		// ---------- live mode ----------

		let liveIndex: Promise<Trie> | null = null;
		const stale = () => (liveIndex = null);
		const staleSoon = debounce(stale, 1000, true);
		ctx.registerEvent(app.vault.on("create", stale));
		ctx.registerEvent(app.vault.on("delete", stale));
		ctx.registerEvent(app.vault.on("rename", stale));
		ctx.registerEvent(mc.on("changed", staleSoon));
		ctx.onSettingsChange(stale);
		ctx.register(() => staleSoon.cancel());

		const linkCard = async (node: CanvasNodeLike) => {
			const canvas = node.canvas;
			const file = canvas.view.file;
			if (!file || canvas.readonly || node.isEditing || nodeType(node) !== "text" || !isTextBox(ctx, node) || !isSource(file, false)) return;
			const trie = await (liveIndex ??= buildIndex());
			const text = String((node.getData() as { text?: string }).text ?? "");
			const r = link(trie, text, file, false);
			if (r.created.length && canvas.nodes.get(node.id) === node && !node.isEditing) mutate(ctx, canvas, () => node.setData({ ...node.getData(), text: r.text }));
		};
		ctx.on("node-editing", (node, editing) => {
			if (editing || !ctx.settings.live) return;
			// The core writes the card's text after it leaves edit mode.
			window.setTimeout(() => linkCard(node).catch((e) => logError("[overpowered-canvas] auto-link: live link", e)));
		});

		// ---------- commands ----------

		const host: ModalHost = {
			scan,
			run,
			refuse: (title) => ctx.updateSettings({ excludedTitles: [...ctx.settings.excludedTitles, title] }),
		};
		ctx.addCommand({ id: "scan", name: ctx.t("autoLink.cmd.scan"), icon: "link", callback: () => new AutoLinkModal(ctx, host, app.workspace.getActiveFile()).open() });
		ctx.addCommand({ id: "undo", name: ctx.t("autoLink.cmd.undo"), icon: "undo-2", callback: () => void undo() });
	},

	renderSettings(el, ctx) {
		new Setting(el)
			.setName(ctx.t("autoLink.scope.name"))
			.setDesc(ctx.t("autoLink.scope.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ file: ctx.t("autoLink.scope.file"), folder: ctx.t("autoLink.scope.folder"), vault: ctx.t("autoLink.scope.vault") })
					.setValue(ctx.settings.scope)
					.onChange((v) => ctx.updateSettings({ scope: v as AutoLinkScope })),
			);
		new Setting(el)
			.setName(ctx.t("autoLink.notes.name"))
			.setDesc(ctx.t("autoLink.notes.desc"))
			.addToggle((t) => t.setValue(ctx.settings.notes).onChange((v) => ctx.updateSettings({ notes: v })));
		new Setting(el)
			.setName(ctx.t("autoLink.aliases.name"))
			.setDesc(ctx.t("autoLink.aliases.desc"))
			.addToggle((t) => t.setValue(ctx.settings.aliases).onChange((v) => ctx.updateSettings({ aliases: v })));
		new Setting(el)
			.setName(ctx.t("autoLink.firstOnly.name"))
			.setDesc(ctx.t("autoLink.firstOnly.desc"))
			.addToggle((t) => t.setValue(ctx.settings.firstOnly).onChange((v) => ctx.updateSettings({ firstOnly: v })));
		new Setting(el)
			.setName(ctx.t("autoLink.minLength.name"))
			.setDesc(ctx.t("autoLink.minLength.desc"))
			.addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(ctx.settings.minLength)).onChange((v) => Number(v) >= 1 && ctx.updateSettings({ minLength: Number(v) }));
			});
		new Setting(el)
			.setName(ctx.t("autoLink.excludedFolders.name"))
			.setDesc(ctx.t("autoLink.excludedFolders.desc"))
			.addTextArea((t) => t.setValue(ctx.settings.excludedFolders.join("\n")).onChange((v) => ctx.updateSettings({ excludedFolders: lines(v) })));
		new Setting(el)
			.setName(ctx.t("autoLink.excludedTitles.name"))
			.setDesc(ctx.t("autoLink.excludedTitles.desc"))
			.addTextArea((t) => t.setValue(ctx.settings.excludedTitles.join("\n")).onChange((v) => ctx.updateSettings({ excludedTitles: lines(v) })));
		new Setting(el)
			.setName(ctx.t("autoLink.live.name"))
			.setDesc(ctx.t("autoLink.live.desc"))
			.addToggle((t) => t.setValue(ctx.settings.live).onChange((v) => ctx.updateSettings({ live: v })));
	},
});

