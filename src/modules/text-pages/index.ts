import { defineModule } from "../../core/module";
import { TUTORIAL_KEY } from "../../tutorials/runner";
import type { CanvasLike, CanvasViewLike } from "../../internals/types";
import { pagesHost } from "../pages/api";
import { canvasDirection } from "../shared";
import { TEXT_PAGES_VIEW, TextPagesView } from "./view";

const BUTTON_CLASS = "opc-text-pages-switch";

/**
 * Text pages: a second way to look at a canvas. Each page of the canvas reads as an outline, one
 * page at a time, with the same index and links as on the board. A view, not a file: the
 * Markdown conversion stays what it is, and nothing is written unless a card is edited here.
 */
export const textPagesModule = defineModule({
	id: "text-pages",
	name: "textPages.name",
	description: "textPages.desc",
	group: "mindmap",
	defaultEnabled: true,
	defaultSettings: {},
	dependsOn: ["pages"],

	enable(ctx) {
		const app = ctx.app;
		ctx.registerView(TEXT_PAGES_VIEW, (leaf) => new TextPagesView(leaf, ctx));

		const showAsText = (canvas: CanvasLike) => {
			const view = canvas.view;
			const file = view.file;
			if (!file) return;
			const state = { file: file.path, page: pagesHost.api?.current(canvas) ?? "", rtl: canvasDirection(canvas) === "rtl" };
			// A practice board keeps its tab: the tutorial's panel lives there.
			const open = app.workspace.getLeavesOfType(TEXT_PAGES_VIEW).find((l) => (l.view as TextPagesView).file === file);
			const leaf = canvas.data[TUTORIAL_KEY] ? (open ?? app.workspace.createLeafBySplit(view.leaf, "vertical")) : view.leaf;
			void leaf.setViewState({ type: TEXT_PAGES_VIEW, state, active: true });
		};

		ctx.addCommand({
			id: "toggle",
			name: ctx.t("textPages.toggle"),
			icon: "book-open",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const text = app.workspace.getActiveViewOfType(TextPagesView);
				if (!canvas && !text) return false;
				if (!checking) {
					if (text) void text.showCanvas();
					if (canvas) showAsText(canvas);
				}
				return true;
			},
		});

		// The button in the header of a canvas.
		const buttons = new WeakSet<CanvasViewLike>();
		const refresh = () => {
			for (const leaf of app.workspace.getLeavesOfType("canvas")) {
				const view = leaf.view as CanvasViewLike;
				if (buttons.has(view) || typeof view.addAction !== "function") continue;
				buttons.add(view);
				const el = view.addAction("book-open", ctx.t("textPages.toggle"), () => view.canvas && showAsText(view.canvas));
				el.addClass(BUTTON_CLASS);
				ctx.register(() => el.remove());
			}
		};
		app.workspace.onLayoutReady(refresh);
		ctx.registerEvent(app.workspace.on("layout-change", refresh));
		ctx.registerEvent(app.workspace.on("active-leaf-change", refresh));
	},
});
