import { Modal, Notice, Platform, Setting, normalizePath, setIcon, type App, type EventRef, type TFile } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { logError } from "../../core/log";
import { PAPER_FORMAT_IDS, type PaperFormatId, type PaperSpec } from "../../data/schema";
import type { Translate } from "../../i18n";
import type { CanvasLike } from "../../internals/types";
import { exportCanvasSvg, svgToPng } from "../image-export/exporter";
import { pagesHost } from "../pages/api";
import { isOffBoard, mutate } from "../shared";
import { paperMm, pdfPageSize, sheetsFor, stackOrigin, stackSheets, type Box } from "./layout";

type Ctx = ModuleContext<object>;

interface WebContentsLike {
	printToPDF(options: object): Promise<Uint8Array>;
}

function webContents(): WebContentsLike | null {
	const electron = (window as unknown as { electron?: { remote?: { getCurrentWebContents?(): WebContentsLike } } }).electron;
	return Platform.isDesktopApp ? (electron?.remote?.getCurrentWebContents?.() ?? null) : null;
}

/** Time for cards and images to finish drawing before the PDF is taken. */
const PRINT_SETTLE = 500;

/** The page of the canvas shown ("" = main page, or when pages are off). */
const pageShown = (canvas: CanvasLike) => pagesHost.api?.current(canvas) ?? "";

/** What lies on the board on the page shown (cards, drawings, groups), as one box. */
function contentBox(canvas: CanvasLike): { minX: number; minY: number; maxX: number; maxY: number } | null {
	let box: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
	for (const n of canvas.nodes.values()) {
		if (isOffBoard(n)) continue;
		if (!box) box = { minX: n.x, minY: n.y, maxX: n.x + n.width, maxY: n.y + n.height };
		else {
			box.minX = Math.min(box.minX, n.x);
			box.minY = Math.min(box.minY, n.y);
			box.maxX = Math.max(box.maxX, n.x + n.width);
			box.maxY = Math.max(box.maxY, n.y + n.height);
		}
	}
	return box;
}

/**
 * The sheets of one canvas: a layer under everything on the board (under groups too), one stack of
 * sheets for the page shown, as many as its content reaches (and as many as were added by hand),
 * with a "+" to add one more below.
 */
class PaperLayer {
	private readonly el: HTMLElement;
	private frame = 0;
	sheets: Box[] = [];

	constructor(
		private readonly ctx: Ctx,
		private readonly canvas: CanvasLike,
		private readonly addPage: () => void,
	) {
		this.el = createDiv({ cls: "opc-paper-layer" });
		canvas.canvasEl.prepend(this.el);
		this.render();
	}

	destroy(): void {
		this.canvas.wrapperEl.win.cancelAnimationFrame(this.frame);
		this.el.remove();
		this.canvas.wrapperEl.removeClass("opc-paper");
	}

	schedule(): void {
		if (this.frame) return;
		this.frame = this.canvas.wrapperEl.win.requestAnimationFrame(() => {
			this.frame = 0;
			this.render();
		});
	}

	/** The stack of the page shown: stored, or placed around its content now (and stored). */
	stack(spec: PaperSpec): { x: number; y: number; count?: number } {
		const page = pageShown(this.canvas);
		const known = spec.stacks?.[page];
		if (known) return known;
		const placed = stackOrigin(contentBox(this.canvas));
		if (!this.canvas.readonly) {
			try {
				// Where the sheets are is part of the canvas, but placing them is no step of its own.
				this.ctx.data.root(this.canvas).set({ paper: { ...spec, stacks: { ...(spec.stacks ?? {}), [page]: placed } } }, { history: false });
			} catch (error) {
				logError("[overpowered-canvas] paper: placing the sheets", error);
			}
		}
		return placed;
	}

