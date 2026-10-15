import { FuzzySuggestModal, Notice, Setting, TFile, loadPdfJs, type App } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasNodeData } from "../../data/json-canvas";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mutate, nodeType, randomId, selectedNodes } from "../shared";

interface PdfSettings {
	pageWidth: number;
	gap: number;
}

interface PdfDoc {
	numPages: number;
	getPage(n: number): Promise<PdfPage>;
	destroy(): Promise<void>;
}
interface PdfPage {
	getViewport(opts: { scale: number }): { width: number; height: number };
	render(opts: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): { promise: Promise<void> };
}

/** "#page=3", "#page=3&pinned=true" → 3 (1 when absent). */
export function pageFromSubpath(subpath: string | undefined): number {
	const m = /[#&]page=(\d+)/.exec(subpath ?? "");
	return m ? Math.max(1, Number(m[1])) : 1;
}

/** The legacy embed parameter `pinned=true` in the subpath also pins a page. */
export function subpathPinned(subpath: string | undefined): boolean {
	return /[#&]pinned=true\b/.test(subpath ?? "");
}

class PdfPicker extends FuzzySuggestModal<TFile> {
	constructor(
		app: App,
		placeholder: string,
		private readonly onPick: (file: TFile) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}
	getItems(): TFile[] {
		return this.app.vault.getFiles().filter((f) => f.extension === "pdf");
	}
	getItemText(file: TFile): string {
		return file.path;
	}
	onChooseItem(file: TFile): void {
		this.onPick(file);
	}
}

/** Placeholder child: keeps the core from creating a full PDF viewer for a pinned page card. */
function pinnedChild(node: CanvasNodeLike) {
	return { opcPinnedPdf: true, containerEl: node.contentEl, load() {}, unload() {}, loadFile: async () => {} };
}

/**
 * PDF annotation: a PDF card can be pinned to one page (stored in x-opc.pdf.pinned with the
 * standard #page=N subpath), shown as a static page with a locked aspect ratio — ideal for
 * drawing and notes around it. "Insert PDF for annotation" adds one pinned card per page.
 */
export const pdfAnnotationModule = defineModule<PdfSettings>({
	id: "pdf-annotation",
	name: "pdfAnnotation.name",
	description: "pdfAnnotation.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: { pageWidth: 600, gap: 40 },
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const docs = new Map<string, Promise<PdfDoc>>();
		const docFor = (file: TFile): Promise<PdfDoc> => {
			const key = `${file.path}@${file.stat.mtime}`;
			let p = docs.get(key);
			if (!p) {
				p = (async () => {
					const pdfjs = (await loadPdfJs()) as { getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDoc> } };
					return pdfjs.getDocument({ data: new Uint8Array(await ctx.app.vault.readBinary(file)) }).promise;
				})();
				docs.set(key, p);
			}
			return p;
		};
		ctx.register(() => {
			for (const p of docs.values()) void p.then((d) => d.destroy()).catch(() => {});
			docs.clear();
		});

		const isPinned = (node: CanvasNodeLike) => nodeType(node) === "file" && node.file?.extension === "pdf" && (!!ctx.data.node(node).get().pdf?.pinned || subpathPinned(node.subpath));

		const renders = new WeakMap<CanvasNodeLike, string>();
		const renderPage = async (node: CanvasNodeLike) => {
			const file = node.file;
			const host = node.contentEl;
			if (!(file instanceof TFile) || !host) return;
			const page = pageFromSubpath(node.subpath);
			const width = Math.round(node.width * Math.min(2, window.devicePixelRatio || 1));
			const key = `${file.path}@${file.stat.mtime}#${page}:${width}`;
			if (renders.get(node) === key && host.querySelector(".opc-pdf-page")) return;
			renders.set(node, key);
			try {
				const doc = await docFor(file);
				const p = await doc.getPage(Math.min(page, doc.numPages));
				const base = p.getViewport({ scale: 1 });
				node.aspectRatio = base.width / base.height;
				const viewport = p.getViewport({ scale: width / base.width });
				const canvasEl = createEl("canvas");
				canvasEl.className = "opc-pdf-page";
				canvasEl.width = Math.round(viewport.width);
				canvasEl.height = Math.round(viewport.height);
				const g = canvasEl.getContext("2d");
				if (!g) return;
				await p.render({ canvasContext: g, viewport }).promise;
				if (renders.get(node) !== key) return; // a newer render started
				host.querySelectorAll(".opc-pdf-page").forEach((el) => el.remove());
				host.appendChild(canvasEl);
			} catch (error) {
				console.error("[overpowered-canvas] PDF page render failed", error);
			}
		};

		const pin = (node: CanvasNodeLike) => {
			const child = node.child as { opcPinnedPdf?: boolean; unload?: () => void } | null | undefined;
			if (child && !child.opcPinnedPdf) (node as unknown as { unloadChild(): void }).unloadChild();
			if (!node.child) node.child = pinnedChild(node);
			node.nodeEl.addClass("opc-pdf-pinned");
		};
		const unpin = (node: CanvasNodeLike) => {
			if ((node.child as { opcPinnedPdf?: boolean } | null | undefined)?.opcPinnedPdf) {
				node.child = null;
				node.contentEl?.querySelectorAll(".opc-pdf-page").forEach((el) => el.remove());
				node.aspectRatio = 0;
				renders.delete(node);
				node.nodeEl.removeClass("opc-pdf-pinned");
				node.canvas.markDirty(node);
			}
		};

		// Before the first render (setData runs right after a node is created or loaded).
		ctx.on("node-set-data", (node) => (isPinned(node) ? pin(node) : unpin(node)));
		ctx.decorateNodes({
			apply: (node) => {
				if (!isPinned(node)) return unpin(node);
				pin(node);
				if (node.initialized) void renderPage(node);
			},
			clear: unpin,
		});
		// Existing pinned cards that already loaded a full viewer.
		for (const canvas of ctx.canvases()) for (const node of canvas.nodes.values()) if (isPinned(node)) {
			pin(node);
			node.canvas.markDirty(node);
		}

		const insert = (canvas: CanvasLike, file: TFile) =>
			void (async () => {
				let doc: PdfDoc;
				try {
					doc = await docFor(file);
				} catch {
					new Notice(ctx.t("pdfAnnotation.failed"));
					return;
				}
				const center = canvas.posCenter();
				const w = ctx.settings.pageWidth;
				const nodes: CanvasNodeData[] = [];
				let y = center.y;
				for (let i = 1; i <= doc.numPages; i++) {
					const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
					const h = Math.round((w * vp.height) / vp.width);
					nodes.push({ id: randomId(), type: "file", file: file.path, subpath: `#page=${i}`, x: Math.round(center.x - w / 2), y: Math.round(y), width: w, height: h, "x-opc": { pdf: { pinned: true } } });
					y += h + ctx.settings.gap;
				}
				mutate(ctx, canvas, () => {
					const created = canvas.importData({ nodes, edges: [] }, false);
					canvas.deselectAll();
					for (const n of created ?? []) canvas.select(n);
				});
				canvas.zoomToSelection();
				ctx.events.emit("pdf-inserted", canvas, file, doc.numPages);
			})();

		ctx.addCommand({
			id: "insert-pdf",
			name: ctx.t("pdfAnnotation.insert"),
			icon: "file-text",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) new PdfPicker(ctx.app, ctx.t("pdfAnnotation.pick"), (f) => insert(canvas, f)).open();
				return true;
			},
		});

		const pdfNodes = (canvas: CanvasLike) => selectedNodes(canvas).filter((n) => nodeType(n) === "file" && n.file?.extension === "pdf");
		const setPinned = (canvas: CanvasLike, nodes: CanvasNodeLike[], pinned: boolean) =>
			void (async () => {
				const pages = new Map<CanvasNodeLike, number>();
				for (const node of nodes) {
					// Pin the page the viewer is showing right now.
					const viewer = (node.child as { viewer?: Promise<{ pdfViewer?: { pdfViewer?: { currentPageNumber?: number } } }> } | null)?.viewer;
					const current = viewer ? (await viewer.catch(() => null))?.pdfViewer?.pdfViewer?.currentPageNumber : undefined;
					pages.set(node, current ?? pageFromSubpath(node.subpath));
				}
				mutate(ctx, canvas, () => {
					for (const node of nodes) {
						if (pinned && node.file) (node as unknown as { setFilePath(p: string, s: string): void }).setFilePath(node.file.path, `#page=${pages.get(node)}`);
						ctx.data.node(node).set({ pdf: pinned ? { pinned: true } : undefined });
					}
				});
			})();
		ctx.addCommand({
			id: "pin-pdf-page",
			name: ctx.t("pdfAnnotation.pin"),
			icon: "pin",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const nodes = canvas ? pdfNodes(canvas).filter((n) => !isPinned(n)) : [];
				if (!canvas || canvas.readonly || nodes.length === 0) return false;
				if (!checking) setPinned(canvas, nodes, true);
				return true;
			},
		});
		ctx.addCommand({
			id: "unpin-pdf-page",
			name: ctx.t("pdfAnnotation.unpin"),
			icon: "pin-off",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const nodes = canvas ? pdfNodes(canvas).filter((n) => isPinned(n)) : [];
				if (!canvas || canvas.readonly || nodes.length === 0) return false;
				if (!checking) setPinned(canvas, nodes, false);
				return true;
			},
		});
		ctx.onNodeMenu((menu, node) => {
			if (node.canvas.readonly || nodeType(node) !== "file" || node.file?.extension !== "pdf") return;
			const pinned = isPinned(node);
			menu.addItem((item) =>
				item
					.setSection("canvas")
					.setTitle(ctx.t(pinned ? "pdfAnnotation.unpin" : "pdfAnnotation.pin"))
					.setIcon(pinned ? "pin-off" : "pin")
					.onClick(() => setPinned(node.canvas, [node], !pinned)),
			);
		});
	},

	renderSettings(el, ctx: ModuleContext<PdfSettings>) {
		new Setting(el)
			.setName(ctx.t("pdfAnnotation.width.name"))
			.addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(ctx.settings.pageWidth)).onChange((v) => Number(v) >= 100 && ctx.updateSettings({ pageWidth: Number(v) }));
			});
	},
});
