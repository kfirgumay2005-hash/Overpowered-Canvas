import { Menu, setIcon, setTooltip, Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { NumberPromptModal } from "../../ui/number-prompt";
import { gridPattern } from "./logic";

interface GridSettings {
	visible: boolean;
	/** A line every N background dots. */
	every: number;
	/** Line color; empty follows the theme. */
	color: string;
}

const DEFAULTS: GridSettings = { visible: false, every: 5, color: "" };
const PRESETS = [1, 2, 4, 5, 10];
const MAX_EVERY = 50;
const clampEvery = (n: number) => (Number.isFinite(n) ? Math.min(MAX_EVERY, Math.max(1, Math.round(n))) : DEFAULTS.every);

type Ctx = ModuleContext<GridSettings>;

class GridLayer {
	private readonly svg: SVGSVGElement;
	private readonly pattern: SVGPatternElement;
	private readonly path: SVGPathElement;
	private last = "";

	constructor(
		private readonly ctx: Ctx,
		private readonly canvas: CanvasLike,
	) {
		this.svg = createSvg("svg", { cls: "opc-grid" });
		const id = `opc-grid-${Math.random().toString(36).slice(2)}`;
		this.pattern = this.svg.createSvg("pattern", { attr: { id, patternUnits: "userSpaceOnUse" } });
		this.path = this.pattern.createSvg("path", { cls: "opc-grid-line" });
		this.svg.createSvg("rect", { attr: { x: 0, y: 0, width: "100%", height: "100%", fill: `url(#${id})` } });
		// Right above the core's dot background, below every card and edge.
		const background = canvas.wrapperEl.querySelector(":scope > .canvas-background");
		if (background) background.after(this.svg);
		else canvas.wrapperEl.prepend(this.svg);
		this.update(true);
	}

	update(force = false): void {
		const c = this.canvas;
		const rect = c.canvasRect;
		const p = gridPattern(this.ctx.settings.every, { x: c.x, y: c.y, scale: c.scale, width: rect.width, height: rect.height });
		const key = `${p.cell},${p.x},${p.y}`;
		if (!force && key === this.last) return;
		this.last = key;
		this.pattern.setAttrs({ x: p.x - 0.5, y: p.y - 0.5, width: p.cell, height: p.cell });
		// Two edges of each cell; the pattern repeats them into a full grid. Half a pixel in, so
		// the tile doesn't clip half of the 1px stroke.
		this.path.setAttribute("d", `M ${p.cell} 0.5 L 0.5 0.5 0.5 ${p.cell}`);
		if (this.ctx.settings.color) this.path.style.stroke = this.ctx.settings.color;
		else this.path.style.removeProperty("stroke");
	}

	destroy(): void {
		this.svg.remove();
	}
}

/** A line grid behind the canvas content, a line every N background dots; toggled from the side controls. */
export const gridModule = defineModule<GridSettings>({
	id: "grid",
	name: "grid.name",
	description: "grid.desc",
	group: "navigation",
	defaultEnabled: true,
	defaultSettings: DEFAULTS,
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return { ...s, every: clampEvery(s.every), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : "" };
	},

	enable(ctx) {
		const layers = new Map<CanvasLike, GridLayer>();
		const buttons = new Map<CanvasLike, HTMLElement>();

		const sync = (canvas: CanvasLike) => {
			const layer = layers.get(canvas);
			if (ctx.settings.visible && !layer) layers.set(canvas, new GridLayer(ctx, canvas));
			else if (!ctx.settings.visible && layer) {
				layer.destroy();
				layers.delete(canvas);
			} else layer?.update(true);
			buttons.get(canvas)?.toggleClass("is-active", ctx.settings.visible);
		};
		const toggle = () => void ctx.updateSettings({ visible: !ctx.settings.visible });
		const setEvery = (every: number) => void ctx.updateSettings({ every: clampEvery(every), visible: true });
		const sizeMenu = (evt: MouseEvent) => {
			const menu = new Menu();
			for (const n of PRESETS)
				menu.addItem((item) =>
					item
						.setTitle(ctx.t("grid.every", { n }))
						.setChecked(ctx.settings.every === n)
						.onClick(() => setEvery(n)),
				);
			menu.addSeparator();
			menu.addItem((item) =>
				item
					.setTitle(ctx.t("grid.custom"))
					.setIcon("hash")
					.onClick(() =>
						new NumberPromptModal(ctx.app, ctx.t, { title: ctx.t("grid.every.name"), help: ctx.t("grid.every.desc"), value: ctx.settings.every, min: 1, max: MAX_EVERY, step: 1 }, (v) => {
							if (v !== undefined) setEvery(v);
						}).open(),
					),
			);
			menu.showAtMouseEvent(evt);
		};

		ctx.onCanvas((canvas) => {
			const controls = canvas.wrapperEl.querySelector(".canvas-controls");
			const group = controls?.createDiv({ cls: "canvas-control-group mod-raised opc-grid-control" });
			if (group) {
				const item = group.createDiv({ cls: "canvas-control-item", attr: { "aria-label": ctx.t("grid.toggle"), "data-tooltip-position": "left" } });
				setIcon(item, "grid");
				setTooltip(item, ctx.t("grid.toggle.tooltip"), { placement: "left" });
				item.addEventListener("click", toggle);
				item.addEventListener("contextmenu", (evt) => {
					evt.preventDefault();
					sizeMenu(evt);
				});
				buttons.set(canvas, item);
			}
			sync(canvas);
			return () => {
				layers.get(canvas)?.destroy();
				layers.delete(canvas);
				group?.remove();
				buttons.delete(canvas);
			};
		});
		ctx.onSettingsChange(() => {
			for (const canvas of ctx.canvases()) sync(canvas);
		});
		ctx.on("canvas-frame", (canvas) => layers.get(canvas)?.update());

		ctx.addCommand({ id: "toggle", name: ctx.t("grid.toggle"), icon: "grid", callback: toggle });
		ctx.addCommand({
			id: "size",
			name: ctx.t("grid.every.name"),
			icon: "grid",
			callback: () =>
				new NumberPromptModal(ctx.app, ctx.t, { title: ctx.t("grid.every.name"), help: ctx.t("grid.every.desc"), value: ctx.settings.every, min: 1, max: MAX_EVERY, step: 1 }, (v) => {
					if (v !== undefined) setEvery(v);
				}).open(),
		});
	},

	renderSettings(el, ctx) {
		new Setting(el)
			.setName(ctx.t("grid.every.name"))
			.setDesc(ctx.t("grid.every.desc"))
			.addSlider((s) =>
				s
					.setLimits(1, 20, 1)
					.setValue(Math.min(20, ctx.settings.every))

					.onChange((v) => ctx.updateSettings({ every: v })),
			);
		new Setting(el)
			.setName(ctx.t("grid.color.name"))
			.setDesc(ctx.t("grid.color.desc"))
			.addColorPicker((c) => c.setValue(ctx.settings.color || "#808080").onChange((v) => ctx.updateSettings({ color: v })))
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip(ctx.t("grid.color.reset"))
					.onClick(() => void ctx.updateSettings({ color: "" })),
			);
	},
});
