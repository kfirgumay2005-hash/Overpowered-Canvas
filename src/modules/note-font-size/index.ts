import { MarkdownView, Notice, Setting, TFile, type Menu } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { mergeWithDefaults } from "../../settings/settings";
import { NumberPromptModal } from "../../ui/number-prompt";
import { MAX_SIZE, MIN_SIZE, parseFontSize, propertyKey, stepFontSize } from "./logic";

export interface NoteFontSizeSettings {
	/** The frontmatter property that holds a note's size. */
	property: string;
	/** Pixels per increase / decrease. */
	step: number;
}

type Ctx = ModuleContext<NoteFontSizeSettings>;

const DEFAULT_PROPERTY = "font-size";
const CLASS = "opc-note-font-size";
const VAR = "--opc-note-font-size";

/** The vault's text size (Settings → Appearance → Font size), in pixels. */
function baseSize(): number {
	const px = Number.parseFloat(getComputedStyle(activeDocument.body).getPropertyValue("--font-text-size"));
	return Number.isFinite(px) && px > 0 ? px : 16;
}

/**
 * Per-note font size from a frontmatter property (default `font-size`), set by hand in the
 * properties or with the commands. The size goes into the variables Obsidian sizes note text
 * with, on the whole note view, so Live Preview, Source mode and Reading mode use exactly the
 * same size and nothing moves when switching between them.
 */
