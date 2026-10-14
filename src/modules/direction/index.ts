import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { DIRECTIONS, type Direction } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { showPicker } from "../../ui/picker";
import { common, mutate, nodeType, onlyNodes } from "../shared";

interface DirectionSettings {
	/** Layout direction of canvases: follow Obsidian's interface, or fixed. */
	canvas: "ui" | "ltr" | "rtl";
	/** Text direction in cards: "auto" detects it per paragraph. */
	cards: Direction;
}

const DEFAULTS: DirectionSettings = { canvas: "ui", cards: "auto" };
const ICONS: Record<Direction, string> = { auto: "languages", ltr: "pilcrow-right", rtl: "pilcrow-left" };

/**
 * Right-to-left support: the canvas layout direction (global, or per canvas in the file) drives
 * every mirrored feature — mind map growth, templates, sticky placement, frame order, menus,
 * badges and the minimap corner. Cards detect their text direction per paragraph (mixed
 * Hebrew/English), or can be fixed per card from the selection toolbar.
 */
export const directionModule = defineModule<DirectionSettings>({
	id: "direction",
	name: "direction.name",
	description: "direction.desc",
	group: "core",
	defaultEnabled: true,
	defaultSettings: DEFAULTS,
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			canvas: ["ui", "ltr", "rtl"].includes(s.canvas) ? s.canvas : defaults.canvas,
			cards: DIRECTIONS.includes(s.cards) ? s.cards : defaults.cards,
		};
	},

	enable(ctx) {
		const applyCanvas = (canvas: CanvasLike) => {
			const own = ctx.data.root(canvas).get().dir;
			const dir = own === "ltr" || own === "rtl" ? own : ctx.settings.canvas === "ui" ? null : ctx.settings.canvas;
			if (dir) canvas.wrapperEl.setAttribute("dir", dir);
			else canvas.wrapperEl.removeAttribute("dir");
			canvas.wrapperEl.toggleClass("opc-rtl", getComputedStyle(canvas.wrapperEl).direction === "rtl");
		};
		const applyNode = (node: CanvasNodeLike, own: Direction | undefined) => {
			if (nodeType(node) === "group") return;
			const dir = own ?? ctx.settings.cards;
			// "auto" is the core's per-paragraph detection: no attribute needed.
			if (dir === "auto") node.nodeEl.removeAttribute("dir");
			else node.nodeEl.setAttribute("dir", dir);
		};

		ctx.onCanvas((canvas) => {
			applyCanvas(canvas);
			return () => {
				canvas.wrapperEl.removeAttribute("dir");
				canvas.wrapperEl.removeClass("opc-rtl");
			};
		});
		ctx.on("root-extra-change", applyCanvas);
		ctx.on("data-load", applyCanvas);
		ctx.on("history-apply", applyCanvas);
		ctx.decorateNodes({
			apply: (node, extra) => applyNode(node, extra.dir),
			clear: (node) => node.nodeEl.removeAttribute("dir"),
		});
		ctx.onSettingsChange(() => {
			for (const canvas of ctx.canvases()) {
				applyCanvas(canvas);
				for (const node of canvas.nodes.values()) applyNode(node, ctx.data.node(node).get().dir);
			}
		});

		// Per-card text direction.
		const textNodes = (selection: Parameters<typeof onlyNodes>[0]) => {
			const nodes = onlyNodes(selection);
			return nodes && nodes.every((n) => nodeType(n) === "text" || nodeType(n) === "file") ? nodes : null;
		};
		ctx.addMenuButton({
			id: "text-direction",
			icon: (selection) => ICONS[common(textNodes(selection) ?? [], (n) => ctx.data.node(n).get().dir) ?? "auto"],
			tooltip: () => ctx.t("direction.card"),
			order: 13,
			isVisible: (selection) => !!textNodes(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = textNodes(selection) ?? [];
				const current = common(nodes, (n) => ctx.data.node(n).get().dir);
				showPicker(
					buttonEl,
					[{ columns: 3, items: DIRECTIONS.map((d) => ({ id: d, label: ctx.t(`direction.${d}` as I18nKey), icon: ICONS[d], active: (current ?? "auto") === d })) }],
					(id) =>
						mutate(ctx as ModuleContext<object>, canvas, () => {
							for (const n of nodes) ctx.data.node(n).set({ dir: id === "auto" ? undefined : (id as Direction) });
						}),
				);
			},
		});

		// Per-canvas layout direction, stored in the file.
		const setCanvasDir = (canvas: CanvasLike, dir: Direction) => mutate(ctx as ModuleContext<object>, canvas, () => ctx.data.root(canvas).set({ dir: dir === "auto" ? undefined : dir }));
		for (const dir of DIRECTIONS)
			ctx.addCommand({
				id: `canvas-${dir}`,
				name: ctx.t(`direction.canvas.${dir}` as I18nKey),
				icon: ICONS[dir],
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || canvas.readonly) return false;
					if (!checking) setCanvasDir(canvas, dir);
					return true;
				},
			});
	},

	renderSettings(el, ctx: ModuleContext<DirectionSettings>) {
		new Setting(el)
			.setName(ctx.t("direction.global.name"))
			.setDesc(ctx.t("direction.global.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ ui: ctx.t("direction.ui"), ltr: ctx.t("direction.ltr"), rtl: ctx.t("direction.rtl") })
					.setValue(ctx.settings.canvas)
					.onChange((v) => ctx.updateSettings({ canvas: v as DirectionSettings["canvas"] })),
			);
		new Setting(el)
			.setName(ctx.t("direction.cards.name"))
			.setDesc(ctx.t("direction.cards.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ auto: ctx.t("direction.auto"), ltr: ctx.t("direction.ltr"), rtl: ctx.t("direction.rtl") })
					.setValue(ctx.settings.cards)
					.onChange((v) => ctx.updateSettings({ cards: v as Direction })),
			);
	},
});
