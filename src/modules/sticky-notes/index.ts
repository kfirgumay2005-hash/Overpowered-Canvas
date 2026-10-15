import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { OpcNode } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { showPicker } from "../../ui/picker";
import { canvasDirection, mutate, nodeType, onlyNodes, randomId, selectedNodes } from "../shared";
import { fontBucket, nextStickyPos, pushRecent, RECENT_MAX, STICKY_COLORS, STICKY_SIZE, type Dir, type StickyColor } from "./logic";

interface StickySettings {
	/** A palette name, or any hex color. */
	color: string;
	/** Custom colors used last, newest first (at most RECENT_MAX). */
	recent: string[];
	/** Show author and date at the bottom of new notes. */
	footer: boolean;
	author: string;
}

const DEFAULTS: StickySettings = { color: "yellow", recent: [], footer: false, author: "" };
const HEX = /^#[0-9a-f]{6}$/i;
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
		return {
			...s,
			color: s.color in STICKY_COLORS || HEX.test(s.color) ? s.color : defaults.color,
			recent: s.recent.filter((c): c is string => typeof c === "string" && HEX.test(c)).slice(0, RECENT_MAX),
		};
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
		const defaultColor = () => resolveColor(ctx.settings.color);

		/** Remembers a custom color at the front of the recent list. */
		const remember = (color: string) => {
			if (isPreset(color)) return;
			void ctx.updateSettings({ recent: pushRecent(ctx.settings.recent, color) });
		};
		/** Preset swatches, recent custom colors and a "custom color" button; calls `apply` with a hex color. */
		const colorPicker = (anchor: HTMLElement, title: string | undefined, isActive: (hex: string) => boolean, apply: (hex: string) => void) => {
			const recent = ctx.settings.recent;
			showPicker(
				anchor,
				[
					{ title, columns: 6, items: (Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => ({ id: STICKY_COLORS[c], label: ctx.t(`stickyNotes.color.${c}`), svg: swatch(STICKY_COLORS[c]), active: isActive(STICKY_COLORS[c]) })) },
					...(recent.length ? [{ title: ctx.t("stickyNotes.recent"), columns: 5, items: recent.map((c) => ({ id: c, label: c, svg: swatch(c), active: isActive(c) })) }] : []),
					{ columns: 1, items: [{ id: "custom", label: ctx.t("stickyNotes.customColor"), icon: "pipette" }] },
				],
				(id) => {
					if (id !== "custom") {
						remember(id);
						apply(id);
						return;
					}
					pickColor(anchor, defaultColor(), (hex) => {
						remember(hex);
						apply(hex);
					});
				},
			);
		};
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
			onContextMenu: (canvas, evt) => colorPicker(evt.currentTarget as HTMLElement, ctx.t("stickyNotes.add"), () => false, (hex) => void create(canvas, atCenter(canvas), hex)),
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
				colorPicker(
					buttonEl,
					undefined,
					(hex) => nodes.every((n) => n.color.toLowerCase() === hex.toLowerCase()),
					(hex) =>
						mutate(ctx, canvas, () => {
							for (const n of nodes) n.setColor(hex);
						}),
				);
			},
		});
	},

	renderSettings(el, ctx: ModuleContext<StickySettings>) {
		const custom = !(ctx.settings.color in STICKY_COLORS);
		new Setting(el)
			.setName(ctx.t("stickyNotes.defaultColor"))
			.addDropdown((d) =>
				d
					.addOptions(Object.fromEntries((Object.keys(STICKY_COLORS) as StickyColor[]).map((c) => [c, ctx.t(`stickyNotes.color.${c}`)])))
					.addOption("custom", ctx.t("stickyNotes.customColor"))
					.setValue(custom ? "custom" : ctx.settings.color)
					.onChange((v) => {
						if (v !== "custom") void ctx.updateSettings({ color: v });
						else void ctx.updateSettings({ color: resolveColor(ctx.settings.color) });
					}),
			)
			.addColorPicker((c) => c.setValue(resolveColor(ctx.settings.color)).onChange((v) => ctx.updateSettings({ color: v.toLowerCase() })));
		new Setting(el)
			.setName(ctx.t("stickyNotes.footer.name"))
			.setDesc(ctx.t("stickyNotes.footer.desc"))
			.addToggle((t) => t.setValue(ctx.settings.footer).onChange((v) => ctx.updateSettings({ footer: v })));
		new Setting(el).setName(ctx.t("stickyNotes.author")).addText((t) => t.setValue(ctx.settings.author).onChange((v) => ctx.updateSettings({ author: v.trim() })));
	},
});

function resolveColor(color: string): string {
	return color in STICKY_COLORS ? STICKY_COLORS[color as StickyColor] : color;
}

function isPreset(hex: string): boolean {
	return Object.values(STICKY_COLORS).some((c) => c.toLowerCase() === hex.toLowerCase());
}

/** Opens the system color picker next to `anchor`. */
function pickColor(anchor: HTMLElement, initial: string, onPick: (hex: string) => void): void {
	const input = anchor.doc.body.createEl("input", { type: "color", cls: "opc-sticky-color-input" });
	const rect = anchor.getBoundingClientRect();
	input.style.left = `${Math.round(rect.left)}px`;
	input.style.top = `${Math.round(rect.bottom)}px`;
	input.value = initial;
	input.addEventListener("change", () => {
		onPick(input.value.toLowerCase());
		input.remove();
	});
	input.addEventListener("blur", () => window.setTimeout(() => input.remove(), 200));
	input.click();
}

function swatch(color: string): string {
	return `<svg viewBox="0 0 20 20" width="20" height="20"><rect x="2" y="2" width="16" height="16" rx="2" fill="${color}" stroke="rgba(0,0,0,.2)"/></svg>`;
}
