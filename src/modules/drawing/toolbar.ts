/** The drawing-mode toolbar: tools, colors (with a recent row), size and more options. */
import { Menu, setIcon, setTooltip } from "obsidian";
import type { I18nKey, Translate } from "../../i18n";

export type InkTool = "select" | "pen" | "pencil" | "marker" | "highlighter" | "eraser" | "line" | "arrow";
export const PEN_TOOLS = ["pen", "pencil", "marker", "highlighter"] as const;
export type PenTool = (typeof PEN_TOOLS)[number];

/** The default ink: near-black, drawn light in dark themes (see styles.css). */
export const INK_DEFAULT = "#1e1e1e";
export const PALETTE = [INK_DEFAULT, "#e03131", "#f08c00", "#ffd43b", "#2f9e44", "#1971c2", "#7048e8", "#ffffff"];

/** A saved pen: tool, color, width and pressure sensitivity, picked with one tap. */
export interface PenPreset {
	tool: PenTool;
	color: string;
	size: number;
	pressure: boolean;
}

/** Most pens the rack holds. */
export const MAX_PENS = 10;

export interface DrawingSettings {
	tool: InkTool;
	color: string;
	recent: string[];
	sizes: Record<PenTool, number>;
	smoothing: number;
	eraserMode: "stroke" | "partial";
	eraserSize: number;
	penOnly: boolean;
	recognize: boolean;
	holdMs: number;
	/** Strokes drawn on a card stick to it (move, copy and delete with it). */
	stickToCards: boolean;
	/** Stylus pressure changes the width; off: every stroke has one width. */
	pressure: boolean;
	/** The pen rack. */
	pens: PenPreset[];
}

export const DRAWING_DEFAULTS: DrawingSettings = {
	tool: "pen",
	color: INK_DEFAULT,
	recent: [],
	sizes: { pen: 4, pencil: 3, marker: 10, highlighter: 22 },
	smoothing: 0.5,
	eraserMode: "stroke",
	eraserSize: 24,
	penOnly: false,
	recognize: true,
	holdMs: 600,
	stickToCards: true,
	pressure: true,
	pens: [
		{ tool: "pen", color: INK_DEFAULT, size: 4, pressure: true },
		{ tool: "pen", color: "#1971c2", size: 2, pressure: true },
		{ tool: "marker", color: "#e03131", size: 10, pressure: false },
	],
};

/** Keeps only well-formed pens (settings come from disk). */
export function sanitizePens(raw: unknown, fallback: PenPreset[]): PenPreset[] {
	if (!Array.isArray(raw)) return fallback;
	const pens: PenPreset[] = [];
	for (const p of raw as Partial<PenPreset>[]) {
		if (!p || typeof p !== "object") continue;
		if (!(PEN_TOOLS as readonly string[]).includes(p.tool as string)) continue;
		if (typeof p.color !== "string" || !p.color) continue;
		if (typeof p.size !== "number" || !(p.size >= 1 && p.size <= 60)) continue;
		pens.push({ tool: p.tool as PenTool, color: p.color, size: p.size, pressure: p.pressure !== false });
	}
	return pens.slice(0, MAX_PENS);
}

const TOOLS: { tool: InkTool; icon: string; key: I18nKey }[] = [
	{ tool: "select", icon: "lasso", key: "drawing.tool.select" },
	{ tool: "pen", icon: "pen-tool", key: "drawing.tool.pen" },
	{ tool: "pencil", icon: "pencil", key: "drawing.tool.pencil" },
	{ tool: "marker", icon: "brush", key: "drawing.tool.marker" },
	{ tool: "highlighter", icon: "highlighter", key: "drawing.tool.highlighter" },
	{ tool: "eraser", icon: "eraser", key: "drawing.tool.eraser" },
	{ tool: "line", icon: "minus", key: "drawing.tool.line" },
	{ tool: "arrow", icon: "move-up-right", key: "drawing.tool.arrow" },
];

export interface ToolbarHost {
	t: Translate;
	settings(): DrawingSettings;
	update(patch: Partial<DrawingSettings>): void;
	lockSelection(): void;
	hasSelection(): boolean;
	close(): void;
	/** Names a color for people ("Red"), or returns it as is. */
	colorName(color: string): string;
}

export class InkToolbar {
	readonly el: HTMLElement;
	private moreEl: HTMLElement | null = null;

	constructor(
		parent: HTMLElement,
		private readonly host: ToolbarHost,
	) {
		this.el = parent.createDiv({ cls: "opc-ink-toolbar", attr: { role: "toolbar", "aria-label": host.t("drawing.toolbar") } });
		this.el.addEventListener("pointerdown", (e) => e.stopPropagation());
		this.render();
	}

