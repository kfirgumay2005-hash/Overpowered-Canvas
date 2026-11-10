import { Notice, Setting, setIcon, setTooltip } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { OpcNode } from "../../data/schema";
import { LOCALES } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { NumberPromptModal } from "../../ui/number-prompt";
import { mergeWithDefaults } from "../../settings/settings";
import { mutate, nodeType, selectedEdges, selectedNodes } from "../shared";
import { nextSlide, slideOrder, type SlideEdge } from "./path";
import { enableWalk, type WalkKeys } from "./walker";
import { enableToc, type TocMode } from "./toc";
import { logError } from "../../core/log";

interface PresentationSettings {
	slideWidth: number;
	slideHeight: number;
	fullscreen: boolean;
	/** What the arrow keys follow when walking through a map. */
	walkKeys: WalkKeys;
	/** A tap on the empty board around the card moves like an arrow key. */
	walkTapZones: boolean;
	/** Small arrows around the card while walking. */
	walkHints: boolean;
	/** Card text size in the column view (px); 0 = as on the board. */
	columnFontSize: number;
	/** Widest card in the column view (px). */
	columnWidth: number;
	/** The column view shows cards at their size on the board, with their ink. */
	columnActualSize: boolean;
	/** The column view runs top to bottom (levels as rows) instead of left to right. */
	columnVertical: boolean;
	/** Table of contents: a simple grid, or cells arranged freely into groups. */
	tocMode: TocMode;
	/** Table of contents, simple grid: cells in a row. */
	tocPerRow: number;
	/** Table of contents: widest cell (px), unless cells keep their size on the board. */
	tocCellWidth: number;
	/** Table of contents: cells at their size on the board, with their handwriting. */
	tocActualSize: boolean;
}

interface Session {
	history: string[];
	wasReadonly: boolean;
	counterEl: HTMLElement;
	cleanup: () => void;
}

/** "Slide 3" in any UI language: slides made before the `slide` flag existed. */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SLIDE_LABEL = new RegExp(
	`^(?:${Object.values(LOCALES)
		.map((l) => l["presentation.slideLabel"].split("{n}").map(escapeRegExp).join("\\d+"))
		.join("|")})$`,
);

function isSlide(node: CanvasNodeLike, extra: Readonly<OpcNode>): boolean {
	return nodeType(node) === "group" && (extra.slide === true || SLIDE_LABEL.test(node.label ?? ""));
}

/** A click shorter than this that moved less than SLIDE_CLICK_MOVE toggles the frame. */
const SLIDE_CLICK_MOVE = 5;
/** Wait this long so a double-click (label editing) doesn't toggle twice. */
const SLIDE_CLICK_DELAY = 300;


function edgesOf(ctx: ModuleContext<PresentationSettings>, canvas: CanvasLike): SlideEdge[] {
	return [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id, order: ctx.data.edge(e).get().order, label: e.label }));
}

/**
 * Presentations along edges: mark a start slide, then arrow keys / PageUp / PageDown (works with
 * presentation remotes) move along the edges; numbered edges set the order when a slide has
 * several outgoing edges. The canvas is read-only while presenting; Esc ends it.
 */
