import { Notice, Setting, setIcon, setTooltip } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { capturePointer, claimTool, isTextBox, mutate, nodeType, releaseTool } from "../shared";
import { marksHost, type MarkMode, type MarkSurface, type MarkTarget } from "./api";
import { locate, recolor, rehighlight, toWords, uncolor, unhighlight, withoutColors, withoutHighlights } from "./source";
import { logWarn } from "../../core/log";

interface HighlightSettings {
	/** Highlight color: "" for the theme's own highlight, else a CSS color. */
	color: string;
	/** The text color tool: the color words get. */
	textColor: string;
	/** Extra colors of the user's own, shown after the built-in ones (both tools). */
	customColors: string[];
}

type Ctx = ModuleContext<HighlightSettings>;

/** "" = the theme's highlight (==text==). */
const COLORS = ["", "#ffd43b", "#8ce99a", "#74c0fc", "#faa2c1", "#ffa94d"];
/** Text colors that read well on light and dark themes alike. */
const TEXT_COLORS = ["#e03131", "#f08c00", "#2f9e44", "#1971c2", "#7048e8", "#c2255c"];
const HEX = /^#[0-9a-f]{6}$/i;
/** Most extra colors the bar shows. */
const MAX_CUSTOM = 12;
/** What "Add a color" starts with: the first of these not in use yet. */
const NEW_COLORS = ["#b197fc", "#ff8787", "#63e6be", "#ffe066", "#4dabf7", "#f783ac", "#c0eb75", "#ffc078", "#91a7ff", "#e599f7", "#66d9e8", "#ced4da"];

/** A color for a new slot that differs from the built-in and existing ones. */
export function nextCustomColor(existing: readonly string[]): string {
	const used = new Set([...COLORS, ...TEXT_COLORS, ...existing].map((c) => c.toLowerCase()));
	const free = NEW_COLORS.find((c) => !used.has(c));
	if (free) return free;
	// All presets taken: step the hue until a color is free.
	for (let hue = 0; ; hue += 17) {
		const c = hslHex(hue % 360, 70, 70);
		if (!used.has(c)) return c;
	}
}

function hslHex(h: number, s: number, l: number): string {
	const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
		return Math.round(v * 255).toString(16).padStart(2, "0");
	};
	return `#${f(0)}${f(8)}${f(4)}`;
}

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

/** The board as a surface to mark cards on. */
function boardSurface(canvas: CanvasLike): MarkSurface {
	return {
		host: canvas.wrapperEl,
		cardAt: (x, y) => {
			const nodeEl = canvas.wrapperEl.doc.elementFromPoint(x, y)?.closest(".canvas-node");
			if (!nodeEl) return null;
			for (const node of canvas.nodes.values()) {
				if (node.nodeEl !== nodeEl) continue;
				const root = node.contentEl?.querySelector<HTMLElement>(".markdown-preview-sizer") ?? node.contentEl?.querySelector<HTMLElement>(".markdown-preview-view");
				if (!root) return null;
				// The core covers a card's text and keeps it from being selected: lifted for the gesture.
				const open = () => {
					node.nodeEl.addClass("opc-hl-open");
					return () => node.nodeEl.removeClass("opc-hl-open");
				};
				return { node, root, open };
			}
			return null;
		},
	};
}

/**
 * Mark words in a card without editing it: swipe (or tap a word) with the pen or mouse and the
 * Markdown of the card gets a highlight around those words, or their text a color. The eraser
 * takes marks of the tool's kind off. Works on the board or on another view of its cards.
 */
class HighlightSession {
	private readonly overlay: HTMLElement;
	private readonly bar: HTMLElement;
	private readonly marks: HTMLElement;
	private erase = false;
	private gesture: { pointerId: number; target: MarkTarget; start: Caret; end: Caret; restore: () => void } | null = null;
	private penUntil = 0;