	render(): void {
		const spec = this.ctx.data.root(this.canvas).get().paper;
		// The board may have been emptied and filled again (another file in this tab).
		if (this.el.parentElement !== this.canvas.canvasEl) this.canvas.canvasEl.prepend(this.el);
		this.el.empty();
		this.canvas.wrapperEl.toggleClass("opc-paper", !!spec);
		if (!spec) {
			this.sheets = [];
			return;
		}
		const stack = this.stack(spec);
		const content = contentBox(this.canvas);
		const count = Math.max(stack.count ?? 1, sheetsFor(stack, spec, content ? content.maxY : null));
		this.sheets = stackSheets(stack, spec, count);
		this.sheets.forEach((s, i) => {
			const sheet = this.el.createDiv({ cls: "opc-paper-sheet" });
			sheet.setCssProps({ "--opc-sheet-x": `${s.x}px`, "--opc-sheet-y": `${s.y}px`, "--opc-sheet-w": `${s.width}px`, "--opc-sheet-h": `${s.height}px` });
			sheet.createDiv({ cls: "opc-paper-number", text: String(i + 1) });
		});
		const last = this.sheets[this.sheets.length - 1]!;
		if (!this.canvas.readonly) {
			const add = this.el.createEl("button", { cls: "opc-paper-add", attr: { "aria-label": this.ctx.t("paper.add") } });
			add.setCssProps({ "--opc-sheet-x": `${last.x}px`, "--opc-sheet-y": `${last.y + last.height + 16}px`, "--opc-sheet-w": `${last.width}px` });
			setIcon(add.createSpan(), "plus");
			add.createSpan({ text: this.ctx.t("paper.add") });
			add.addEventListener("pointerdown", (e) => e.stopPropagation());
			add.addEventListener("click", (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.addPage();
			});
		}
	}
}

/** Choosing the page format of a canvas (or turning it off). */
class PaperModal extends Modal {
	private spec: PaperSpec;

	constructor(
		app: App,
		private readonly t: Translate,
		current: PaperSpec | undefined,
		private readonly onDone: (spec: PaperSpec | null) => void,
	) {
		super(app);
		this.spec = { format: current?.format ?? "A4", ...(current?.landscape ? { landscape: true } : {}), ...(current?.width ? { width: current.width } : {}), ...(current?.height ? { height: current.height } : {}) };
	}

	override onOpen(): void {
		this.render();
	}

	private render(): void {
		const { t } = this;
		this.contentEl.empty();
		this.setTitle(t("paper.title"));
		this.contentEl.createEl("p", { cls: "setting-item-description", text: t("paper.help") });
		new Setting(this.contentEl).setName(t("paper.format")).addDropdown((d) => {
			for (const id of PAPER_FORMAT_IDS) d.addOption(id, id === "custom" ? t("paper.custom") : `${id} (${Math.round(paperMm({ format: id }).width)} × ${Math.round(paperMm({ format: id }).height)} mm)`);
			d.setValue(this.spec.format).onChange((v) => {
				this.spec = { ...this.spec, format: v as PaperFormatId };
				this.render();
			});
		});
		new Setting(this.contentEl).setName(t("paper.landscape")).addToggle((tg) =>
			tg.setValue(!!this.spec.landscape).onChange((v) => {
				this.spec = { ...this.spec, landscape: v || undefined };
			}),
		);
		if (this.spec.format === "custom") {
			const size = paperMm(this.spec);
			const mm = (key: "width" | "height", label: string) =>
				new Setting(this.contentEl).setName(label).addText((tx) => {
					tx.inputEl.type = "number";
					tx.setValue(String(Math.round(size[key]))).onChange((v) => {
						const n = Number(v);
						if (n >= 50 && n <= 2000) this.spec = { ...this.spec, [key]: n };
					});
				});
			mm("width", t("paper.width"));
			mm("height", t("paper.height"));
		}
		new Setting(this.contentEl)
			.addButton((b) =>
				b.setButtonText(t("paper.off")).onClick(() => {
					this.onDone(null);
					this.close();
				}),
			)
			.addButton((b) =>
				b
					.setButtonText(t("paper.use"))
					.setCta()
					.onClick(() => {
						this.onDone(this.spec);
						this.close();
					}),
			);
	}
}

/**
 * Page format: a canvas can show sheets of paper (A3, A4, A5, Letter, Legal or a size of its own,
 * portrait or landscape) instead of an endless board. Everything is placed on and across the
 * sheets as usual; a stack grows as the content goes down and with the "+" below it. Each page of
 * the canvas (Pages) has a stack of its own in the same format. The sheets export to PDF, one PDF
 * page per sheet (desktop), or to one picture per sheet.
 */
