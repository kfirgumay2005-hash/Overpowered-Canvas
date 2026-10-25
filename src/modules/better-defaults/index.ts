import { Setting } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { BackgroundDoubleClick, clampDoubleClickMs, DOUBLE_CLICK_PRESETS, type DoubleClickSpeed } from "./double-click";

interface BetterDefaultsSettings {
	alignToGrid: boolean;
	textNodeWidth: number;
	textNodeHeight: number;
	fileNodeWidth: number;
	fileNodeHeight: number;
	minNodeSize: number;
	disableFontScaling: boolean;
	doubleClickSpeed: DoubleClickSpeed;
	doubleClickMs: number;
}

const DEFAULTS: BetterDefaultsSettings = {
	alignToGrid: true,
	textNodeWidth: 260,
	textNodeHeight: 60,
	fileNodeWidth: 400,
	fileNodeHeight: 400,
	minNodeSize: 40,
	disableFontScaling: false,
	doubleClickSpeed: "regular",
	doubleClickMs: DOUBLE_CLICK_PRESETS.regular,
};

const SPEEDS: readonly DoubleClickSpeed[] = ["fast", "regular", "slow", "custom"];

const clampSize = (n: number, min: number) => (Number.isFinite(n) ? Math.min(5000, Math.max(min, Math.round(n))) : min);

/** A card dragged from the bottom bar lands only if it moved and is released over the board itself. */
function dropAllowed(canvas: CanvasLike, from: { x: number; y: number }, up: PointerEvent): boolean {
	if (Math.hypot(up.clientX - from.x, up.clientY - from.y) < 8) return false;
	const el = up.view?.document.elementFromPoint(up.clientX, up.clientY);
	return !el || !(canvas.cardMenuEl.contains(el) || canvas.canvasControlsEl.contains(el));
}

/** Grid-aligned new nodes, default sizes, minimum size, optional constant label size and the double-click speed. */
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
			doubleClickSpeed: SPEEDS.includes(s.doubleClickSpeed) ? s.doubleClickSpeed : defaults.doubleClickSpeed,
			doubleClickMs: clampDoubleClickMs(s.doubleClickMs),
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

		// Double-click on the background creates a card: our own detection replaces the browser's dblclick there.
		const interval = () => (ctx.settings.doubleClickSpeed === "custom" ? ctx.settings.doubleClickMs : DOUBLE_CLICK_PRESETS[ctx.settings.doubleClickSpeed]);
		ctx.onCanvas((canvas) => {
			const tracker = new BackgroundDoubleClick(interval);
			const el = canvas.wrapperEl;
			const listeners: { [K in keyof HTMLElementEventMap]?: (evt: HTMLElementEventMap[K]) => void } = {
				// The core listener is bound at construction (patching the prototype misses open canvases),
				// but it skips events whose default was prevented; capture listeners run first.
				dblclick: (evt) => {
					if (evt.target === el) evt.preventDefault();
				},
				pointerdown: (evt) =>
					tracker.pointerDown({
						id: evt.pointerId,
						x: evt.clientX,
						y: evt.clientY,
						time: evt.timeStamp,
						onBackground: evt.target === el,
						primary: evt.isPrimary,
						leftButton: evt.button === 0,
						mouse: evt.pointerType === "mouse",
					}),
				pointermove: (evt) => tracker.pointerMove(evt.pointerId, evt.clientX, evt.clientY),
				pointercancel: () => tracker.cancel(),
				pointerup: (evt) => {
					if (!tracker.pointerUp(evt.pointerId, evt.clientX, evt.clientY, evt.timeStamp)) return;
					if (canvas.readonly || canvas.isDragging) return;
					canvas.createTextNode({ pos: canvas.posFromEvt(evt), position: "center" });
				},
			};
			const entries = Object.entries(listeners) as [string, EventListener][];
			for (const [type, fn] of entries) el.addEventListener(type, fn, true);
			return () => {
				for (const [type, fn] of entries) el.removeEventListener(type, fn, true);
			};
		});

		// Holding a bottom-bar button starts a drag even without moving; releasing it there dropped a
		// card under the bar. A drop that barely moved, or ends on the bar or the controls, is dropped.
		const patchedDrag = new WeakSet<object>();
		ctx.onCanvas((canvas) => {
			const proto = Object.getPrototypeOf(canvas) as CanvasLike;
			if (patchedDrag.has(proto)) return;
			patchedDrag.add(proto);
			ctx.patch("canvas.dragTempNode", proto, {
				dragTempNode: (next) =>
					function (this: CanvasLike, evt: PointerEvent, size: { width: number; height: number }, onDrop: (pos: { x: number; y: number }) => void) {
						const win = evt.view ?? window;
						const from = { x: evt.clientX, y: evt.clientY };
						let release: PointerEvent | null = null;
						// Window capture runs before the core's drag end, which calls onDrop.
						const onUp = (e: PointerEvent) => {
							if (e.pointerId !== evt.pointerId) return;
							release = e;
							win.removeEventListener("pointerup", onUp, true);
						};
						win.addEventListener("pointerup", onUp, true);
						return next.call(this, evt, size, (pos) => {
							const up: PointerEvent | null = release;
							if (up && !dropAllowed(this, from, up)) return;
							onDrop(pos);
						});
					},
			});
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
		const customMs = new Setting(el)
			.setName(t("betterDefaults.doubleClickMs.name"))
			.setDesc(t("betterDefaults.doubleClickMs.desc"))
			.addText((tx) => {
				tx.inputEl.type = "number";
				tx.setValue(String(ctx.settings.doubleClickMs)).onChange((v) => ctx.updateSettings({ doubleClickMs: Number(v) }));
			});
		new Setting(el)
			.setName(t("betterDefaults.doubleClick.name"))
			.setDesc(t("betterDefaults.doubleClick.desc"))
			.addDropdown((d) =>
				d
					.addOption("fast", t("betterDefaults.doubleClick.fast", { ms: DOUBLE_CLICK_PRESETS.fast }))
					.addOption("regular", t("betterDefaults.doubleClick.regular", { ms: DOUBLE_CLICK_PRESETS.regular }))
					.addOption("slow", t("betterDefaults.doubleClick.slow", { ms: DOUBLE_CLICK_PRESETS.slow }))
					.addOption("custom", t("betterDefaults.doubleClick.custom"))
					.setValue(ctx.settings.doubleClickSpeed)
					.onChange((v) => {
						customMs.settingEl.toggle(v === "custom");
						void ctx.updateSettings({ doubleClickSpeed: v as DoubleClickSpeed });
					}),
			);
		// The custom value goes right below the speed choice, shown only for "custom".
		el.appendChild(customMs.settingEl);
		customMs.settingEl.toggle(ctx.settings.doubleClickSpeed === "custom");
	},
});