	destroy(): void {
		this.moreEl?.remove();
		this.el.remove();
	}

	render(): void {
		const { t } = this.host;
		const s = this.host.settings();
		this.el.empty();
		// Another plugin's pencil bar sits at the top centre too: ours goes below it.
		this.el.toggleClass("mod-below-bar", !!this.el.parentElement?.querySelector(":scope > .canvas-pencil-bar"));
		const button = (icon: string, label: string, onClick: () => void, active = false, cls = "") => {
			const b = this.el.createEl("button", { cls: `clickable-icon opc-ink-button ${cls}`, attr: { "aria-label": label, "aria-pressed": String(active) } });
			setIcon(b, icon);
			setTooltip(b, label, { placement: "bottom" });
			if (active) b.addClass("is-active");
			b.addEventListener("click", onClick);
			return b;
		};
		for (const { tool, icon, key } of TOOLS) button(icon, t(key), () => this.host.update({ tool }), s.tool === tool);
		this.el.createDiv({ cls: "opc-ink-separator" });
		this.renderPens();
		this.el.createDiv({ cls: "opc-ink-separator" });

		const colors = [...new Set([...PALETTE, ...s.recent])].slice(0, PALETTE.length + 6);
		for (const color of colors) {
			const b = this.el.createEl("button", { cls: "opc-ink-swatch", attr: { "aria-label": color, "aria-pressed": String(color === s.color) } });
			b.style.setProperty("--swatch", color);
			if (color === s.color) b.addClass("is-active");
			b.addEventListener("click", () => this.host.update({ color }));
		}
		const custom = this.el.createEl("input", { type: "color", cls: "opc-ink-custom-color", attr: { "aria-label": t("drawing.customColor") } });
		custom.value = /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "#000000";
		custom.addEventListener("change", () => {
			const recent = [custom.value, ...s.recent.filter((c) => c !== custom.value)].slice(0, 6);
			this.host.update({ color: custom.value, recent });
		});
		this.el.createDiv({ cls: "opc-ink-separator" });

		const penTool = (PEN_TOOLS as readonly string[]).includes(s.tool) ? (s.tool as PenTool) : null;
		const size = this.el.createEl("input", { type: "range", cls: "opc-ink-size", attr: { min: "1", max: "60", "aria-label": t("drawing.size") } });
		size.value = String(penTool ? s.sizes[penTool] : s.tool === "eraser" ? s.eraserSize : s.sizes.pen);
		setTooltip(size, t("drawing.size"));
		size.addEventListener("input", () => {
			const v = Number(size.value);
			if (penTool) this.host.update({ sizes: { ...s.sizes, [penTool]: v } });
			else if (s.tool === "eraser") this.host.update({ eraserSize: v });
			else this.host.update({ sizes: { ...s.sizes, pen: v } });
		});
		if (this.host.hasSelection()) button("lock", t("drawing.lockSelection"), () => this.host.lockSelection());
		button("sliders-horizontal", t("drawing.more"), () => this.toggleMore());
		button("x", t("drawing.exit"), () => this.host.close(), false, "mod-close");
	}

