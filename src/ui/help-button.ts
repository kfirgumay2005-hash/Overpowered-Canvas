import { setTooltip } from "obsidian";
import type { CanvasLike } from "../internals/types";

/**
 * The help button (?) of the canvas side controls opened Obsidian's short "Canvas help" list. It
 * now opens the Shortcuts window, which lists those keys too (as "Canvas (built in)") along with
 * all of the plugin's. Returns the function that gives the button back.
 */
export function takeOverHelpButton(canvas: CanvasLike, opts: { label: () => string; open: () => void }): () => void {
	const icon = canvas.canvasControlsEl?.querySelector("svg.lucide-help-circle, svg.lucide-circle-help, svg.lucide-circle-question-mark");
	const button = icon?.closest<HTMLElement>(".canvas-control-item");
	if (!button) return () => {};
	const original = button.getAttribute("aria-label");
	const onClick = (evt: MouseEvent) => {
		evt.preventDefault();
		evt.stopImmediatePropagation();
		opts.open();
	};
	button.addEventListener("click", onClick, true);
	button.setAttribute("aria-label", opts.label());
	setTooltip(button, opts.label(), { placement: "left" });
	button.addClass("opc-shortcuts-button");
	return () => {
		button.removeEventListener("click", onClick, true);
		button.removeClass("opc-shortcuts-button");
		if (original !== null) {
			button.setAttribute("aria-label", original);
			setTooltip(button, original, { placement: "left" });
		}
	};
}
