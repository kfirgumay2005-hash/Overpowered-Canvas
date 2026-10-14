import { defineModule } from "../../core/module";
import type { CanvasLike } from "../../internals/types";

const CLASS = "opc-focus-mode";

/**
 * Focus mode: everything except the selected cards is blurred and dimmed. With "highlight
 * connected edges" (edge tools) on, the selected cards' edges stay sharp too.
 */
export const focusModeModule = defineModule({
	id: "focus-mode",
	name: "focusMode.name",
	description: "focusMode.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const toggle = (canvas: CanvasLike) => {
			const on = !canvas.wrapperEl.hasClass(CLASS);
			canvas.wrapperEl.toggleClass(CLASS, on);
			ctx.events.emit("focus-mode-changed", canvas, on);
		};
		ctx.addCommand({
			id: "toggle-focus-mode",
			name: ctx.t("focusMode.command"),
			icon: "focus",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas) return false;
				if (!checking) toggle(canvas);
				return true;
			},
		});
		ctx.onCanvas((canvas) => () => canvas.wrapperEl.removeClass(CLASS));
	},
});
