/**
 * Handwriting tools beyond drawing:
 * - Handwriting → text: a writing box where the operating system's own handwriting recognition
 *   (Scribble on iPad, the pen input of Windows) turns what the pen writes into text, inserted as
 *   a card. Where the browser offers handwriting recognition (the Handwriting Recognition API),
 *   drawings on the board can be read into text too.
 * - Drawing embeds: a drawing put into a Markdown note as an SVG file that is written again
 *   whenever the drawing changes on the board.
 */
import { Modal, Notice, normalizePath, type App } from "obsidian";
import type { Stroke } from "../../data/schema";
import type { Translate } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { logError } from "../../core/log";
import { mutate, nodeType, randomId, selectedNodes } from "../shared";
import type { ModuleContext } from "../../core/module";
import { strokeD } from "./render";
import { unpack } from "../../geometry/ink";
import { TUTORIAL_KEY } from "../../tutorials/runner";

type Ctx = ModuleContext<object>;

const isInk = (ctx: Ctx, n: CanvasNodeLike) => nodeType(n) === "text" && ctx.data.node(n).get().kind === "ink";

/** The drawings meant by a selection: drawings selected, and drawings stuck to selected cards. */
export function drawingsOf(ctx: Ctx, canvas: CanvasLike, picked: CanvasNodeLike[]): CanvasNodeLike[] {
	const out = new Set<CanvasNodeLike>();
	const cards = new Set(picked.map((n) => n.id));
	for (const n of picked) if (isInk(ctx, n)) out.add(n);
	for (const n of canvas.nodes.values()) {
		if (!isInk(ctx, n)) continue;
		const anchor = ctx.data.node(n).get().anchor;
		if (anchor && cards.has(anchor)) out.add(n);
	}
	return [...out];
}

// ---------- handwriting → text ----------

/** A writing box: the pen writes, the system turns it into text. */
class HandwriteModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly onInsert: (text: string) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { t } = this;
		this.modalEl.addClass("opc-handwrite-modal");
		this.setTitle(t("drawing.handwrite.title"));
		this.contentEl.createEl("p", { cls: "setting-item-description", text: t("drawing.handwrite.help") });
		const area = this.contentEl.createEl("textarea", { cls: "opc-handwrite-area", attr: { dir: "auto", placeholder: t("drawing.handwrite.placeholder"), "aria-label": t("drawing.handwrite.title") } });
		const row = this.contentEl.createDiv({ cls: "modal-button-container" });
		const cancel = row.createEl("button", { text: t("common.cancel") });
		const insert = row.createEl("button", { cls: "mod-cta", text: t("drawing.handwrite.insert") });
		cancel.addEventListener("click", () => this.close());
		const done = () => {
			const text = area.value.trim();
			if (text) this.onInsert(text);
			this.close();
		};
		insert.addEventListener("click", done);
		area.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				done();
			}
		});
		window.setTimeout(() => area.focus(), 50);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/** Lines of text → a card size that shows them (the board's default width at least). */
function sizeFor(canvas: CanvasLike, text: string): { width: number; height: number } {
	const base = canvas.config.defaultTextNodeDimensions;
	const lines = text.split("\n");
	const longest = Math.max(...lines.map((l) => l.length));
	const width = Math.max(base.width, Math.min(520, Math.round(longest * 9 + 40)));
	const perLine = Math.max(1, Math.floor((width - 40) / 9));
	const rows = lines.reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
	return { width, height: Math.max(base.height, rows * 26 + 34) };
}

/** Inserts text as a card centered on `at` (one undo step); returns it. */
export function insertTextCard(ctx: Ctx, canvas: CanvasLike, text: string, at: { x: number; y: number }): CanvasNodeLike | null {
	let created: CanvasNodeLike | null = null;
	const size = sizeFor(canvas, text);
	mutate(ctx, canvas, () => {
		created = canvas.createTextNode({ pos: { x: Math.round(at.x - size.width / 2), y: Math.round(at.y - size.height / 2) }, size, text, save: false, focus: false });
	});
	return created;
}

