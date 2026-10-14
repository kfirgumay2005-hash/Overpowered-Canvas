import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { OpcNode } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { showPicker } from "../../ui/picker";
import { canvasDirection, mutate, nodeType, onlyNodes, randomId, selectedNodes } from "../shared";
import { fontBucket, nextStickyPos, STICKY_COLORS, STICKY_SIZE, type Dir, type StickyColor } from "./logic";

interface StickySettings {
	color: StickyColor;
	/** Show author and date at the bottom of new notes. */
	footer: boolean;
	author: string;
}

const DEFAULTS: StickySettings = { color: "yellow", footer: false, author: "" };
const ARROWS: Record<string, Dir> = { ArrowRight: "right", ArrowLeft: "left", ArrowDown: "down", ArrowUp: "up" };

function isSticky(node: CanvasNodeLike, extra: OpcNode): boolean {
	return extra.kind === "sticky" && nodeType(node) === "text";
}

function render(node: CanvasNodeLike, extra: OpcNode | null): void {
	const el = node.nodeEl;
	if (!extra) {
		if (el.getAttribute("data-opc-kind") === "sticky") el.removeAttribute("data-opc-kind");
		el.removeAttribute("data-opc-sticky-font");
		el.querySelector(":scope .opc-sticky-footer")?.remove();
		return;
	}
	el.setAttribute("data-opc-kind", "sticky");
	el.setAttribute("data-opc-sticky-font", fontBucket(node.text ?? "", node.width, node.height));
	const meta = extra.sticky;
	let footer = el.querySelector<HTMLElement>(":scope .opc-sticky-footer");
	if (meta?.footer && (meta.author || meta.created)) {
		footer ??= (node.containerEl ?? el).createDiv({ cls: "opc-sticky-footer" });
		const parts = [meta.author, meta.created ? new Date(meta.created).toLocaleDateString() : ""].filter(Boolean);
		footer.setText(parts.join(" · "));
	} else footer?.remove();
}

/**
 * Sticky notes: square pastel notes whose text shrinks to fit. Tab adds the next note beside
 * the selected one (mirrored in RTL), Ctrl/Cmd+Arrows add one in that direction. Notes can
 * carry an author and date footer.
 */
