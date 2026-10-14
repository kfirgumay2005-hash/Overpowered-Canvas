import { defineModule } from "../../core/module";

/**
 * Makes reading mode of text cards use the same spacing as the editor, so content no longer
 * jumps when a card enters or leaves edit mode. Pure CSS (see styles.css); nothing is written
 * to the file.
 */
export const altTextRenderingModule = defineModule({
	id: "alt-text-rendering",
	name: "altTextRendering.name",
	description: "altTextRendering.desc",
	group: "nodes",
	defaultEnabled: false,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],
	enable() {
		// Styling only: the body class added by the module manager activates styles.css.
	},
});