// ---------- recognition (where the browser offers it) ----------

interface HwPoint {
	x: number;
	y: number;
	t: number;
}
interface HwStroke {
	addPoint(p: HwPoint): void;
}
interface HwDrawing {
	addStroke(s: HwStroke): void;
	getPrediction(): Promise<{ text: string }[]>;
	clear?(): void;
}
interface HwRecognizer {
	startDrawing(hints?: Record<string, unknown>): HwDrawing;
	finish?(): void;
}
type HwNavigator = Navigator & { createHandwritingRecognizer?(c: { languages: string[] }): Promise<HwRecognizer> };
type HwWindow = Window & { HandwritingStroke?: new () => HwStroke };

/** Whether this browser can read handwriting into text (the Handwriting Recognition API). */
export function canRecognize(win: Window): boolean {
	return typeof (win.navigator as HwNavigator).createHandwritingRecognizer === "function" && typeof (win as HwWindow).HandwritingStroke === "function";
}

/** Strokes of drawings in reading order (top to bottom, then along the line), in board coordinates. */
export function strokesForReading(drawings: { x: number; y: number; strokes: Stroke[] }[], rtl: boolean): { x: number; y: number }[][] {
	const all = drawings.flatMap((d) => d.strokes.map((s) => unpack(s.pts).map((p) => ({ x: d.x + p.x, y: d.y + p.y }))));
	const lineHeight = 40;
	return all
		.filter((pts) => pts.length > 0)
		.sort((a, b) => {
			const ay = Math.round(Math.min(...a.map((p) => p.y)) / lineHeight);
			const by = Math.round(Math.min(...b.map((p) => p.y)) / lineHeight);
			if (ay !== by) return ay - by;
			const ax = Math.min(...a.map((p) => p.x));
			const bx = Math.min(...b.map((p) => p.x));
			return rtl ? bx - ax : ax - bx;
		});
}

/** Reads drawings into text with the browser's handwriting recognition. */
export async function recognize(win: Window, strokes: { x: number; y: number }[][], language: string): Promise<string> {
	const nav = win.navigator as HwNavigator;
	const Ctor = (win as HwWindow).HandwritingStroke;
	if (!nav.createHandwritingRecognizer || !Ctor) throw new Error("no handwriting recognition");
	const recognizer = await nav.createHandwritingRecognizer({ languages: [language] });
	try {
		const drawing = recognizer.startDrawing({ recognitionType: "text", inputType: "stylus" });
		let t = 0;
		for (const pts of strokes) {
			const stroke = new Ctor();
			for (const p of pts) stroke.addPoint({ x: p.x, y: p.y, t: (t += 8) });
			drawing.addStroke(stroke);
			t += 120;
		}
		const [best] = await drawing.getPrediction();
		return best?.text ?? "";
	} finally {
		recognizer.finish?.();
	}
}

// ---------- drawing embeds ----------

/** An SVG of drawings (their strokes, at board size), with what made it written inside. */
export function drawingSvg(drawings: { id: string; x: number; y: number; width: number; height: number; strokes: Stroke[] }[], source: string): string {
	const pad = 8;
	const minX = Math.min(...drawings.map((d) => d.x)) - pad;
	const minY = Math.min(...drawings.map((d) => d.y)) - pad;
	const maxX = Math.max(...drawings.map((d) => d.x + d.width)) + pad;
	const maxY = Math.max(...drawings.map((d) => d.y + d.height)) + pad;
	const w = Math.max(1, Math.ceil(maxX - minX));
	const h = Math.max(1, Math.ceil(maxY - minY));
	const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	const groups = drawings
		.map((d) => {
			const paths = d.strokes
				.map((s) => {
					const opacity = s.opacity ?? (s.tool === "highlighter" ? 0.35 : s.tool === "pencil" ? 0.85 : 1);
					return `<path d="${esc(strokeD(s))}" fill="${esc(s.color)}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ""}/>`;
				})
				.join("");
			return `<g transform="translate(${Math.round((d.x - minX) * 100) / 100} ${Math.round((d.y - minY) * 100) / 100})">${paths}</g>`;
		})
		.join("\n");
	// The default ink color is dark: light on a dark background, like on the board.
	const style = `<style>@media (prefers-color-scheme: dark) { path[fill="#1e1e1e"] { fill: #e8e8e8; } }</style>`;
	const meta = `<metadata>${esc(JSON.stringify({ "overpowered-canvas": { source, drawings: drawings.map((d) => d.id) } }))}</metadata>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${meta}\n${style}\n${groups}\n</svg>\n`;
}

