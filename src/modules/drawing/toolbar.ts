/** The drawing-mode toolbar: tools, colors (with a recent row), size and more options. */
import { setIcon, setTooltip } from "obsidian";
import type { I18nKey, Translate } from "../../i18n";

export type InkTool = "select" | "pen" | "pencil" | "marker" | "highlighter" | "eraser" | "line" | "arrow";
export const PEN_TOOLS = ["pen", "pencil", "marker", "highlighter"] as const;
export type PenTool = (typeof PEN_TOOLS)[number];

/** The default ink: near-black, drawn light in dark themes (see styles.css). */
export const INK_DEFAULT = "#1e1e1e";
export const PALETTE = [INK_DEFAULT, "#e03131", "#f08c00", "#ffd43b", "#2f9e44", "#1971c2", "#7048e8", "#ffffff"];

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
};

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
		toggle(t("drawing.penOnly"), s.penOnly, (v) => this.host.update({ penOnly: v }));
		toggle(t("drawing.recognize"), s.recognize, (v) => this.host.update({ recognize: v }));
	}
}