export const presentationModule = defineModule<PresentationSettings>({
	id: "presentation",
	name: "presentation.name",
	description: "presentation.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: { slideWidth: 1200, slideHeight: 675, fullscreen: true, walkKeys: "tree", walkTapZones: true, walkHints: true, columnFontSize: 0, columnWidth: 340, columnActualSize: false, columnVertical: false, tocMode: "free", tocPerRow: 3, tocCellWidth: 240, tocActualSize: false },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : fallback);
		return {
			...s,
			walkKeys: s.walkKeys === "layout" ? "layout" : "tree",
			columnFontSize: s.columnFontSize === 0 ? 0 : num(s.columnFontSize, 8, 48, defaults.columnFontSize),
			columnWidth: num(s.columnWidth, 160, 1200, defaults.columnWidth),
			columnActualSize: typeof s.columnActualSize === "boolean" ? s.columnActualSize : defaults.columnActualSize,
			columnVertical: typeof s.columnVertical === "boolean" ? s.columnVertical : defaults.columnVertical,
			tocMode: s.tocMode === "simple" ? "simple" : "free",
			tocPerRow: num(s.tocPerRow, 1, 12, defaults.tocPerRow),
			tocCellWidth: num(s.tocCellWidth, 120, 1200, defaults.tocCellWidth),
			tocActualSize: typeof s.tocActualSize === "boolean" ? s.tocActualSize : defaults.tocActualSize,
		};
	},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const sessions = new Map<CanvasLike, Session>();
		const walker = enableWalk(ctx, (canvas) => sessions.has(canvas), () => ({
			keys: ctx.settings.walkKeys,
			tapZones: ctx.settings.walkTapZones,
			hints: ctx.settings.walkHints,
			columns: { fontSize: ctx.settings.columnFontSize, width: ctx.settings.columnWidth, actualSize: ctx.settings.columnActualSize, vertical: ctx.settings.columnVertical },
		}), () => void ctx.updateSettings({ columnVertical: !ctx.settings.columnVertical }));
		// The table of contents and the walk (with the column view) take turns on a board.
		const toc = enableToc(
			ctx,
			() => ({ mode: ctx.settings.tocMode, perRow: ctx.settings.tocPerRow, cellWidth: ctx.settings.tocCellWidth, actualSize: ctx.settings.tocActualSize, fontSize: ctx.settings.columnFontSize }),
			(patch) =>
				void ctx.updateSettings({
					...(patch.mode ? { tocMode: patch.mode } : {}),
					...(patch.actualSize !== undefined ? { tocActualSize: patch.actualSize } : {}),
					...(patch.perRow !== undefined ? { tocPerRow: patch.perRow } : {}),
				}),
			(canvas) => {
				if (walker.walking(canvas)) walker.stop(canvas);
			},
		);
		const startWalk = (canvas: CanvasLike, from?: CanvasNodeLike, inColumns = false) => {
			toc.close(canvas);
			walker.start(canvas, from, inColumns);
		};
		ctx.onSettingsChange((next, prev) => {
			if (next.columnFontSize !== prev.columnFontSize || next.columnWidth !== prev.columnWidth || next.columnActualSize !== prev.columnActualSize || next.columnVertical !== prev.columnVertical) walker.refresh();
			if (next.tocMode !== prev.tocMode || next.tocPerRow !== prev.tocPerRow || next.tocCellWidth !== prev.tocCellWidth || next.tocActualSize !== prev.tocActualSize || next.columnFontSize !== prev.columnFontSize) toc.refresh();
		});

		const show = (canvas: CanvasLike, session: Session) => {
			const id = session.history[session.history.length - 1]!;
			const node = canvas.nodes.get(id);
			if (!node) return;
			canvas.deselectAll();
			const b = node.getBBox();
			canvas.zoomToBbox({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY });
			const order = slideOrder(edgesOf(ctx, canvas), session.history[0]!);
			const index = order.indexOf(id);
			session.counterEl.setText(`${index + 1} / ${order.length}`);
			ctx.events.emit("presentation-slide-changed", canvas, node, index);
		};

		const exit = (canvas: CanvasLike) => {
			const session = sessions.get(canvas);
			if (!session) return;
			sessions.delete(canvas);
			session.cleanup();
			canvas.setReadonly(session.wasReadonly);
			const last = session.history[session.history.length - 1];
			// Remember where we stopped, without an undo step.
			if (last && ctx.data.isWritable(canvas)) {
				try {
					const presentation = { ...ctx.data.root(canvas).get().presentation, last };
					ctx.data.root(canvas).set({ presentation }, { history: false });
				} catch (error) {
					logError("[overpowered-canvas] could not store the last slide", error);
				}
			}
			ctx.events.emit("presentation-ended", canvas);
		};

		const start = (canvas: CanvasLike, from: "start" | "last" | "selection") => {
			if (sessions.has(canvas) || walker.walking(canvas)) return;
			const root = ctx.data.root(canvas).get().presentation;
			const id = from === "selection" ? selectedNodes(canvas)[0]?.id : from === "last" ? (root?.last ?? root?.start) : root?.start;
			const node = id ? canvas.nodes.get(id) : undefined;
			if (!node) {
				new Notice(ctx.t("presentation.noStart"));
				return;
			}
			const wrapper = canvas.wrapperEl;
			// Touch screens have no arrow keys: buttons to go back, forward and end.
			const navEl = wrapper.createDiv({ cls: "opc-presentation-nav", attr: { dir: "ltr" } });
			const navButton = (icon: string, label: string, run: () => void) => {
				const btn = navEl.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
				setIcon(btn, icon);
				btn.addEventListener("pointerdown", (e) => e.stopPropagation());
				btn.addEventListener("click", (e) => {
					e.stopPropagation();
					run();
				});
				return btn;
			};
			navButton("chevron-left", ctx.t("presentation.previous"), () => step(canvas, -1));
			const counterEl = navEl.createSpan({ cls: "opc-presentation-counter", attr: { "aria-live": "polite" } });
			navButton("chevron-right", ctx.t("presentation.next"), () => step(canvas, 1));
			navButton("x", ctx.t("presentation.end"), () => exit(canvas));
			const onKey = (evt: KeyboardEvent) => {
				if (!sessions.has(canvas)) return;
				const action = ctx.shortcutOf(evt, ["slides.next", "slides.previous", "slides.end", "slides.first"] as const);
				if (action === "slides.next") step(canvas, 1);
				else if (action === "slides.previous") step(canvas, -1);
				else if (action === "slides.end") exit(canvas);
				else if (action === "slides.first") {
					const s = sessions.get(canvas)!;
					s.history = s.history.slice(0, 1);
					show(canvas, s);
				} else return;
				evt.preventDefault();
				evt.stopPropagation();
			};
			const win = wrapper.win;
			win.addEventListener("keydown", onKey, true);
			const onFullscreen = () => {
				if (!wrapper.doc.fullscreenElement && sessions.has(canvas)) exit(canvas);
			};
			let fullscreen = false;
			if (ctx.settings.fullscreen && wrapper.doc.fullscreenEnabled) {
				fullscreen = true;
				void canvas.view.containerEl.requestFullscreen().catch(() => (fullscreen = false));
				wrapper.doc.addEventListener("fullscreenchange", onFullscreen);
			}
			wrapper.addClass("opc-presenting");
			const session: Session = {
				history: [node.id],
				wasReadonly: canvas.readonly,
				counterEl,
				cleanup: () => {
					win.removeEventListener("keydown", onKey, true);
					wrapper.doc.removeEventListener("fullscreenchange", onFullscreen);
					if (fullscreen && wrapper.doc.fullscreenElement) void wrapper.doc.exitFullscreen().catch(() => {});
					wrapper.removeClass("opc-presenting");
					navEl.remove();
				},
			};
			sessions.set(canvas, session);
			canvas.setReadonly(true);
			// Fullscreen changes the size: wait a frame before zooming.
			window.setTimeout(() => show(canvas, session), fullscreen ? 250 : 0);
			ctx.events.emit("presentation-started", canvas, node);
		};

		const step = (canvas: CanvasLike, delta: 1 | -1) => {
			const session = sessions.get(canvas);
			if (!session) return;
			if (delta === 1) {
				const next = nextSlide(edgesOf(ctx, canvas), session.history);
				if (!next) return;
				session.history.push(next);
			} else {
				if (session.history.length <= 1) return;
				session.history.pop();
			}
			show(canvas, session);
		};

		ctx.register(() => {
			for (const canvas of [...sessions.keys()]) exit(canvas);
		});
		ctx.onCanvas((canvas) => () => exit(canvas));

		const setStart = (canvas: CanvasLike, node: CanvasNodeLike) =>
			mutate(ctx, canvas, () => ctx.data.root(canvas).set({ presentation: { ...ctx.data.root(canvas).get().presentation, start: node.id } }));

		const command = (id: string, name: string, icon: string, can: (c: CanvasLike) => boolean, run: (c: CanvasLike) => void) =>
			ctx.addCommand({
				id,
				name,
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || !can(canvas)) return false;
					if (!checking) run(canvas);
					return true;
				},
			});
		command("start", ctx.t("presentation.start"), "presentation", (c) => !sessions.has(c), (c) => start(c, "start"));
		command("continue", ctx.t("presentation.continue"), "play", (c) => !sessions.has(c), (c) => start(c, "last"));
		command("start-here", ctx.t("presentation.startHere"), "play-circle", (c) => !sessions.has(c) && selectedNodes(c).length === 1, (c) => start(c, "selection"));
		command("next", ctx.t("presentation.next"), "arrow-right", (c) => sessions.has(c), (c) => step(c, 1));
		command("previous", ctx.t("presentation.previous"), "arrow-left", (c) => sessions.has(c), (c) => step(c, -1));
		command("end", ctx.t("presentation.end"), "x", (c) => sessions.has(c), exit);
		const idle = (c: CanvasLike) => !sessions.has(c) && !walker.walking(c);
		command("walk", ctx.t("presentation.walk.start"), "route", idle, (c) => startWalk(c));
		command("walk-end", ctx.t("presentation.walk.end"), "x", walker.walking, walker.stop);
		command("walk-columns", ctx.t("presentation.walk.columns"), "columns-3", (c) => !sessions.has(c), (c) => startWalk(c, undefined, true));
		command("toc", ctx.t("presentation.toc.open"), "layout-grid", (c) => !sessions.has(c), (c) => toc.toggle(c));
		command("toc-lock", ctx.t("presentation.toc.lockCommand"), "lock", (c) => toc.isOpen(c) && !c.readonly, (c) => toc.toggleLock(c));
		// The column view from the side bar too (also in the command palette). While it is open the
		// side bar is hidden; its own × closes it.
		ctx.onCanvas((canvas) => {
			const controls = canvas.wrapperEl.querySelector(".canvas-controls");
			const group = controls?.createDiv({ cls: "canvas-control-group mod-raised opc-columns-control" });
			const item = group?.createDiv({ cls: "canvas-control-item", attr: { "aria-label": ctx.t("presentation.walk.columns"), "data-tooltip-position": "left" } });
			if (item) {
				setIcon(item, "columns-3");
				setTooltip(item, ctx.t("presentation.walk.columns"), { placement: "left" });
				item.addEventListener("click", () => {
					if (!sessions.has(canvas) && !walker.walking(canvas)) startWalk(canvas, undefined, true);
				});
			}
			return () => group?.remove();
		});
		ctx.onCanvas((canvas) => {
			const controls = canvas.wrapperEl.querySelector(".canvas-controls");
			const group = controls?.createDiv({ cls: "canvas-control-group mod-raised opc-toc-control" });
			const item = group?.createDiv({ cls: "canvas-control-item", attr: { "aria-label": ctx.t("presentation.toc.open"), "data-tooltip-position": "left" } });
			if (item) {
				setIcon(item, "layout-grid");
				setTooltip(item, ctx.t("presentation.toc.open"), { placement: "left" });
				item.addEventListener("click", () => {
					if (!sessions.has(canvas)) toc.toggle(canvas);
				});
			}
			return () => group?.remove();
		});
		command("set-start", ctx.t("presentation.setStart"), "flag", (c) => !c.readonly && selectedNodes(c).length === 1, (c) => setStart(c, selectedNodes(c)[0]!));
		command("set-edge-order", ctx.t("presentation.edgeOrder"), "list-ordered", (c) => !c.readonly && selectedEdges(c).length === 1, (c) => promptOrder(c, selectedEdges(c)[0]!));

		const promptOrder = (canvas: CanvasLike, edge: import("../../internals/types").CanvasEdgeLike) =>
			new NumberPromptModal(ctx.app, ctx.t, { title: ctx.t("presentation.edgeOrder"), help: ctx.t("presentation.edgeOrderHelp"), value: ctx.data.edge(edge).get().order, step: 1 }, (value) =>
				mutate(ctx, canvas, () => ctx.data.edge(edge).set({ order: value })),
			).open();

		ctx.onNodeMenu((menu, node) => {
			if (idle(node.canvas)) menu.addItem((item) => item.setSection("canvas").setTitle(ctx.t("presentation.walk.fromHere")).setIcon("route").onClick(() => startWalk(node.canvas, node)));
			if (node.canvas.readonly) return;
			const isStart = ctx.data.root(node.canvas).get().presentation?.start === node.id;
			menu.addItem((item) => item.setSection("canvas").setTitle(ctx.t("presentation.setStart")).setIcon("flag").setChecked(isStart).onClick(() => setStart(node.canvas, node)));
		});
		ctx.onEdgeMenu((menu, edge) => {
			if (!edge.canvas.readonly) menu.addItem((item) => item.setSection("canvas").setTitle(ctx.t("presentation.edgeOrder")).setIcon("list-ordered").onClick(() => promptOrder(edge.canvas, edge)));
		});

		// Clicking a slide's label hides or shows its frame (the border stays as set until then).
		const toggleFrame = (node: CanvasNodeLike) => {
			const canvas = node.canvas;
			if (canvas.readonly || sessions.has(canvas)) return;
			const hidden = ctx.data.node(node).get().border === "none";
			mutate(ctx, canvas, () => ctx.data.node(node).set({ border: hidden ? undefined : "none" }));
		};
		const wired = new WeakSet<HTMLElement>();
		const wireLabel = (node: CanvasNodeLike) => {
			const label = node.labelEl;
			if (!label || wired.has(label)) return;
			wired.add(label);
			let down: { x: number; y: number; id: number } | null = null;
			let timer = 0;
			label.addEventListener("pointerdown", (evt) => {
				down = evt.button === 0 && evt.isPrimary ? { x: evt.clientX, y: evt.clientY, id: evt.pointerId } : null;
			});
			label.addEventListener("pointerup", (evt) => {
				const d = down;
				down = null;
				if (!d || d.id !== evt.pointerId || Math.hypot(evt.clientX - d.x, evt.clientY - d.y) > SLIDE_CLICK_MOVE) return;
				if (label.getAttr("contenteditable") === "true" || !node.nodeEl.hasAttribute("data-opc-slide")) return;
				window.clearTimeout(timer);
				timer = window.setTimeout(() => toggleFrame(node), SLIDE_CLICK_DELAY);
			});
			label.addEventListener("dblclick", () => window.clearTimeout(timer));
		};

		// Start slide badge and slide marker on the node.
		ctx.decorateNodes({
			apply: (node, extra) => {
				node.nodeEl.toggleClass("opc-start-slide", ctx.data.root(node.canvas).get().presentation?.start === node.id);
				const slide = isSlide(node, extra);
				node.nodeEl.toggleAttribute("data-opc-slide", slide);
				if (slide) wireLabel(node);
				if (node.labelEl) node.labelEl.title = slide ? ctx.t("presentation.frameToggle") : "";
			},
			clear: (node) => {
				node.nodeEl.removeClass("opc-start-slide");
				node.nodeEl.removeAttribute("data-opc-slide");
				if (node.labelEl) node.labelEl.title = "";
			},
		});
		ctx.on("root-extra-change", (canvas) => canvas.nodes.forEach((n) => n.nodeEl.toggleClass("opc-start-slide", ctx.data.root(canvas).get().presentation?.start === n.id)));

		// "Add slide": a group with consistent dimensions.
		const addSlide = (canvas: CanvasLike, pos: { x: number; y: number }, centered: boolean) =>
			mutate(ctx, canvas, () => {
				const count = [...canvas.nodes.values()].filter((n) => isSlide(n, ctx.data.node(n).get())).length;
				canvas.deselectAll();
				const slide = canvas.createGroupNode({
					pos,
					size: { width: ctx.settings.slideWidth, height: ctx.settings.slideHeight },
					...(centered ? { position: "center" } : {}),
					label: ctx.t("presentation.slideLabel", { n: count + 1 }),
					save: false,
					focus: false,
				});
				ctx.data.node(slide).set({ slide: true });
			});
		// The column view's card size, from the keyboard or the command palette (a tablet has no settings at hand).
		ctx.addCommand({
			id: "columns-actual-size",
			name: ctx.t("presentation.columnActualSize.toggle"),
			icon: "scan",
			callback: () => void ctx.updateSettings({ columnActualSize: !ctx.settings.columnActualSize }),
		});
		ctx.addCommand({
			id: "columns-vertical",
			name: ctx.t("presentation.columnVertical.toggle"),
			icon: "rows-3",
			callback: () => void ctx.updateSettings({ columnVertical: !ctx.settings.columnVertical }),
		});
		ctx.addCardMenuButton({
			id: "walk",
			icon: "route",
			tooltip: () => ctx.t("presentation.walk.start"),
			order: 111,
			onClick: (canvas) => startWalk(canvas),
		});
		ctx.addCardMenuButton({
			id: "add-slide",
			icon: "presentation",
			tooltip: () => ctx.t("presentation.addSlide"),
			order: 110,
			onClick: (canvas) => addSlide(canvas, canvas.posCenter(), true),
			drag: { size: () => ({ width: ctx.settings.slideWidth, height: ctx.settings.slideHeight }), drop: (canvas, pos) => addSlide(canvas, pos, false) },
		});
	},

	renderSettings(el, ctx) {
		new Setting(el)
			.setName(ctx.t("presentation.slideSize.name"))
			.setDesc(ctx.t("presentation.slideSize.desc"))
			.addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(ctx.settings.slideWidth)).onChange((v) => Number(v) > 0 && ctx.updateSettings({ slideWidth: Number(v) }));
			})
			.addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(ctx.settings.slideHeight)).onChange((v) => Number(v) > 0 && ctx.updateSettings({ slideHeight: Number(v) }));
			});
		new Setting(el)
			.setName(ctx.t("presentation.fullscreen.name"))
			.addToggle((t) => t.setValue(ctx.settings.fullscreen).onChange((v) => ctx.updateSettings({ fullscreen: v })));
		new Setting(el)
			.setName(ctx.t("presentation.walkKeys.name"))
			.setDesc(ctx.t("presentation.walkKeys.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ tree: ctx.t("presentation.walkKeys.tree"), layout: ctx.t("presentation.walkKeys.layout") })
					.setValue(ctx.settings.walkKeys)
					.onChange((v) => ctx.updateSettings({ walkKeys: v as WalkKeys })),
			);
		new Setting(el)
			.setName(ctx.t("presentation.walkTapZones.name"))
			.setDesc(ctx.t("presentation.walkTapZones.desc"))
			.addToggle((t) => t.setValue(ctx.settings.walkTapZones).onChange((v) => ctx.updateSettings({ walkTapZones: v })));
		new Setting(el)
			.setName(ctx.t("presentation.walkHints.name"))
			.setDesc(ctx.t("presentation.walkHints.desc"))
			.addToggle((t) => t.setValue(ctx.settings.walkHints).onChange((v) => ctx.updateSettings({ walkHints: v })));
		new Setting(el)
			.setName(ctx.t("presentation.columnFontSize.name"))
			.setDesc(ctx.t("presentation.columnFontSize.desc"))
			.addText((t) => {
				t.inputEl.type = "number";
				t.setPlaceholder(ctx.t("presentation.columnFontSize.auto"))
					.setValue(ctx.settings.columnFontSize ? String(ctx.settings.columnFontSize) : "")
					.onChange((v) => {
						const n = Number(v);
						if (!v.trim()) void ctx.updateSettings({ columnFontSize: 0 });
						else if (n >= 8 && n <= 48) void ctx.updateSettings({ columnFontSize: Math.round(n) });
					});
			});
		new Setting(el)
			.setName(ctx.t("presentation.columnWidth.name"))
			.setDesc(ctx.t("presentation.columnWidth.desc"))
			.addText((t) => {
				t.inputEl.type = "number";
				t.setValue(String(ctx.settings.columnWidth)).onChange((v) => {
					const n = Number(v);
					if (n >= 160 && n <= 1200) void ctx.updateSettings({ columnWidth: Math.round(n) });
				});
			});
		new Setting(el)
			.setName(ctx.t("presentation.columnActualSize.name"))
			.setDesc(ctx.t("presentation.columnActualSize.desc"))
			.addToggle((t) => t.setValue(ctx.settings.columnActualSize).onChange((v) => ctx.updateSettings({ columnActualSize: v })));
		new Setting(el)
			.setName(ctx.t("presentation.columnVertical.name"))
			.setDesc(ctx.t("presentation.columnVertical.desc"))
			.addToggle((t) => t.setValue(ctx.settings.columnVertical).onChange((v) => ctx.updateSettings({ columnVertical: v })));
		new Setting(el)
			.setName(ctx.t("presentation.tocMode.name"))
			.setDesc(ctx.t("presentation.tocMode.desc"))
			.addDropdown((d) =>
				d
					.addOption("free", ctx.t("presentation.tocMode.optFree"))
					.addOption("simple", ctx.t("presentation.tocMode.optSimple"))
					.setValue(ctx.settings.tocMode)
					.onChange((v) => ctx.updateSettings({ tocMode: v === "simple" ? "simple" : "free" })),
			);
		new Setting(el)
			.setName(ctx.t("presentation.tocPerRow.name"))
			.setDesc(ctx.t("presentation.tocPerRow.desc"))
			.addSlider((s) => s.setLimits(1, 12, 1).setValue(ctx.settings.tocPerRow).onChange((v) => ctx.updateSettings({ tocPerRow: v })));
		new Setting(el)
			.setName(ctx.t("presentation.tocCellWidth.name"))
			.setDesc(ctx.t("presentation.tocCellWidth.desc"))
			.addText((t) =>
				t.setValue(String(ctx.settings.tocCellWidth)).onChange((v) => {
					const n = Number(v);
					if (n >= 120 && n <= 1200) void ctx.updateSettings({ tocCellWidth: Math.round(n) });
				}),
			);
		new Setting(el)
			.setName(ctx.t("presentation.tocActualSize.name"))
			.setDesc(ctx.t("presentation.tocActualSize.desc"))
			.addToggle((t) => t.setValue(ctx.settings.tocActualSize).onChange((v) => ctx.updateSettings({ tocActualSize: v })));
	},
});