export const noteFontSizeModule = defineModule<NoteFontSizeSettings>({
	id: "note-font-size",
	name: "noteFontSize.name",
	description: "noteFontSize.desc",
	group: "notes",
	defaultEnabled: true,
	defaultSettings: { property: DEFAULT_PROPERTY, step: 1 },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		const step = typeof s.step === "number" && Number.isFinite(s.step) ? Math.max(1, Math.min(8, Math.round(s.step))) : defaults.step;
		return { property: typeof s.property === "string" ? s.property : defaults.property, step };
	},

	enable(ctx: Ctx) {
		const { app } = ctx;
		const key = () => propertyKey(ctx.settings.property, DEFAULT_PROPERTY);
		/** Sizes just written, shown before the metadata cache has read the file again. */
		const pending = new Map<string, number | null>();
		const styled = new Set<HTMLElement>();

		/** The property value of a note, matching the key without regard to case. */
		const rawOf = (file: TFile): unknown => {
			const fm = app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm) return undefined;
			const k = key();
			if (k in fm) return fm[k];
			const lower = k.toLowerCase();
			const found = Object.keys(fm).find((f) => f.toLowerCase() === lower);
			return found === undefined ? undefined : fm[found];
		};
		const sizeOf = (file: TFile): number | null => (pending.has(file.path) ? pending.get(file.path)! : parseFontSize(rawOf(file), baseSize()));

		const apply = (view: MarkdownView) => {
			const el = view.contentEl;
			const size = view.file ? sizeOf(view.file) : null;
			if (size === null) {
				if (!styled.has(el)) return;
				el.removeClass(CLASS);
				el.style.removeProperty(VAR);
				styled.delete(el);
				return;
			}
			el.addClass(CLASS);
			el.setCssProps({ [VAR]: `${size}px` });
			styled.add(el);
		};
		const markdownViews = () =>
			app.workspace
				.getLeavesOfType("markdown")
				.map((l) => l.view)
				.filter((v): v is MarkdownView => v instanceof MarkdownView);
		const applyAll = () => {
			for (const el of [...styled]) if (!el.isConnected) styled.delete(el);
			for (const view of markdownViews()) apply(view);
		};

		app.workspace.onLayoutReady(applyAll);
		ctx.registerEvent(app.workspace.on("layout-change", applyAll));
		ctx.registerEvent(app.workspace.on("file-open", applyAll));
		ctx.registerEvent(app.workspace.on("css-change", applyAll));
		ctx.registerEvent(
			app.metadataCache.on("changed", (file) => {
				pending.delete(file.path);
				for (const view of markdownViews()) if (view.file === file) apply(view);
			}),
		);
		ctx.onSettingsChange(applyAll);
		ctx.register(() => {
			for (const el of styled) {
				el.removeClass(CLASS);
				el.style.removeProperty(VAR);
			}
			styled.clear();
		});

		// ---- Commands -----------------------------------------------------------------------

		/**
		 * The note the commands act on: the note being edited or read, also when a sidebar, a
		 * drawer (tablets and phones) or the command palette has the focus; else the note shown
		 * in the most recent tab.
		 */
		const activeNote = (): TFile | null => {
			const isNote = (f: unknown): f is TFile => f instanceof TFile && f.extension === "md";
			const view = app.workspace.getActiveViewOfType(MarkdownView);
			if (isNote(view?.file)) return view.file;
			const editing = app.workspace.activeEditor?.file;
			if (isNote(editing)) return editing;
			const active = app.workspace.getActiveFile();
			if (isNote(active) && markdownViews().some((v) => v.file === active)) return active;
			const recent = app.workspace.getMostRecentLeaf()?.view;
			return recent instanceof MarkdownView && isNote(recent.file) ? recent.file : null;
		};
		const write = async (file: TFile, size: number | null) => {
			pending.set(file.path, size);
			applyAll();
			try {
				await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					const k = key();
					const lower = k.toLowerCase();
					for (const f of Object.keys(fm)) if (f !== k && f.toLowerCase() === lower) delete fm[f];
					if (size === null) delete fm[k];
					else fm[k] = size;
				});
			} catch (error) {
				pending.delete(file.path);
				applyAll();
				new Notice(ctx.t("noteFontSize.failed"));
				throw error;
			}
		};
		const step = (direction: 1 | -1, file = activeNote()) => {
			if (!file) return;
			const now = sizeOf(file) ?? baseSize();
			void write(file, stepFontSize(now, ctx.settings.step, direction));
		};

		const prompt = (file: TFile) =>
			new NumberPromptModal(
				app,
				ctx.t,
				{ title: ctx.t("noteFontSize.set"), help: ctx.t("noteFontSize.prompt", { base: Math.round(baseSize()) }), value: sizeOf(file) ?? undefined, min: MIN_SIZE, max: MAX_SIZE, step: 1 },
				(v) => void write(file, v ?? null),
			).open();
		ctx.addCommand({
			id: "set",
			name: ctx.t("noteFontSize.set"),
			icon: "type",
			checkCallback: (checking) => {
				const file = activeNote();
				if (!file) return false;
				if (!checking) prompt(file);
				return true;
			},
		});
		ctx.addCommand({
			id: "increase",
			name: ctx.t("noteFontSize.increase"),
			icon: "a-arrow-up",
			checkCallback: (checking) => {
				if (!activeNote()) return false;
				if (!checking) step(1);
				return true;
			},
		});
		ctx.addCommand({
			id: "decrease",
			name: ctx.t("noteFontSize.decrease"),
			icon: "a-arrow-down",
			checkCallback: (checking) => {
				if (!activeNote()) return false;
				if (!checking) step(-1);
				return true;
			},
		});
		ctx.addCommand({
			id: "reset",
			name: ctx.t("noteFontSize.reset"),
			icon: "rotate-ccw",
			checkCallback: (checking) => {
				const file = activeNote();
				if (!file || sizeOf(file) === null) return false;
				if (!checking) void write(file, null);
				return true;
			},
		});

		// Without a keyboard or the command palette: the note's menu (⋮, or a long press on its
		// tab or in the file list) and the editor's menu (right-click or long press in the text).
		const addMenu = (menu: Menu, file: TFile) => {
			menu.addItem((item) => {
				item.setTitle(ctx.t("noteFontSize.menu")).setIcon("type").setSection("view");
				const sub = (item as unknown as { setSubmenu?(): Menu }).setSubmenu?.();
				if (!sub) {
					item.onClick(() => prompt(file));
					return;
				}
				sub.addItem((i) => i.setTitle(ctx.t("noteFontSize.set")).setIcon("type").onClick(() => prompt(file)));
				sub.addItem((i) => i.setTitle(ctx.t("noteFontSize.increase")).setIcon("a-arrow-up").onClick(() => step(1, file)));
				sub.addItem((i) => i.setTitle(ctx.t("noteFontSize.decrease")).setIcon("a-arrow-down").onClick(() => step(-1, file)));
				if (sizeOf(file) !== null) sub.addItem((i) => i.setTitle(ctx.t("noteFontSize.reset")).setIcon("rotate-ccw").onClick(() => void write(file, null)));
			});
		};
		ctx.registerEvent(
			app.workspace.on("file-menu", (menu, file) => {
				if (file instanceof TFile && file.extension === "md") addMenu(menu, file);
			}),
		);
		ctx.registerEvent(
			app.workspace.on("editor-menu", (menu, _editor, info) => {
				if (info.file instanceof TFile && info.file.extension === "md") addMenu(menu, info.file);
			}),
		);
	},

	renderSettings(el, ctx: Ctx) {
		new Setting(el)
			.setName(ctx.t("noteFontSize.property.name"))
			.setDesc(ctx.t("noteFontSize.property.desc"))
			.addText((t) =>
				t
					.setPlaceholder(DEFAULT_PROPERTY)
					.setValue(ctx.settings.property)
					.onChange((v) => ctx.updateSettings({ property: v })),
			);
		new Setting(el)
			.setName(ctx.t("noteFontSize.step.name"))
			.setDesc(ctx.t("noteFontSize.step.desc"))
			.addSlider((s) =>
				s
					.setLimits(1, 8, 1)
					.setValue(ctx.settings.step)
					.onChange((v) => ctx.updateSettings({ step: v })),
			);
	},
});