	constructor(
		private readonly ctx: Ctx,
		private readonly canvas: CanvasLike,
		private readonly surface: MarkSurface,
		public mode: MarkMode,
		private readonly onEnd: () => void,
		private readonly onMode: () => void,
	) {
		const host = surface.host;
		this.overlay = host.createDiv({ cls: "opc-hl-overlay" });
		this.marks = host.createDiv({ cls: "opc-hl-marks" });
		this.bar = host.createDiv({ cls: "opc-hl-bar" });
		this.bar.addEventListener("pointerdown", (e) => e.stopPropagation());
		this.renderBar();
		this.overlay.addEventListener("pointerdown", this.onDown);
		this.overlay.addEventListener("pointermove", this.onMove);
		this.overlay.addEventListener("pointerup", this.onUp);
		this.overlay.addEventListener("pointercancel", this.onCancel);
		this.overlay.addEventListener("lostpointercapture", this.onLost);
		host.win.addEventListener("keydown", this.onKey, true);
		host.addClass("opc-highlighting");
	}

	destroy(): void {
		this.gesture?.restore();
		this.gesture = null;
		this.surface.host.win.removeEventListener("keydown", this.onKey, true);
		this.overlay.remove();
		this.marks.remove();
		this.bar.remove();
		this.surface.host.removeClass("opc-highlighting");
	}

	setMode(mode: MarkMode): void {
		if (mode === this.mode) return;
		this.dropGesture();
		this.mode = mode;
		this.erase = false;
		this.renderBar();
		this.onMode();
	}

	private renderBar(): void {
		const t = this.ctx.t;
		const coloring = this.mode === "color";
		this.bar.empty();
		this.bar.toggleClass("is-color", coloring);
		// Switch between the two tools without leaving.
		const other = this.bar.createEl("button", { cls: "opc-hl-mode clickable-icon" });
		setIcon(other, coloring ? "highlighter" : "baseline");
		setTooltip(other, coloring ? t("textHighlight.button") : t("textHighlight.color.button"));
		other.addEventListener("click", () => this.setMode(coloring ? "highlight" : "color"));
		const presets = coloring ? TEXT_COLORS : COLORS;
		const current = coloring ? this.ctx.settings.textColor : this.ctx.settings.color;
		for (const c of [...new Set([...presets, ...this.ctx.settings.customColors])]) {
			const b = this.bar.createEl("button", { cls: "opc-hl-swatch clickable-icon" });
			if (c) b.style.setProperty("--opc-hl-color", c);
			else b.addClass("is-theme");
			if (coloring) b.setText("A");
			b.toggleClass("is-active", !this.erase && current === c);
			setTooltip(b, c ? c : t("textHighlight.theme"));
			b.addEventListener("click", () => {
				this.erase = false;
				void this.ctx.updateSettings(coloring ? { textColor: c } : { color: c }).then(() => this.renderBar());
			});
		}
		const eraser = this.bar.createEl("button", { cls: "opc-hl-eraser clickable-icon" });
		setIcon(eraser, "eraser");
		setTooltip(eraser, coloring ? t("textHighlight.color.erase") : t("textHighlight.erase"));
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
		// Esc ends this tool only (not the walk or the view the tool is on).
		e.stopImmediatePropagation();
		this.onEnd();
	};