export const paperModule = defineModule<object>({
	id: "paper",
	name: "paper.name",
	description: "paper.desc",
	group: "navigation",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		const layers = new Map<CanvasLike, PaperLayer>();
		const t = ctx.t;

		const addPage = (canvas: CanvasLike) => {
			const layer = layers.get(canvas);
			const spec = ctx.data.root(canvas).get().paper;
			if (!layer || !spec || canvas.readonly) return;
			const stack = layer.stack(spec);
			const page = pageShown(canvas);
			const count = Math.max(stack.count ?? 1, layer.sheets.length) + 1;
			mutate(ctx, canvas, () => ctx.data.root(canvas).set({ paper: { ...spec, stacks: { ...(spec.stacks ?? {}), [page]: { x: stack.x, y: stack.y, count } } } }));
			layer.render();
			const last = layer.sheets[layer.sheets.length - 1];
			if (last) canvas.zoomToBbox({ minX: last.x - 40, minY: last.y - 40, maxX: last.x + last.width + 40, maxY: last.y + last.height + 40 });
			ctx.events.emit("paper-changed", canvas);
		};

		/** Removes sheets added by hand below the content (at least one stays). */
		const removePage = (canvas: CanvasLike) => {
			const spec = ctx.data.root(canvas).get().paper;
			const layer = layers.get(canvas);
			if (!spec || !layer || canvas.readonly) return;
			const stack = layer.stack(spec);
			const content = contentBox(canvas);
			const needed = sheetsFor(stack, spec, content ? content.maxY : null);
			const now = Math.max(stack.count ?? 1, layer.sheets.length);
			if (now <= needed) return new Notice(t("paper.removeNotEmpty"));
			const page = pageShown(canvas);
			mutate(ctx, canvas, () => ctx.data.root(canvas).set({ paper: { ...spec, stacks: { ...(spec.stacks ?? {}), [page]: { x: stack.x, y: stack.y, count: now - 1 } } } }));
			layer.render();
			ctx.events.emit("paper-changed", canvas);
		};

		const setUp = (canvas: CanvasLike) => {
			const current = ctx.data.root(canvas).get().paper;
			new PaperModal(ctx.app, t, current, (spec) => {
				// A new size keeps where the stacks are (their top-left corners) and the sheets added.
				mutate(ctx, canvas, () => ctx.data.root(canvas).set({ paper: spec ? { ...spec, ...(current?.stacks ? { stacks: current.stacks } : {}) } : undefined }));
				layers.get(canvas)?.render();
				const sheet = layers.get(canvas)?.sheets[0];
				if (sheet) canvas.zoomToBbox({ minX: sheet.x - 40, minY: sheet.y - 40, maxX: sheet.x + sheet.width + 40, maxY: sheet.y + sheet.height + 40 });
				ctx.events.emit("paper-changed", canvas);
			}).open();
		};

		/** A path next to the canvas, named after it, that doesn't exist yet ("" ext: a folder). */
		const freePath = (file: TFile, ext: string, suffix = "") => {
			const folder = file.parent && !file.parent.isRoot() ? `${file.parent.path}/` : "";
			const dot = ext ? `.${ext}` : "";
			let path = normalizePath(`${folder}${file.basename}${suffix}${dot}`);
			for (let i = 2; ctx.app.vault.getAbstractFileByPath(path); i++) path = normalizePath(`${folder}${file.basename}${suffix} ${i}${dot}`);
			return path;
		};

		/** Each sheet of the page shown, as an SVG of exactly that part of the board. */
		const sheetSvgs = async (canvas: CanvasLike) => {
			const layer = layers.get(canvas);
			const out: { svg: string; width: number; height: number }[] = [];
			for (const s of layer?.sheets ?? []) {
				const r = await exportCanvasSvg(canvas, { scope: "all", transparent: false, privacy: false, watermark: false, scale: 1, padding: 0, region: { minX: s.x, minY: s.y, maxX: s.x + s.width, maxY: s.y + s.height } }, "");
				if (r) out.push(r);
			}
			return out;
		};

		const exportPdf = async (canvas: CanvasLike) => {
			const spec = ctx.data.root(canvas).get().paper;
			const file = canvas.view.file;
			const contents = webContents();
			if (!spec || !file) return;
			if (!contents) return exportImages(canvas);
			const notice = new Notice(t("paper.pdf.working"), 0);
			const doc = canvas.wrapperEl.doc;
			const root = doc.body.createDiv({ cls: "print opc-paper-print" });
			try {
				const svgs = await sheetSvgs(canvas);
				const size = layers.get(canvas)?.sheets[0];
				for (const r of svgs) {
					const sheet = root.createDiv({ cls: "opc-paper-print-sheet" });
					sheet.setCssProps({ "--opc-sheet-w": `${size?.width ?? r.width}px`, "--opc-sheet-h": `${size?.height ?? r.height}px` });
					// The exporter's clone of the board (HTML) and its styles, put in the page as they
					// are: printing draws them as vector text and shapes (an SVG foreignObject would not
					// be painted by the PDF printer).
					const parsed = new DOMParser().parseFromString(r.svg, "image/svg+xml");
					const style = parsed.querySelector("style");
					const clone = parsed.querySelector("foreignObject")?.firstElementChild;
					if (style) sheet.appendChild(doc.importNode(style, true));
					if (clone) sheet.appendChild(doc.importNode(clone, true));
				}
				await new Promise((res) => window.setTimeout(res, PRINT_SETTLE));
				const pdf = await contents.printToPDF({ pageSize: pdfPageSize(spec), printBackground: true, margins: { marginType: "none" }, preferCSSPageSize: false });
				const path = freePath(file, "pdf");
				await ctx.app.vault.createBinary(path, pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer);
				new Notice(t("paper.pdf.done", { path, count: String(svgs.length) }));
				ctx.events.emit("paper-exported", canvas, path);
			} catch (error) {
				logError("[overpowered-canvas] paper: PDF", error);
				new Notice(t("paper.pdf.failed"));
			} finally {
				notice.hide();
				root.remove();
			}
		};

		/** One picture per sheet, in a folder next to the canvas (where there is no PDF printing). */
		const exportImages = async (canvas: CanvasLike) => {
			const file = canvas.view.file;
			if (!file) return;
			const notice = new Notice(t("paper.images.working"), 0);
			try {
				const svgs = await sheetSvgs(canvas);
				const folder = freePath(file, "", ` ${t("paper.images.folder")}`);
				await ctx.app.vault.createFolder(folder);
				let i = 0;
				for (const r of svgs) {
					const png = await svgToPng(r, 2);
					await ctx.app.vault.createBinary(normalizePath(`${folder}/${String(++i).padStart(2, "0")}.png`), await png.arrayBuffer());
				}
				new Notice(t("paper.images.done", { path: folder, count: String(i) }));
				ctx.events.emit("paper-exported", canvas, folder);
			} catch (error) {
				logError("[overpowered-canvas] paper: images", error);
				new Notice(t("paper.pdf.failed"));
			} finally {
				notice.hide();
			}
		};

		ctx.onCanvas((canvas) => {
			layers.set(canvas, new PaperLayer(ctx, canvas, () => addPage(canvas)));
			return () => {
				layers.get(canvas)?.destroy();
				layers.delete(canvas);
			};
		});
		const schedule = (canvas: CanvasLike) => layers.get(canvas)?.schedule();
		ctx.on("node-moved", (n) => schedule(n.canvas));
		ctx.on("node-added", (n) => schedule(n.canvas));
		ctx.on("node-removed", (n) => schedule(n.canvas));
		ctx.on("data-load", schedule);
		ctx.on("history-apply", schedule);
		ctx.on("readonly-change", schedule);
		const ws = ctx.app.workspace as unknown as { on(name: string, cb: (canvas: CanvasLike) => void): EventRef };
		ctx.registerEvent(ws.on("overpowered-canvas:page-shown", (canvas) => schedule(canvas)));
		ctx.registerEvent(ws.on("overpowered-canvas:branch-moved", (canvas) => schedule(canvas)));

		const command = (id: string, name: string, icon: string, can: (canvas: CanvasLike) => boolean, run: (canvas: CanvasLike) => void) =>
			ctx.addCommand({
				id,
				name,
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || !can(canvas)) return false;
					if (!checking) run(canvas);
					return true;
				},
			});
		const hasPaper = (c: CanvasLike) => !!ctx.data.root(c).get().paper;
		command("set-up", t("paper.command"), "file-text", (c) => !c.readonly, setUp);
		command("add-page", t("paper.add"), "file-plus", (c) => hasPaper(c) && !c.readonly, addPage);
		command("remove-page", t("paper.remove"), "file-minus", (c) => hasPaper(c) && !c.readonly, removePage);
		command("export-pdf", t(Platform.isDesktopApp ? "paper.pdf.command" : "paper.images.command"), "file-output", hasPaper, (c) => void exportPdf(c));
		ctx.register(() => {
			layers.forEach((l) => l.destroy());
			layers.clear();
		});
	},
});