/** File name part from a canvas name: what file systems accept. */
function safeName(name: string): string {
	return name.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Drawing";
}

export function enableInkTools(ctx: Ctx, lastPress: (canvas: CanvasLike) => { x: number; y: number } | null, lassoed: (canvas: CanvasLike) => CanvasNodeLike[]) {
	const t = ctx.t;
	const app = ctx.app;

	const where = (canvas: CanvasLike) => lastPress(canvas) ?? { x: canvas.x, y: canvas.y };

	const handwrite = (canvas: CanvasLike) => {
		if (canvas.readonly) return;
		const at = where(canvas);
		new HandwriteModal(app, t, (text) => {
			const card = insertTextCard(ctx, canvas, text, at);
			if (card) ctx.events.emit("handwriting-to-text", canvas, card);
		}).open();
	};

	/** The drawings meant now: the lasso's in drawing mode, else the selection's. */
	const meant = (canvas: CanvasLike) => {
		const lasso = lassoed(canvas);
		return lasso.length ? lasso : drawingsOf(ctx, canvas, selectedNodes(canvas));
	};

	const readDrawings = async (canvas: CanvasLike) => {
		const drawings = meant(canvas);
		if (!drawings.length) return new Notice(t("drawing.embed.nothing"));
		const win = canvas.wrapperEl.win;
		try {
			const strokes = strokesForReading(
				drawings.map((d) => ({ x: d.x, y: d.y, strokes: ctx.data.node(d).get().strokes ?? [] })),
				getComputedStyle(canvas.wrapperEl).direction === "rtl",
			);
			const text = await recognize(win, strokes, win.navigator.language || "en");
			if (!text.trim()) return new Notice(t("drawing.recognize.empty"));
			const box = drawings.reduce((b, d) => ({ minX: Math.min(b.minX, d.x), minY: Math.min(b.minY, d.y), maxX: Math.max(b.maxX, d.x + d.width), maxY: Math.max(b.maxY, d.y + d.height) }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
			const card = insertTextCard(ctx, canvas, text, { x: (box.minX + box.maxX) / 2, y: box.maxY + 80 });
			if (card) ctx.events.emit("handwriting-to-text", canvas, card);
		} catch (error) {
			logError("[overpowered-canvas] drawing: handwriting recognition failed", error);
			new Notice(t("drawing.recognize.failed"));
		}
	};

	// ---- embeds ----

	/** Embed file → the drawings it shows, for each canvas (stored in the canvas: OpcRoot.inkEmbeds). */
	const embedsOf = (canvas: CanvasLike) => ctx.data.root(canvas).get().inkEmbeds ?? {};

	const writeEmbed = async (canvas: CanvasLike, path: string, ids: string[]) => {
		const drawings = ids
			.map((id) => canvas.nodes.get(id))
			.filter((n): n is CanvasNodeLike => !!n && isInk(ctx, n))
			.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, strokes: ctx.data.node(n).get().strokes ?? [] }))
			.filter((d) => d.strokes.length > 0);
		if (!drawings.length) return false;
		const svg = drawingSvg(drawings, canvas.view.file?.path ?? "");
		const file = app.vault.getFileByPath(path);
		if (file) {
			if ((await app.vault.read(file)) !== svg) await app.vault.modify(file, svg);
		} else {
			const folder = path.slice(0, path.lastIndexOf("/"));
			if (folder && !app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder).catch(() => app.vault.adapter.mkdir(folder));
			await app.vault.create(path, svg);
		}
		return true;
	};

	const embed = async (canvas: CanvasLike) => {
		const drawings = meant(canvas);
		if (!drawings.length) return new Notice(t("drawing.embed.nothing"));
		// A tutorial's practice board keeps its files in its own folder (cleared when it closes).
		const practice = canvas.data[TUTORIAL_KEY] ? canvas.view.file?.parent?.path : undefined;
		const base = practice ?? ctx.filesFolder();
		const name = `${safeName(canvas.view.file?.basename ?? "Drawing")} ${randomId(6)}.svg`;
		const path = normalizePath(`${base ? `${base}/` : ""}${practice ? "" : "Drawings/"}${name}`);
		const ids = drawings.map((d) => d.id);
		try {
			if (!(await writeEmbed(canvas, path, ids))) return new Notice(t("drawing.embed.nothing"));
			mutate(ctx, canvas, () => ctx.data.root(canvas).set({ inkEmbeds: { ...embedsOf(canvas), [path]: ids } }));
			const link = `![[${path}]]`;
			await navigator.clipboard.writeText(link).catch(() => undefined);
			new Notice(t("drawing.embed.done", { link }));
			ctx.events.emit("drawing-embedded", canvas, path);
		} catch (error) {
			logError("[overpowered-canvas] drawing: embedding failed", error);
			new Notice(t("drawing.embed.failed"));
		}
	};

	// A drawing that changes writes its embeds again (after the pen is quiet).
	const pending = new Map<CanvasLike, { timer: number; paths: Set<string> }>();
	const changed = (node: CanvasNodeLike) => {
		const canvas = node.canvas;
		if (!isInk(ctx, node)) return;
		const embeds = embedsOf(canvas);
		const paths = Object.entries(embeds)
			.filter(([, ids]) => ids.includes(node.id))
			.map(([path]) => path);
		if (!paths.length) return;
		const win = canvas.wrapperEl.win;
		const entry = pending.get(canvas) ?? { timer: 0, paths: new Set<string>() };
		for (const p of paths) entry.paths.add(p);
		win.clearTimeout(entry.timer);
		entry.timer = win.setTimeout(() => {
			pending.delete(canvas);
			const now = embedsOf(canvas);
			for (const p of entry.paths) {
				const ids = now[p];
				// The embed file was deleted by hand: nothing to keep up to date.
				if (ids && app.vault.getFileByPath(p)) void writeEmbed(canvas, p, ids).catch((e) => logError("[overpowered-canvas] drawing: updating an embed failed", e));
			}
		}, 1000);
		pending.set(canvas, entry);
	};
	ctx.on("node-extra-change", changed);
	ctx.on("node-moved", changed);
	ctx.on("node-removed", changed);
	ctx.register(() => {
		for (const [canvas, entry] of pending) canvas.wrapperEl.win.clearTimeout(entry.timer);
		pending.clear();
	});

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
	command("handwrite-text", t("drawing.handwrite.command"), "text-cursor-input", (c) => !c.readonly, handwrite);
	command("embed-drawing", t("drawing.embed.command"), "image-plus", (c) => meant(c).length > 0, (c) => void embed(c));
	command("recognize-drawing", t("drawing.recognize.command"), "scan-text", (c) => !c.readonly && canRecognize(c.wrapperEl.win) && meant(c).length > 0, (c) => void readDrawings(c));
	// The same from a drawing's context menu (touch: long press).
	ctx.onNodeMenu((menu, node) => {
		if (!isInk(ctx, node)) return;
		const canvas = node.canvas;
		menu.addItem((i) => i.setSection("opc-ink").setTitle(t("drawing.embed.command")).setIcon("image-plus").onClick(() => {
			if (!canvas.selection.has(node)) canvas.selectOnly(node);
			void embed(canvas);
		}));
		if (!canvas.readonly && canRecognize(canvas.wrapperEl.win))
			menu.addItem((i) => i.setSection("opc-ink").setTitle(t("drawing.recognize.command")).setIcon("scan-text").onClick(() => {
				if (!canvas.selection.has(node)) canvas.selectOnly(node);
				void readDrawings(canvas);
			}));
	});

	return { handwrite, embed };
}
