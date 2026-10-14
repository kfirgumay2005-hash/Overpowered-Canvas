import { Setting } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasLike } from "../../internals/types";

interface ReadonlySettings {
	hidePopupMenu: boolean;
	lockPan: boolean;
	lockZoom: boolean;
}

/**
 * Extra options for the core read-only mode: hide the selection toolbar, lock panning and/or
 * zooming. Zoom to fit / zoom to selection (Shift+1 / Shift+2 and the buttons) keep working.
 */
export const readonlyPlusModule = defineModule<ReadonlySettings>({
	id: "readonly-plus",
	name: "readonlyPlus.name",
	description: "readonlyPlus.desc",
	group: "vault",
	defaultEnabled: true,
	defaultSettings: { hidePopupMenu: true, lockPan: false, lockZoom: false },
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const syncBody = () => document.body.toggleClass("opc-ro-hide-menu", ctx.settings.hidePopupMenu);
		syncBody();
		ctx.onSettingsChange(syncBody);
		ctx.register(() => document.body.removeClass("opc-ro-hide-menu"));

		ctx.onCanvas((canvas: CanvasLike) => {
			const locked = () => canvas.readonly;
			const wrapper = canvas.wrapperEl;
			const win = wrapper.win;

			// Wheel: capture on the wrapper runs before the core's bubbling handler, which skips
			// events that were defaultPrevented.
			const onWheel = (evt: WheelEvent) => {
				if (!locked()) return;
				const zoomIntent = evt.ctrlKey || evt.metaKey || (canvas.options as { defaultWheelBehavior?: string }).defaultWheelBehavior === "zoom";
				if ((zoomIntent && ctx.settings.lockZoom) || (!zoomIntent && ctx.settings.lockPan)) evt.preventDefault();
			};
			// Pointer panning (middle/right drag, Space+drag, touch): stop it at the window, before
			// the canvas's own capture handlers.
			const onPointerDown = (evt: PointerEvent) => {
				if (!locked() || !wrapper.contains(evt.target as Node)) return;
				const touch = evt.pointerType === "touch";
				const panGesture = evt.button === 1 || evt.button === 2 || (evt.button === 0 && (evt.target as Element).closest(".canvas-mover"));
				if ((ctx.settings.lockPan && (panGesture || touch)) || (ctx.settings.lockZoom && touch)) {
					evt.stopPropagation();
					if (evt.button === 1) evt.preventDefault();
				}
			};
			wrapper.addEventListener("wheel", onWheel, { capture: true, passive: false });
			win.addEventListener("pointerdown", onPointerDown, true);
			return () => {
				wrapper.removeEventListener("wheel", onWheel, { capture: true });
				win.removeEventListener("pointerdown", onPointerDown, true);
			};
		});
	},

	renderSettings(el, ctx) {
		const toggle = (key: keyof ReadonlySettings, name: "readonlyPlus.hideMenu" | "readonlyPlus.lockPan" | "readonlyPlus.lockZoom") =>
			new Setting(el)
				.setName(ctx.t(`${name}.name`))
				.setDesc(ctx.t(`${name}.desc`))
				.addToggle((t) => t.setValue(ctx.settings[key]).onChange((v) => ctx.updateSettings({ [key]: v })));
		toggle("hidePopupMenu", "readonlyPlus.hideMenu");
		toggle("lockPan", "readonlyPlus.lockPan");
		toggle("lockZoom", "readonlyPlus.lockZoom");
	},
});
