import { Setting } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";

interface BetterDefaultsSettings {
	alignToGrid: boolean;
	textNodeWidth: number;
	textNodeHeight: number;
	fileNodeWidth: number;
	fileNodeHeight: number;
	minNodeSize: number;
	disableFontScaling: boolean;
}

const DEFAULTS: BetterDefaultsSettings = {
	alignToGrid: true,
	textNodeWidth: 260,
	textNodeHeight: 60,
	fileNodeWidth: 400,
	fileNodeHeight: 400,
	minNodeSize: 40,
	disableFontScaling: false,
};

const clampSize = (n: number, min: number) => (Number.isFinite(n) ? Math.min(5000, Math.max(min, Math.round(n))) : min);

/** Grid-aligned new nodes, default sizes, minimum size and optional constant label size. */
export const betterDefaultsModule = defineModule<BetterDefaultsSettings>({
	id: "better-defaults",
	name: "betterDefaults.name",
	description: "betterDefaults.desc",
	group: "core",
	defaultEnabled: true,
	defaultSettings: DEFAULTS,
	overlapsWith: ["advanced-canvas"],
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			...s,
			textNodeWidth: clampSize(s.textNodeWidth, 20),
			textNodeHeight: clampSize(s.textNodeHeight, 20),
			fileNodeWidth: clampSize(s.fileNodeWidth, 20),
			fileNodeHeight: clampSize(s.fileNodeHeight, 20),
			minNodeSize: clampSize(s.minNodeSize, 5),
		};
	},

	enable(ctx) {
		const originals = new WeakMap<CanvasLike, { text: { width: number; height: number }; file: { width: number; height: number }; min: number }>();

		const apply = (canvas: CanvasLike) => {
			if (!originals.has(canvas))
				originals.set(canvas, {
					text: canvas.config.defaultTextNodeDimensions,
					file: canvas.config.defaultFileNodeDimensions,
					min: canvas.config.minContainerDimension,
				});
			const s = ctx.settings;
			canvas.config.defaultTextNodeDimensions = { width: s.textNodeWidth, height: s.textNodeHeight };
			canvas.config.defaultFileNodeDimensions = { width: s.fileNodeWidth, height: s.fileNodeHeight };
			canvas.config.minContainerDimension = s.minNodeSize;
		};

		ctx.onCanvas((canvas) => {
			apply(canvas);
			return () => {
				const o = originals.get(canvas);
				if (!o) return;
				canvas.config.defaultTextNodeDimensions = o.text;
				canvas.config.defaultFileNodeDimensions = o.file;
				canvas.config.minContainerDimension = o.min;
			};
		});

		const syncBodyClass = () => document.body.toggleClass("opc-no-font-scaling", ctx.settings.disableFontScaling);
		syncBodyClass();
		ctx.register(() => document.body.removeClass("opc-no-font-scaling"));
		ctx.onSettingsChange(() => {
			for (const canvas of ctx.canvases()) apply(canvas);
			syncBodyClass();
		});

		// Nodes created by the user (not loaded or pasted: those get their position from setData right after).
		ctx.on("node-added", (node) => {
			if (!ctx.settings.alignToGrid) return;
			const grid = node.canvas.gridSpacing || 20;
			const x = Math.round(node.x / grid) * grid;
			const y = Math.round(node.y / grid) * grid;
			if (x !== node.x || y !== node.y) node.moveTo({ x, y });
		});
	},

	renderSettings(el, ctx) {
		const t = ctx.t;
		new Setting(el)
			.setName(t("betterDefaults.alignToGrid.name"))
			.setDesc(t("betterDefaults.alignToGrid.desc"))
			.addToggle((tg) => tg.setValue(ctx.settings.alignToGrid).onChange((v) => ctx.updateSettings({ alignToGrid: v })));
		const sizeSetting = (name: string, w: keyof BetterDefaultsSettings, h: keyof BetterDefaultsSettings) =>
			new Setting(el)
				.setName(name)
				.addText((tx) => {
					tx.inputEl.type = "number";
					tx.setValue(String(ctx.settings[w])).onChange((v) => ctx.updateSettings({ [w]: Number(v) }));
				})
				.addText((tx) => {
					tx.inputEl.type = "number";
					tx.setValue(String(ctx.settings[h])).onChange((v) => ctx.updateSettings({ [h]: Number(v) }));
				});
		sizeSetting(t("betterDefaults.textSize.name"), "textNodeWidth", "textNodeHeight").setDesc(t("betterDefaults.size.desc"));
		sizeSetting(t("betterDefaults.fileSize.name"), "fileNodeWidth", "fileNodeHeight").setDesc(t("betterDefaults.size.desc"));
		new Setting(el)
			.setName(t("betterDefaults.minSize.name"))
			.setDesc(t("betterDefaults.minSize.desc"))
			.addText((tx) => {
				tx.inputEl.type = "number";
				tx.setValue(String(ctx.settings.minNodeSize)).onChange((v) => ctx.updateSettings({ minNodeSize: Number(v) }));
			});
		new Setting(el)
			.setName(t("betterDefaults.fontScaling.name"))
			.setDesc(t("betterDefaults.fontScaling.desc"))
			.addToggle((tg) => tg.setValue(ctx.settings.disableFontScaling).onChange((v) => ctx.updateSettings({ disableFontScaling: v })));
	},
});
