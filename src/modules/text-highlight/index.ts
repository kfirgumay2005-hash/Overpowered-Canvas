import { Notice, Setting, setIcon, setTooltip } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { capturePointer, claimTool, isTextBox, mutate, nodeType, releaseTool } from "../shared";
import { locate, rehighlight, toWords, unhighlight, withoutHighlights } from "./source";
import { logWarn } from "../../core/log";

interface HighlightSettings {
	/** Highlight color: "" for the theme's own highlight, else a CSS color. */
	color: string;
	/** Extra colors of the user's own, shown after the built-in ones. */
	customColors: string[];
}

type Ctx = ModuleContext<HighlightSettings>;

/** "" = the theme's highlight (==text==). */
const COLORS = ["", "#ffd43b", "#8ce99a", "#74c0fc", "#faa2c1", "#ffa94d"];
const HEX = /^#[0-9a-f]{6}$/i;
/** Most extra colors the bar shows. */
const MAX_CUSTOM = 12;

/** Marks drawn in a chosen color are this opaque, so the text stays readable. */
const ALPHA = "80";
/** The theme's highlight color (some themes leave it unset). */
const THEME_HIGHLIGHT = "var(--text-highlight-bg, rgba(255, 208, 0, 0.4))";

/** A pen was used in this window: from then on, fingers move the board. */
let penSeen = false;

interface Caret {
	node: Node;
	offset: number;
}

/**
 * Highlight words in a card without editing it: swipe (or tap a word) with the pen or mouse and
 * the Markdown of the card gets a highlight around those words. The eraser removes highlights.
 */
class HighlightSession {
	private readonly overlay: HTMLElement;
	private readonly bar: HTMLElement;
	private readonly marks: HTMLElement;
	private erase = false;
	private gesture: { pointerId: number; node: CanvasNodeLike; start: Caret; end: Caret; restore: () => void } | null = null;
	private penUntil = 0;

	constructor(
		private readonly ctx: Ctx,
		private readonly canvas: CanvasLike,
		private readonly onEnd: () => void,
	) {
		const wrapper = canvas.wrapperEl;
		this.overlay = wrapper.createDiv({ cls: "opc-hl-overlay" });
		this.marks = wrapper.createDiv({ cls: "opc-hl-marks" });
		this.bar = wrapper.createDiv({ cls: "opc-hl-bar" });
		this.renderBar();
		this.overlay.addEventListener("pointerdown", this.onDown);
		this.overlay.addEventListener("pointermove", this.onMove);
		this.overlay.addEventListener("pointerup", this.onUp);
		this.overlay.addEventListener("pointercancel", this.onCancel);
		this.overlay.addEventListener("lostpointercapture", this.onLost);
		wrapper.win.addEventListener("keydown", this.onKey, true);
		wrapper.addClass("opc-highlighting");
	}

	destroy(): void {
		this.gesture?.restore();
		this.gesture = null;
		this.canvas.wrapperEl.win.removeEventListener("keydown", this.onKey, true);
		this.overlay.remove();
		this.marks.remove();
		this.bar.remove();
		this.canvas.wrapperEl.removeClass("opc-highlighting");
	}

	private renderBar(): void {
		const t = this.ctx.t;
		this.bar.empty();
		for (const color of [...COLORS, ...this.ctx.settings.customColors.filter((c) => !COLORS.includes(c))]) {
			const b = this.bar.createEl("button", { cls: "opc-hl-swatch clickable-icon" });
			if (color) b.style.setProperty("--opc-hl-color", color);
			else b.addClass("is-theme");
			b.toggleClass("is-active", !this.erase && this.ctx.settings.color === color);
			setTooltip(b, color ? color : t("textHighlight.theme"));
			b.addEventListener("click", () => {
				this.erase = false;
				void this.ctx.updateSettings({ color }).then(() => this.renderBar());
			});
		}
		const eraser = this.bar.createEl("button", { cls: "opc-hl-eraser clickable-icon" });
		setIcon(eraser, "eraser");
		setTooltip(eraser, t("textHighlight.erase"));
		eraser.toggleClass("is-active", this.erase);
		eraser.addEventListener("click", () => {
			this.erase = !this.erase;
			this.renderBar();
		});
		const close = this.bar.createEl("button", { cls: "opc-hl-close clickable-icon" });
		setIcon(close, "x");
		setTooltip(close, t("textHighlight.close"));
		close.addEventListener("click", () => this.onEnd());
	}