	/** The pen rack: one tap picks a saved pen; long-press or right-click to update or remove it. */
	private renderPens(): void {
		const { t } = this.host;
		const s = this.host.settings();
		const current = this.currentPen();
		const same = (pen: PenPreset) => !!current && pen.tool === current.tool && pen.color === current.color && pen.size === current.size && pen.pressure === current.pressure;
		s.pens.forEach((pen, i) => {
			const active = same(pen);
			const b = this.el.createEl("button", { cls: "clickable-icon opc-ink-pen", attr: { "aria-pressed": String(active) } });
			b.style.setProperty("--swatch", pen.color);
			b.toggleClass("is-active", active);
			b.toggleClass("is-uniform", !pen.pressure);
			setIcon(b, TOOLS.find((x) => x.tool === pen.tool)?.icon ?? "pen-tool");
			const dot = b.createSpan({ cls: "opc-ink-pen-dot" });
			const d = Math.max(3, Math.min(14, Math.round(pen.size / 2 + 2)));
			dot.setCssStyles({ width: `${d}px`, height: `${d}px` });
			const label = t("drawing.pens.label", {
				tool: t(TOOLS.find((x) => x.tool === pen.tool)!.key),
				color: this.host.colorName(pen.color),
				size: String(pen.size),
				pressure: pen.pressure ? t("drawing.pens.pressure") : t("drawing.pens.noPressure"),
			});
			b.setAttribute("aria-label", label);
			setTooltip(b, label, { placement: "bottom" });
			b.addEventListener("click", () => {
				if (Date.now() - menuAt < 600) return;
				this.host.update({ tool: pen.tool, color: pen.color, pressure: pen.pressure, sizes: { ...s.sizes, [pen.tool]: pen.size } });
			});
			let menuAt = 0;
			const menu = (x: number, y: number) => {
				menuAt = Date.now();
				const m = new Menu();
				if (current)
					m.addItem((item) =>
						item
							.setTitle(t("drawing.pens.replace"))
							.setIcon("refresh-cw")
							.onClick(() => this.host.update({ pens: s.pens.map((p, j) => (j === i ? current : p)) })),
					);
				m.addItem((item) =>
					item
						.setTitle(t("drawing.pens.remove"))
						.setIcon("trash-2")
						.onClick(() => this.host.update({ pens: s.pens.filter((_, j) => j !== i) })),
				);
				m.showAtPosition({ x, y });
			};
			b.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				e.stopPropagation();
				if (Date.now() - menuAt > 600) menu(e.clientX, e.clientY);
			});
			// Touch and pen: hold to open the menu.
			b.addEventListener("pointerdown", (e) => {
				if (e.pointerType === "mouse") return;
				const timer = b.win.setTimeout(() => menu(e.clientX, e.clientY), 500);
				const clear = () => {
					b.win.clearTimeout(timer);
					b.removeEventListener("pointerup", clear);
					b.removeEventListener("pointercancel", clear);
					b.removeEventListener("pointerleave", clear);
				};
				b.addEventListener("pointerup", clear);
				b.addEventListener("pointercancel", clear);
				b.addEventListener("pointerleave", clear);
			});
		});
		if (current && s.pens.length < MAX_PENS && !s.pens.some(same)) {
			const add = this.el.createEl("button", { cls: "clickable-icon opc-ink-button opc-ink-pen-add", attr: { "aria-label": t("drawing.pens.add") } });
			setIcon(add, "plus");
			setTooltip(add, t("drawing.pens.add"), { placement: "bottom" });
			add.addEventListener("click", () => this.host.update({ pens: [...s.pens, current] }));
		}
	}

	/** The pen in use now, as a rack entry (null for the eraser, lasso and line tools). */
	private currentPen(): PenPreset | null {
		const s = this.host.settings();
		if (!(PEN_TOOLS as readonly string[]).includes(s.tool)) return null;
		const tool = s.tool as PenTool;
		return { tool, color: s.color, size: s.sizes[tool], pressure: s.pressure };
	}

	private toggleMore(): void {
		if (this.moreEl) {
			this.moreEl.remove();
			this.moreEl = null;
			return;
		}
		const { t } = this.host;
		const s = this.host.settings();
		const el = (this.moreEl = this.el.createDiv({ cls: "opc-ink-more" }));
		const row = (label: string) => {
			const r = el.createDiv({ cls: "opc-ink-more-row" });
			r.createSpan({ text: label });
			return r;
		};
		const smoothing = row(t("drawing.smoothing")).createEl("input", { type: "range", attr: { min: "0", max: "100" } });
		smoothing.value = String(Math.round(s.smoothing * 100));
		smoothing.addEventListener("input", () => this.host.update({ smoothing: Number(smoothing.value) / 100 }));
		const eraser = row(t("drawing.eraserMode")).createEl("select", { cls: "dropdown" });
		eraser.createEl("option", { value: "stroke", text: t("drawing.eraser.stroke") });
		eraser.createEl("option", { value: "partial", text: t("drawing.eraser.partial") });
		eraser.value = s.eraserMode;
		eraser.addEventListener("change", () => this.host.update({ eraserMode: eraser.value as DrawingSettings["eraserMode"] }));
		const toggle = (label: string, value: boolean, onChange: (v: boolean) => void) => {
			const cb = row(label).createEl("input", { type: "checkbox" });
			cb.checked = value;
			cb.addEventListener("change", () => onChange(cb.checked));
		};
		toggle(t("drawing.pressure"), s.pressure, (v) => this.host.update({ pressure: v }));
		toggle(t("drawing.penOnly"), s.penOnly, (v) => this.host.update({ penOnly: v }));
		toggle(t("drawing.recognize"), s.recognize, (v) => this.host.update({ recognize: v }));
		toggle(t("drawing.stickToCards"), s.stickToCards, (v) => this.host.update({ stickToCards: v }));
	}
}
