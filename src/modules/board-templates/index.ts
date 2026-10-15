import { normalizePath, Notice, Setting, SuggestModal, TFile, TFolder, setIcon, type App } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasFileData } from "../../data/json-canvas";
import { checkCanvasFile, hasErrors } from "../../data/validate-file";
import type { Translate } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { TextPromptModal } from "../../ui/text-prompt";
import { canvasDirection, mutate, randomId, selectedNodes } from "../shared";
import { BUILTIN_ICONS, BUILTIN_IDS, builtinTemplate, type BuiltinId } from "./builtins";
import { bounds, extract, instantiate, normalize, uniqueName } from "./logic";

interface TemplateSettings {
	folder: string;
}


interface TemplateChoice {
	name: string;
	icon: string;
	source: "builtin" | "file";
	builtin?: BuiltinId;
	file?: TFile;
}

function weekStartsSunday(): boolean {
	const m = (window as unknown as { moment?: { localeData(): { firstDayOfWeek(): number } } }).moment;
	try {
		return m?.localeData().firstDayOfWeek() === 0;
	} catch {
		return false;
	}
}

class TemplateSuggest extends SuggestModal<TemplateChoice> {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly choices: TemplateChoice[],
		private readonly onPick: (choice: TemplateChoice) => void,
	) {
		super(app);
		this.setPlaceholder(t("templates.pick"));
	}

	getSuggestions(query: string): TemplateChoice[] {
		const q = query.trim().toLocaleLowerCase();
		return this.choices.filter((c) => c.name.toLocaleLowerCase().includes(q));
	}

	renderSuggestion(choice: TemplateChoice, el: HTMLElement): void {
		el.addClass("opc-template-suggestion");
		setIcon(el.createSpan({ cls: "opc-template-icon" }), choice.icon);
		el.createSpan({ text: choice.name });
		if (choice.source === "builtin") el.createSpan({ cls: "opc-template-badge", text: this.t("templates.builtin") });
	}

	onChooseSuggestion(choice: TemplateChoice): void {
		this.onPick(choice);
	}
}

/**
 * Board templates: save a canvas or a selection as a template (a .canvas file in the
 * templates folder), create a new canvas from a template, or insert one into the current
 * canvas. Built-ins: Kanban, SWOT, Retro, Weekly plan, Mind map and Flowchart, generated in
 * the UI language and mirrored for right-to-left boards.
 */