	private onKey = (e: KeyboardEvent) => {
		if (e.key !== "Escape") return;
		e.preventDefault();
		e.stopPropagation();
		this.onEnd();
	};

	/** The text card under a screen point (not one being edited). */
	private cardAt(x: number, y: number): CanvasNodeLike | null {
		const el = this.probe(() => this.canvas.wrapperEl.doc.elementFromPoint(x, y));
		const nodeEl = el?.closest(".canvas-node");
		if (!nodeEl) return null;
		for (const n of this.canvas.nodes.values()) if (n.nodeEl === nodeEl) return nodeType(n) === "text" && isTextBox(this.ctx, n) && !n.isEditing && !this.ctx.data.node(n).get().locked ? n : null;
		return null;
	}

	/** Hit-tests under the overlay. */
	private probe<T>(fn: () => T): T {
		this.overlay.addClass("is-probing");
		try {
			return fn();
		} finally {
			this.overlay.removeClass("is-probing");
		}
	}

	/** Makes a card's rendered text hit-testable for the gesture (the core covers and locks it). */
	private open(node: CanvasNodeLike): () => void {
		node.nodeEl.addClass("opc-hl-open");
		return () => node.nodeEl.removeClass("opc-hl-open");
	}

	private caretAt(node: CanvasNodeLike, x: number, y: number): Caret | null {
		const doc = this.canvas.wrapperEl.doc;
		const caret = this.probe((): Caret | null => {
			if (typeof doc.caretPositionFromPoint === "function") {
				const p = doc.caretPositionFromPoint(x, y);
				return p ? { node: p.offsetNode, offset: p.offset } : null;
			}
			// Older WebKit (tablets) only has the earlier, non-standard call.
			const legacy = doc as unknown as { caretRangeFromPoint?(x: number, y: number): Range | null };
			const r = legacy.caretRangeFromPoint?.(x, y);
			return r ? { node: r.startContainer, offset: r.startOffset } : null;
		});
		const root = this.root(node);
		return caret && root?.contains(caret.node) ? caret : null;
	}

	private root(node: CanvasNodeLike): HTMLElement | null {
		return node.contentEl?.querySelector<HTMLElement>(".markdown-preview-sizer") ?? node.contentEl?.querySelector<HTMLElement>(".markdown-preview-view") ?? null;
	}

	private onDown = (e: PointerEvent) => {
		if (e.pointerType === "pen") {
			penSeen = true;
			this.penUntil = Date.now() + 800;
		}
		if (e.pointerType === "touch") {
			if (Date.now() < this.penUntil) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			// Once a pen has been used, fingers move and zoom the board.
			if (penSeen) return;
		}
		if (e.pointerType === "mouse" && e.button !== 0) return;
		// A pen or mouse can't press twice: the last gesture lost its release (tablets), drop it.
		if (this.gesture && e.pointerType !== "touch") this.dropGesture();
		if (this.gesture || this.canvas.readonly) return;
		const node = this.cardAt(e.clientX, e.clientY);
		if (!node) return; // empty space: the board pans as usual
		e.preventDefault();
		e.stopPropagation();
		const restore = this.open(node);
		const start = this.caretAt(node, e.clientX, e.clientY);
		if (!start) {
			restore();
			return;
		}
		capturePointer(this.overlay, e.pointerId);
		this.gesture = { pointerId: e.pointerId, node, start, end: start, restore };
		this.preview();
	};