export const stickyNotesModule = defineModule<StickySettings>({
	id: "sticky-notes",
	name: "stickyNotes.name",
	description: "stickyNotes.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: DEFAULTS,
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return { ...s, color: s.color in STICKY_COLORS ? s.color : defaults.color };
	},

	enable(ctx) {
		ctx.decorateNodes({
			apply: (node, extra) => render(node, isSticky(node, extra) ? extra : null),
			clear: (node) => render(node, null),
		});
		// Text edits and resizes change the font bucket.
		const refresh = (node: CanvasNodeLike) => {
			if (node.nodeEl.getAttribute("data-opc-kind") === "sticky") render(node, ctx.data.node(node).get());
		};
		ctx.on("node-editing", (node, editing) => !editing && refresh(node));
		ctx.on("node-moved", refresh);

		const create = (canvas: CanvasLike, pos: { x: number; y: number }, color: string, edit = true): CanvasNodeLike | null => {
			const id = randomId();
			const s = ctx.settings;
			const sticky = s.footer ? { footer: true, created: Date.now(), ...(s.author ? { author: s.author } : {}) } : undefined;
			mutate(ctx, canvas, () => {
				canvas.importData(
					{ nodes: [{ id, type: "text", text: "", x: Math.round(pos.x), y: Math.round(pos.y), width: STICKY_SIZE, height: STICKY_SIZE, color, "x-opc": { kind: "sticky", ...(sticky ? { sticky } : {}) } }], edges: [] },
					false,
				);
			});
			const node = canvas.nodes.get(id);
			if (!node) return null;
			canvas.selectOnly(node);
			ctx.events.emit("sticky-created", canvas, node);
			if (edit) window.setTimeout(() => node.startEditing(), 20);
			return node;
		};
		const defaultColor = () => STICKY_COLORS[ctx.settings.color];
		const atCenter = (canvas: CanvasLike) => {
			const v = canvas.getViewportBBox();
			return { x: (v.minX + v.maxX) / 2 - STICKY_SIZE / 2, y: (v.minY + v.maxY) / 2 - STICKY_SIZE / 2 };
		};

		/** The next note beside a selected sticky, in a physical direction. */
		const next = (canvas: CanvasLike, dir: Dir): boolean => {
			const nodes = selectedNodes(canvas);
			const from = nodes.length === 1 && canvas.selection.size === 1 ? nodes[0]! : null;
			if (!from || canvas.readonly || !isSticky(from, ctx.data.node(from).get())) return false;
			const occupied = (box: { x: number; y: number; width: number; height: number }) =>
				canvas.getIntersectingNodes({ minX: box.x + 1, minY: box.y + 1, maxX: box.x + box.width - 1, maxY: box.y + box.height - 1 }).some((n) => nodeType(n) !== "group");
			create(canvas, nextStickyPos(from, dir, occupied), from.color || defaultColor());
			return true;
		};
		// Above the mind map keys, which take the same keys on other cards.
		ctx.addCanvasKey({ modifiers: [], key: "Tab", priority: 10, handle: (canvas) => next(canvas, canvasDirection(canvas) === "rtl" ? "left" : "right") });
		for (const [key, dir] of Object.entries(ARROWS)) ctx.addCanvasKey({ modifiers: ["Mod"], key, priority: 10, handle: (canvas) => next(canvas, dir) });

		ctx.addCardMenuButton({
			id: "sticky",
			icon: "sticky-note",
			tooltip: () => ctx.t("stickyNotes.add"),
			order: 100,
			onClick: (canvas) => void create(canvas, atCenter(canvas), defaultColor()),
			onContextMenu: (canvas, evt) =>
				showPicker(
					evt.currentTarget as HTMLElement,
					[{ title: ctx.t("stickyNotes.add"), columns: 6, items: (Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => ({ id: c, label: ctx.t(`stickyNotes.color.${c}`), svg: swatch(STICKY_COLORS[c]) })) }],
					(id) => void create(canvas, atCenter(canvas), STICKY_COLORS[id as StickyColor]),
				),
			drag: { size: () => ({ width: STICKY_SIZE, height: STICKY_SIZE }), drop: (canvas, pos) => void create(canvas, pos, defaultColor()) },
		});
		ctx.addCommand({
			id: "add-sticky",
			name: ctx.t("stickyNotes.add"),
			icon: "sticky-note",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) create(canvas, atCenter(canvas), defaultColor());
				return true;
			},
		});

		// Selection toolbar: recolor stickies with the sticky palette.
		const selectedStickies = (selection: Parameters<typeof onlyNodes>[0]) => {
			const nodes = onlyNodes(selection);
			return nodes && nodes.every((n) => isSticky(n, ctx.data.node(n).get())) ? nodes : null;
		};
		ctx.addMenuButton({
			id: "sticky-color",
			icon: "sticky-note",
			tooltip: () => ctx.t("stickyNotes.color"),
			order: 5,
			isVisible: (selection) => !!selectedStickies(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = selectedStickies(selection) ?? [];
				showPicker(
					buttonEl,
					[{ columns: 6, items: (Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => ({ id: c, label: ctx.t(`stickyNotes.color.${c}`), svg: swatch(STICKY_COLORS[c]), active: nodes.every((n) => n.color === STICKY_COLORS[c]) })) }],
					(id) =>
						mutate(ctx, canvas, () => {
							for (const n of nodes) n.setColor(STICKY_COLORS[id as StickyColor]);
						}),
				);
			},
		});
	},

	renderSettings(el, ctx: ModuleContext<StickySettings>) {
		new Setting(el).setName(ctx.t("stickyNotes.defaultColor")).addDropdown((d) =>
			d
				.addOptions(Object.fromEntries((Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => [c, ctx.t(`stickyNotes.color.${c}`)])))
				.setValue(ctx.settings.color)
				.onChange((v) => ctx.updateSettings({ color: v as StickyColor })),
		);
		new Setting(el)
			.setName(ctx.t("stickyNotes.footer.name"))
			.setDesc(ctx.t("stickyNotes.footer.desc"))
			.addToggle((t) => t.setValue(ctx.settings.footer).onChange((v) => ctx.updateSettings({ footer: v })));
		new Setting(el).setName(ctx.t("stickyNotes.author")).addText((t) => t.setValue(ctx.settings.author).onChange((v) => ctx.updateSettings({ author: v.trim() })));
	},
});

function swatch(color: string): string {
	return `<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2" y="2" width="16" height="16" rx="2" fill="${color}" stroke="rgba(0,0,0,.2)"/></svg>`;
}