export const boardTemplatesModule = defineModule<TemplateSettings>({
	id: "board-templates",
	name: "templates.name",
	description: "templates.desc",
	group: "data",
	defaultEnabled: true,
	defaultSettings: { folder: "Canvas templates" },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return { folder: typeof s.folder === "string" && s.folder.trim() ? normalizePath(s.folder.trim()) : defaults.folder };
	},

	enable(ctx) {
		const app = ctx.app;
		const folder = () => normalizePath(ctx.settings.folder);

		const choices = (): TemplateChoice[] => {
			const out: TemplateChoice[] = BUILTIN_IDS.map((id) => ({ name: ctx.t(`templates.builtin.${id}`), icon: BUILTIN_ICONS[id], source: "builtin" as const, builtin: id }));
			const dir = app.vault.getAbstractFileByPath(folder());
			if (dir instanceof TFolder) {
				const files = dir.children.filter((f): f is TFile => f instanceof TFile && f.extension === "canvas").sort((a, b) => a.basename.localeCompare(b.basename));
				for (const file of files) out.unshift({ name: file.basename, icon: "layout-template", source: "file", file });
			}
			return out;
		};

		const load = async (choice: TemplateChoice): Promise<CanvasFileData | null> => {
			if (choice.builtin) return builtinTemplate(choice.builtin, ctx.t, weekStartsSunday());
			if (!choice.file) return null;
			try {
				const data = JSON.parse(await app.vault.read(choice.file)) as CanvasFileData;
				if (hasErrors(checkCanvasFile(data))) throw new Error("invalid canvas");
				return data;
			} catch {
				new Notice(ctx.t("templates.invalid", { name: choice.file.basename }));
				return null;
			}
		};

		const ensureFolder = async () => {
			const path = folder();
			if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
			return path;
		};

		const newCanvas = (choice: TemplateChoice) =>
			void (async () => {
				const template = await load(choice);
				if (!template) return;
				const rtl = getComputedStyle(activeDocument.body).direction === "rtl";
				const data = instantiate(template, { x: 0, y: 0 }, () => randomId(), rtl);
				const parent = app.fileManager.getNewFileParent(app.workspace.getActiveFile()?.path ?? "");
				const base = parent.isRoot() ? "" : `${parent.path}/`;
				const name = uniqueName(choice.name, (n) => !!app.vault.getAbstractFileByPath(`${base}${n}.canvas`));
				const file = await app.vault.create(`${base}${name}.canvas`, JSON.stringify(data, null, "\t"));
				await app.workspace.getLeaf(false).openFile(file);
				const canvas = ctx.activeCanvas();
				if (canvas) ctx.events.emit("board-template-applied", canvas, choice.name);
			})();

		const insert = (canvas: CanvasLike, choice: TemplateChoice) =>
			void (async () => {
				const template = await load(choice);
				if (!template || canvas.readonly) return;
				const b = bounds(template);
				const view = canvas.getViewportBBox();
				const at = { x: (view.minX + view.maxX) / 2 - (b.maxX - b.minX) / 2, y: (view.minY + view.maxY) / 2 - (b.maxY - b.minY) / 2 };
				const data = instantiate(template, at, () => randomId(), canvasDirection(canvas) === "rtl");
				let added: Set<CanvasNodeLike> | undefined;
				mutate(ctx, canvas, () => {
					added = canvas.importData({ nodes: data.nodes, edges: data.edges }, false);
				});
				if (added?.size) {
					canvas.selectAll(added);
					canvas.zoomToSelection();
				}
				ctx.events.emit("board-template-applied", canvas, choice.name);
			})();

		const save = (canvas: CanvasLike, selectionOnly: boolean) => {
			const all = canvas.getData();
			const ids = new Set(selectedNodes(canvas).map((n) => n.id));
			const data = selectionOnly ? extract(all, ids) : { ...all, nodes: all.nodes ?? [], edges: all.edges ?? [] };
			if ((data.nodes ?? []).length === 0) {
				new Notice(ctx.t("templates.nothing"));
				return;
			}
			const suggested = selectionOnly ? ctx.t("templates.selectionName") : (canvas.view.file?.basename ?? ctx.t("templates.selectionName"));
			new TextPromptModal(app, ctx.t, { title: ctx.t(selectionOnly ? "templates.saveSelection" : "templates.saveCanvas"), help: ctx.t("templates.saveHelp", { folder: folder() }), value: suggested }, (name) =>
				void (async () => {
					const dir = await ensureFolder();
					const clean = name.replace(/[\\/:*?"<>|#^[\]]/g, "-");
					const path = `${dir}/${uniqueName(clean, (n) => !!app.vault.getAbstractFileByPath(`${dir}/${n}.canvas`))}.canvas`;
					await app.vault.create(path, JSON.stringify(normalize(data), null, "\t"));
					new Notice(ctx.t("templates.saved", { path }));
				})(),
			).open();
		};

		ctx.addCommand({ id: "new-from-template", name: ctx.t("templates.newFrom"), icon: "layout-template", callback: () => new TemplateSuggest(app, ctx.t, choices(), newCanvas).open() });
		ctx.addCommand({
			id: "insert-template",
			name: ctx.t("templates.insert"),
			icon: "layout-template",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) new TemplateSuggest(app, ctx.t, choices(), (c) => insert(canvas, c)).open();
				return true;
			},
		});
		ctx.addCommand({
			id: "save-canvas",
			name: ctx.t("templates.saveCanvas"),
			icon: "save",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas) return false;
				if (!checking) save(canvas, false);
				return true;
			},
		});
		ctx.addCommand({
			id: "save-selection",
			name: ctx.t("templates.saveSelection"),
			icon: "save",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || selectedNodes(canvas).length === 0) return false;
				if (!checking) save(canvas, true);
				return true;
			},
		});
		ctx.addCardMenuButton({
			id: "insert-template",
			icon: "layout-template",
			tooltip: () => ctx.t("templates.insert"),
			order: 130,
			onClick: (canvas) => new TemplateSuggest(app, ctx.t, choices(), (c) => insert(canvas, c)).open(),
		});
		ctx.onSelectionMenu((menu, canvas) => {
			menu.addItem((item) => item.setTitle(ctx.t("templates.saveSelection")).setIcon("layout-template").onClick(() => save(canvas, true)));
		});
		ctx.registerEvent(
			app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFolder)) return;
				menu.addItem((item) =>
					item
						.setTitle(ctx.t("templates.newFrom"))
						.setIcon("layout-template")
						.onClick(() =>
							new TemplateSuggest(app, ctx.t, choices(), (choice) =>
								void (async () => {
									const template = await load(choice);
									if (!template) return;
									const data = instantiate(template, { x: 0, y: 0 }, () => randomId(), getComputedStyle(activeDocument.body).direction === "rtl");
									const base = file.isRoot() ? "" : `${file.path}/`;
									const name = uniqueName(choice.name, (n) => !!app.vault.getAbstractFileByPath(`${base}${n}.canvas`));
									const created = await app.vault.create(`${base}${name}.canvas`, JSON.stringify(data, null, "\t"));
									await app.workspace.getLeaf(false).openFile(created);
								})(),
							).open(),
						),
				);
			}),
		);
	},

	renderSettings(el, ctx: ModuleContext<TemplateSettings>) {
		new Setting(el)
			.setName(ctx.t("templates.folder.name"))
			.setDesc(ctx.t("templates.folder.desc"))
			.addText((t) => t.setValue(ctx.settings.folder).onChange((v) => ctx.updateSettings({ folder: v })));
	},
});