	private onMove = (e: PointerEvent) => {
		const g = this.gesture;
		if (!g || e.pointerId !== g.pointerId) return;
		e.preventDefault();
		const end = this.caretAt(g.node, e.clientX, e.clientY);
		if (end) g.end = end;
		this.preview();
	};

	private onUp = (e: PointerEvent) => {
		const g = this.gesture;
		if (!g || e.pointerId !== g.pointerId) return;
		this.gesture = null;
		this.marks.empty();
		try {
			this.apply(g.node, g.start, g.end);
		} finally {
			g.restore();
		}
	};

	private onCancel = (e: PointerEvent) => {
		if (this.gesture && e.pointerId === this.gesture.pointerId) this.dropGesture();
	};

	/** Capture lost without a release: apply what was swiped, as a release there would. */
	private onLost = (e: PointerEvent) => {
		if (this.gesture && e.pointerId === this.gesture.pointerId) this.onUp(e);
	};

	private dropGesture(): void {
		const g = this.gesture;
		if (!g) return;
		this.gesture = null;
		this.marks.empty();
		g.restore();
	}

	/** Rendered-text offsets of the gesture, widened to whole words. */
	private span(node: CanvasNodeLike, a: Caret, b: Caret): { rendered: string; from: number; to: number } | null {
		const root = this.root(node);
		if (!root) return null;
		const doc = root.doc;
		const offset = (c: Caret) => {
			const r = doc.createRange();
			r.setStart(root, 0);
			r.setEnd(c.node, c.offset);
			return r.toString().length;
		};
		const all = doc.createRange();
		all.selectNodeContents(root);
		const rendered = all.toString();
		const [from, to] = toWords(rendered, offset(a), offset(b));
		return from < to ? { rendered, from, to } : null;
	}

	/** Light boxes over the words that will be highlighted. */
	private preview(): void {
		this.marks.empty();
		const g = this.gesture;
		if (!g) return;
		const s = this.span(g.node, g.start, g.end);
		const root = this.root(g.node);
		if (!s || !root) return;
		const range = rangeOf(root, s.from, s.to);
		if (!range) return;
		const host = this.canvas.wrapperEl.getBoundingClientRect();
		const color = this.erase ? "var(--text-faint)" : this.ctx.settings.color || THEME_HIGHLIGHT;
		for (const r of range.getClientRects()) {
			const m = this.marks.createDiv({ cls: "opc-hl-mark" });
			m.setCssStyles({ left: `${r.left - host.left}px`, top: `${r.top - host.top}px`, width: `${r.width}px`, height: `${r.height}px`, background: color });
		}
	}

	private apply(node: CanvasNodeLike, a: Caret, b: Caret): void {
		const s = this.span(node, a, b);
		if (!s) return;
		const data = node.getData();
		const source = typeof data.text === "string" ? data.text : "";
		const range = locate(s.rendered, source, s.from, s.to);
		if (!range) {
			new Notice(this.ctx.t("textHighlight.notFound"));
			return;
		}
		const color = this.ctx.settings.color;
		const next = this.erase ? unhighlight(source, range[0], range[1]) : rehighlight(source, range[0], range[1], { color: color ? color + ALPHA : "" });
		if (next === source) return;
		// Only highlight marks may change: anything else means the words were placed wrong.
		if (withoutHighlights(next) !== withoutHighlights(source)) {
			logWarn("[overpowered-canvas] text-highlight: skipped an edit that would change the text", { picked: s.rendered.slice(s.from, s.to), range });
			new Notice(this.ctx.t("textHighlight.notFound"));
			return;
		}
		mutate(this.ctx, this.canvas, () => node.setData({ ...node.getData(), text: next }));
		this.ctx.events.emit("text-highlighted", this.canvas, node);
	}
}

/** A DOM range over rendered characters [from, to) of `root`. */
function rangeOf(root: HTMLElement, from: number, to: number): Range | null {
	const doc = root.doc;
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const range = doc.createRange();
	let seen = 0;
	let started = false;
	for (let n = walker.nextNode(); n; n = walker.nextNode()) {
		const len = n.textContent?.length ?? 0;
		if (!started && from <= seen + len) {
			range.setStart(n, from - seen);
			started = true;
		}
		if (started && to <= seen + len) {
			range.setEnd(n, to - seen);
			return range;
		}
		seen += len;
	}
	return null;
}

