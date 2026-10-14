import { Modal, Notice, Platform, Setting, type App, type TFile } from "obsidian";
import { defineModule } from "../../core/module";
import type { Translate } from "../../i18n";
import { isCanvasView } from "../../internals/guards";
import type { CanvasLike } from "../../internals/types";
import { exportCanvasSvg, svgToPng, type ExportOptions } from "./exporter";

interface ExportSettings {
	format: "png" | "svg";
	transparent: boolean;
	privacy: boolean;
	watermark: boolean;
	scale: number;
}

type Choice = ExportSettings & { scope: ExportOptions["scope"] };

class ExportModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private choice: Choice,
		private readonly hasSelection: boolean,
		private readonly onExport: (choice: Choice) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { t, contentEl } = this;
		this.setTitle(t("imageExport.title"));
		const c = this.choice;
		new Setting(contentEl).setName(t("imageExport.format")).addDropdown((d) =>
			d
				.addOptions({ png: "PNG", svg: "SVG" })
				.setValue(c.format)
				.onChange((v) => {
					c.format = v as Choice["format"];
					scaleSetting.settingEl.toggle(c.format === "png");
				}),
		);
		new Setting(contentEl).setName(t("imageExport.scope")).addDropdown((d) => {
			d.addOption("all", t("imageExport.scope.all"));
			if (this.hasSelection) d.addOption("selection", t("imageExport.scope.selection"));
			d.setValue(this.hasSelection ? c.scope : "all").onChange((v) => (c.scope = v as Choice["scope"]));
		});
		const scaleSetting = new Setting(contentEl).setName(t("imageExport.scale")).addDropdown((d) =>
			d
				.addOptions({ "1": "1×", "2": "2×", "3": "3×" })
				.setValue(String(c.scale))
				.onChange((v) => (c.scale = Number(v))),
		);
		scaleSetting.settingEl.toggle(c.format === "png");
		new Setting(contentEl)
			.setName(t("imageExport.transparent"))
			.addToggle((tg) => tg.setValue(c.transparent).onChange((v) => (c.transparent = v)));
		new Setting(contentEl)
			.setName(t("imageExport.privacy"))
			.setDesc(t("imageExport.privacy.desc"))
			.addToggle((tg) => tg.setValue(c.privacy).onChange((v) => (c.privacy = v)));
		new Setting(contentEl)
			.setName(t("imageExport.watermark"))
			.addToggle((tg) => tg.setValue(c.watermark).onChange((v) => (c.watermark = v)));
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(t("imageExport.export"))
				.setCta()
				.onClick(() => {
					this.close();
					this.onExport(c);
				}),
		);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Writes the file: native save dialog on desktop, the vault's attachment folder on mobile. */
async function save(app: App, canvasFile: TFile | null, name: string, data: ArrayBuffer | string): Promise<string | null> {
	const electron = (window as unknown as { electron?: { remote?: { dialog?: { showSaveDialog(opts: object): Promise<{ canceled: boolean; filePath?: string }> } } } }).electron;
	const nodeRequire = (window as unknown as { require?: (m: string) => unknown }).require;
	if (Platform.isDesktopApp && electron?.remote?.dialog && nodeRequire) {
		const ext = name.split(".").pop() ?? "png";
		const res = await electron.remote.dialog.showSaveDialog({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }], properties: ["showOverwriteConfirmation"] });
		if (res.canceled || !res.filePath) return null;
		const fs = nodeRequire("fs") as { promises: { writeFile(p: string, d: Uint8Array | string): Promise<void> } };
		await fs.promises.writeFile(res.filePath, typeof data === "string" ? data : new Uint8Array(data));
		return res.filePath;
	}
	const path = await app.fileManager.getAvailablePathForAttachment(name, canvasFile?.path);
	if (typeof data === "string") await app.vault.create(path, data);
	else await app.vault.createBinary(path, data);
	return path;
}

/** PNG and SVG export of the whole canvas or the selection: transparent background, privacy mode, watermark. */
export const imageExportModule = defineModule<ExportSettings>({
	id: "image-export",
	name: "imageExport.name",
	description: "imageExport.desc",
	group: "vault",
	defaultEnabled: true,
	defaultSettings: { format: "png", transparent: false, privacy: false, watermark: false, scale: 2 },
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const run = async (canvas: CanvasLike, choice: Choice) => {
			const notice = new Notice(ctx.t("imageExport.working"), 0);
			try {
				const result = await exportCanvasSvg(canvas, { ...choice, padding: 40 }, ctx.t("imageExport.watermarkText"));
				if (!result) {
					new Notice(ctx.t("imageExport.empty"));
					return;
				}
				const base = canvas.view.file?.basename ?? "canvas";
				const out = choice.format === "svg" ? result.svg : await (await svgToPng(result, choice.scale)).arrayBuffer();
				const where = await save(ctx.app, canvas.view.file, `${base}.${choice.format}`, out);
				if (where) new Notice(ctx.t("imageExport.saved", { path: where }));
			} catch (error) {
				console.error("[overpowered-canvas] export failed", error);
				new Notice(ctx.t("imageExport.failed"));
			} finally {
				notice.hide();
			}
		};

		const open = (canvas: CanvasLike) => {
			const s = ctx.settings;
			new ExportModal(ctx.app, ctx.t, { ...s, scope: canvas.selection.size > 0 ? "selection" : "all" }, canvas.selection.size > 0, (choice) => {
				const { scope: _scope, ...remember } = choice;
				void ctx.updateSettings(remember);
				void run(canvas, choice);
			}).open();
		};

		ctx.addCommand({
			id: "export-image",
			name: ctx.t("imageExport.command"),
			icon: "image-down",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas) return false;
				if (!checking) open(canvas);
				return true;
			},
		});
		// "More options" menu of the canvas view.
		ctx.registerEvent(
			ctx.app.workspace.on("file-menu", (menu, _file, source, leaf) => {
				const view = leaf?.view;
				if (source !== "more-options" || !isCanvasView(view)) return;
				menu.addItem((item) => item.setSection("action").setTitle(ctx.t("imageExport.command")).setIcon("image-down").onClick(() => open(view.canvas)));
			}),
		);
		ctx.onSelectionMenu((menu, canvas) => menu.addItem((item) => item.setSection("action").setTitle(ctx.t("imageExport.command")).setIcon("image-down").onClick(() => open(canvas))));
	},
});
