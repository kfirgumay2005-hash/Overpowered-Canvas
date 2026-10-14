import { setTooltip } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasLike } from "../../internals/types";

export const FIRST_CUSTOM = 7;
export const LAST_CUSTOM = 32;

/** Custom palette entries defined by the theme or a CSS snippet as --canvas-color-7 … --canvas-color-32. */
function definedColors(): number[] {
	const style = getComputedStyle(document.body);
	const out: number[] = [];
	for (let n = FIRST_CUSTOM; n <= LAST_CUSTOM; n++) if (style.getPropertyValue(`--canvas-color-${n}`).trim() !== "") out.push(n);
	return out;
}

/**
 * Extra colors in the color picker. Colors are stored as their number ("7"), like the six
 * presets; the CSS that maps .mod-canvas-color-N to the variable ships with this module.
 * Vanilla Obsidian keeps the value and shows the card uncolored.
 */
export const customColorsModule = defineModule({
	id: "custom-colors",
	name: "customColors.name",
	description: "customColors.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		let colors = definedColors();
		ctx.registerEvent(ctx.app.workspace.on("css-change", () => (colors = definedColors())));

		const extendPicker = (canvas: CanvasLike, submenu: HTMLElement) => {
			if (submenu.querySelector(".opc-custom-color") || colors.length === 0) return;
			const current = [...canvas.selection].at(-1)?.color ?? "";
			const custom = submenu.querySelector(".canvas-color-picker-custom");
			for (const n of colors) {
				const item = createDiv({ cls: `canvas-color-picker-item opc-custom-color mod-canvas-color-${n}` });
				setTooltip(item, ctx.t("customColors.item", { n }));
				if (current === String(n)) {
					item.addClass("is-active");
					submenu.querySelector(".canvas-color-picker-custom")?.removeClass("is-active");
				}
				item.addEventListener("click", () => {
					for (const selected of canvas.selection) selected.setColor(String(n));
					canvas.requestSave();
					submenu.remove();
					canvas.menu.render(true);
				});
				if (custom) submenu.insertBefore(item, custom);
				else submenu.appendChild(item);
			}
		};

		// The core builds the color submenu when its palette button is clicked; add ours right after.
		ctx.on("menu-render", (menu) => {
			const palette = [...menu.menuEl.querySelectorAll<HTMLElement>("button")].find((b) => b.querySelector("svg.lucide-palette"));
			if (!palette || palette.dataset.opcColors) return;
			palette.dataset.opcColors = "1";
			palette.addEventListener("click", () => {
				const submenu = menu.menuEl.querySelector<HTMLElement>(".canvas-submenu");
				if (submenu) extendPicker(menu.canvas, submenu);
			});
		});
	},
});