/** Highlight words in cards without editing them: card bar button, command and H. */
export const textHighlightModule = defineModule<HighlightSettings>({
	id: "text-highlight",
	name: "textHighlight.name",
	description: "textHighlight.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: { color: "", customColors: [] },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		const custom = Array.isArray(s.customColors) ? s.customColors.filter((c): c is string => typeof c === "string" && HEX.test(c)).map((c) => c.toLowerCase()) : [];
		return {
			color: typeof s.color === "string" && (s.color === "" || HEX.test(s.color)) ? s.color.toLowerCase() : defaults.color,
			customColors: [...new Set(custom)].slice(0, MAX_CUSTOM),
		};
	},

	enable(ctx) {
		const sessions = new Map<CanvasLike, HighlightSession>();
		const refresh = (canvas: CanvasLike) => canvas.cardMenuEl.querySelector(".opc-card-text-highlight")?.toggleClass("is-active", sessions.has(canvas));
		const stop = (canvas: CanvasLike) => {
			releaseTool(canvas, "text-highlight");
			sessions.get(canvas)?.destroy();
			sessions.delete(canvas);
			refresh(canvas);
		};
		const toggle = (canvas: CanvasLike) => {
			if (sessions.has(canvas)) return stop(canvas);
			if (canvas.readonly) return;
			claimTool(canvas, "text-highlight", () => stop(canvas));
			canvas.deselectAll();
			sessions.set(canvas, new HighlightSession(ctx, canvas, () => stop(canvas)));
			refresh(canvas);
		};
		ctx.register(() => {
			for (const c of [...sessions.keys()]) stop(c);
		});
		ctx.onCanvas((canvas) => () => stop(canvas));
		ctx.on("readonly-change", (canvas) => canvas.readonly && stop(canvas));

		ctx.addCardMenuButton({
			id: "text-highlight",
			icon: "highlighter",
			tooltip: () => ctx.t("textHighlight.button"),
			order: 121,
			onClick: (canvas) => toggle(canvas),
		});
		ctx.addCommand({
			id: "toggle",
			name: ctx.t("textHighlight.button"),
			icon: "highlighter",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) toggle(canvas);
				return true;
			},
		});
		ctx.addCanvasKey({ modifiers: [], key: "H", handle: (canvas) => (canvas.readonly ? false : (toggle(canvas), true)) });
	},

	renderSettings(el, ctx: ModuleContext<HighlightSettings>) {
		const box = el.createDiv();
		const render = () => {
			box.empty();
			const colors = ctx.settings.customColors;
			const save = (next: string[]) => void ctx.updateSettings({ customColors: next }).then(render);
			new Setting(box)
				.setName(ctx.t("textHighlight.colors.name"))
				.setDesc(ctx.t("textHighlight.colors.desc"))
				.addButton((b) =>
					b
						.setButtonText(ctx.t("textHighlight.colors.add"))
						.setDisabled(colors.length >= MAX_CUSTOM)
						.onClick(() => save([...colors, "#b197fc"])),
				);
			colors.forEach((color, i) => {
				new Setting(box)
					.setName(ctx.t("textHighlight.colors.item", { n: String(i + 1) }))
					.addColorPicker((c) =>
						c.setValue(color).onChange((v) => {
							const next = [...ctx.settings.customColors];
							next[i] = v.toLowerCase();
							void ctx.updateSettings({ customColors: next });
						}),
					)
					.addExtraButton((b) =>
						b
							.setIcon("trash-2")
							.setTooltip(ctx.t("textHighlight.colors.remove"))
							.onClick(() => save(ctx.settings.customColors.filter((_, j) => j !== i))),
					);
			});
		};
		render();
	},
});