	/** The text card under a screen point that can take marks (not one being edited). */
	private cardAt(x: number, y: number): MarkTarget | null {
		const target = this.probe(() => this.surface.cardAt(x, y));
		if (!target) return null;
		const n = target.node;
		return nodeType(n) === "text" && isTextBox(this.ctx, n) && !n.isEditing && !this.ctx.data.node(n).get().locked ? target : null;
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

	private caretAt(target: MarkTarget, x: number, y: number): Caret | null {
		const doc = this.surface.host.doc;
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
		return caret && target.root.isConnected && target.root.contains(caret.node) ? caret : null;
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
		const target = this.cardAt(e.clientX, e.clientY);
		if (!target) return; // empty space: the board pans as usual
		e.preventDefault();
		e.stopPropagation();
		const restore = target.open?.() ?? (() => {});
		const start = this.caretAt(target, e.clientX, e.clientY);
		if (!start) {
			restore();
			return;
		}
		capturePointer(this.overlay, e.pointerId);
		this.gesture = { pointerId: e.pointerId, target, start, end: start, restore };
		this.preview();
	};

	private onMove = (e: PointerEvent) => {
		const g = this.gesture;
		if (!g || e.pointerId !== g.pointerId) return;
		e.preventDefault();
		const end = this.caretAt(g.target, e.clientX, e.clientY);
		if (end) g.end = end;
		this.preview();
	};

	private onUp = (e: PointerEvent) => {
		const g = this.gesture;
		if (!g || e.pointerId !== g.pointerId) return;
		this.gesture = null;
		this.marks.empty();
		try {
			this.apply(g.target, g.start, g.end);
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
	private span(root: HTMLElement, a: Caret, b: Caret): { rendered: string; from: number; to: number } | null {
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

	/** Light boxes (underlines, for a text color) over the words that will be marked. */
	private preview(): void {
		this.marks.empty();
		const g = this.gesture;
		if (!g) return;
		const root = g.target.root;
		const s = this.span(root, g.start, g.end);
		if (!s) return;
		const range = rangeOf(root, s.from, s.to);
		if (!range) return;
		const host = this.surface.host.getBoundingClientRect();
		const color = this.mode === "color" ? this.ctx.settings.textColor : this.ctx.settings.color || THEME_HIGHLIGHT;
		for (const r of range.getClientRects()) {
			const m = this.marks.createDiv({ cls: "opc-hl-mark" });
			m.toggleClass("is-underline", this.mode === "color" && !this.erase);
			m.setCssStyles({ left: `${r.left - host.left}px`, top: `${r.top - host.top}px`, width: `${r.width}px`, height: `${r.height}px` });
			m.setCssProps({ "--opc-hl-mark": this.erase ? "var(--text-faint)" : color });
		}
	}

	private apply(target: MarkTarget, a: Caret, b: Caret): void {
		const node = target.node;
		const s = this.span(target.root, a, b);
		if (!s) return;
		const data = node.getData();
		const source = typeof data.text === "string" ? data.text : "";
		const range = locate(s.rendered, source, s.from, s.to);
		if (!range) {
			new Notice(this.ctx.t("textHighlight.notFound"));
			return;
		}
		const coloring = this.mode === "color";
		let next: string;
		if (coloring) next = this.erase ? uncolor(source, range[0], range[1]) : recolor(source, range[0], range[1], this.ctx.settings.textColor);
		else {
			const color = this.ctx.settings.color;
			next = this.erase ? unhighlight(source, range[0], range[1]) : rehighlight(source, range[0], range[1], { color: color ? color + ALPHA : "" });
		}
		if (next === source) return;
		// Only marks may change: anything else means the words were placed wrong.
		const bare = (text: string) => withoutColors(withoutHighlights(text));
		if (bare(next) !== bare(source)) {
			logWarn("[overpowered-canvas] text-highlight: skipped an edit that would change the text", { picked: s.rendered.slice(s.from, s.to), range, mode: this.mode });
			new Notice(this.ctx.t("textHighlight.notFound"));
			return;
		}
		mutate(this.ctx, this.canvas, () => node.setData({ ...node.getData(), text: next }));
		this.ctx.events.emit(coloring ? "text-colored" : "text-highlighted", this.canvas, node);
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

/**
 * Mark words in cards without editing them: the highlighter (card bar button, command and H) and
 * the text color tool (card bar button and command), with one bar, one set of colors of the
 * user's own, and the same gestures. Other views of the cards (the column view) use it too.
 */
export const textHighlightModule = defineModule<HighlightSettings>({
	id: "text-highlight",
	name: "textHighlight.name",
	description: "textHighlight.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: { color: "", textColor: TEXT_COLORS[0]!, customColors: [] },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		const custom = Array.isArray(s.customColors) ? s.customColors.filter((c): c is string => typeof c === "string" && HEX.test(c)).map((c) => c.toLowerCase()) : [];
		return {
			color: typeof s.color === "string" && (s.color === "" || HEX.test(s.color)) ? s.color.toLowerCase() : defaults.color,
			textColor: typeof s.textColor === "string" && HEX.test(s.textColor) ? s.textColor.toLowerCase() : defaults.textColor,
			customColors: custom.slice(0, MAX_CUSTOM),
		};
	},

	enable(ctx) {
		const sessions = new Map<CanvasLike, { session: HighlightSession; onEnd?: () => void }>();
		const refresh = (canvas: CanvasLike) => {
			const mode = sessions.get(canvas)?.session.mode ?? null;
			canvas.cardMenuEl.querySelector(".opc-card-text-highlight")?.toggleClass("is-active", mode === "highlight");
			canvas.cardMenuEl.querySelector(".opc-card-text-color")?.toggleClass("is-active", mode === "color");
		};
		const stop = (canvas: CanvasLike) => {
			releaseTool(canvas, "text-highlight");
			const open = sessions.get(canvas);
			sessions.delete(canvas);
			open?.session.destroy();
			refresh(canvas);
			open?.onEnd?.();
		};
		const start = (canvas: CanvasLike, mode: MarkMode, surface: MarkSurface, onEnd?: () => void) => {
			const open = sessions.get(canvas);
			if (open) stop(canvas);
			if (canvas.readonly) return;
			claimTool(canvas, "text-highlight", () => stop(canvas));
			canvas.deselectAll();
			sessions.set(canvas, { session: new HighlightSession(ctx, canvas, surface, mode, () => stop(canvas), () => refresh(canvas)), onEnd });
			refresh(canvas);
		};
		/** The board's buttons: on, off, or over to the other tool. */
		const toggle = (canvas: CanvasLike, mode: MarkMode) => {
			const open = sessions.get(canvas);
			if (open && open.session.mode === mode) return stop(canvas);
			if (open) return open.session.setMode(mode);
			start(canvas, mode, boardSurface(canvas));
		};
		marksHost.api = {
			start,
			stop,
			active: (canvas) => sessions.get(canvas)?.session.mode ?? null,
		};
		ctx.register(() => {
			marksHost.api = null;
			for (const c of [...sessions.keys()]) stop(c);
		});
		ctx.onCanvas((canvas) => () => stop(canvas));
		ctx.on("readonly-change", (canvas) => canvas.readonly && stop(canvas));

		ctx.addCardMenuButton({
			id: "text-highlight",
			icon: "highlighter",
			tooltip: () => ctx.t("textHighlight.button"),
			order: 121,
			onClick: (canvas) => toggle(canvas, "highlight"),
		});
		ctx.addCardMenuButton({
			id: "text-color",
			icon: "baseline",
			tooltip: () => ctx.t("textHighlight.color.button"),
			order: 122,
			onClick: (canvas) => toggle(canvas, "color"),
		});
		const command = (id: string, name: string, icon: string, mode: MarkMode) =>
			ctx.addCommand({
				id,
				name,
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || canvas.readonly) return false;
					if (!checking) toggle(canvas, mode);
					return true;
				},
			});
		command("toggle", ctx.t("textHighlight.button"), "highlighter", "highlight");
		command("toggle-color", ctx.t("textHighlight.color.button"), "baseline", "color");
		ctx.addCanvasKey({ modifiers: [], key: "H", handle: (canvas) => (canvas.readonly ? false : (toggle(canvas, "highlight"), true)) });
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
						.onClick(() => save([...colors, nextCustomColor(colors)])),
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
