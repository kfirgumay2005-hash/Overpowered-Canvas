import { Notice, Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { OpcNode } from "../../data/schema";
import { LOCALES } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { NumberPromptModal } from "../../ui/number-prompt";
import { mutate, nodeType, selectedEdges, selectedNodes } from "../shared";
import { nextSlide, slideOrder, type SlideEdge } from "./path";

interface PresentationSettings {
	slideWidth: number;
	slideHeight: number;
	fullscreen: boolean;
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

const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]);
const PREV_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

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
	defaultSettings: { slideWidth: 1200, slideHeight: 675, fullscreen: true },
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const sessions = new Map<CanvasLike, Session>();

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
					console.error("[overpowered-canvas] could not store the last slide", error);
				}
			}
			ctx.events.emit("presentation-ended", canvas);
		};

		const start = (canvas: CanvasLike, from: "start" | "last" | "selection") => {
			if (sessions.has(canvas)) return;
			const root = ctx.data.root(canvas).get().presentation;
			const id = from === "selection" ? selectedNodes(canvas)[0]?.id : from === "last" ? (root?.last ?? root?.start) : root?.start;
			const node = id ? canvas.nodes.get(id) : undefined;
			if (!node) {
				new Notice(ctx.t("presentation.noStart"));
				return;
			}
			const wrapper = canvas.wrapperEl;
			const counterEl = wrapper.createDiv({ cls: "opc-presentation-counter", attr: { "aria-live": "polite", dir: "ltr" } });
			const onKey = (evt: KeyboardEvent) => {
				if (!sessions.has(canvas)) return;
				if (NEXT_KEYS.has(evt.key)) step(canvas, 1);
				else if (PREV_KEYS.has(evt.key)) step(canvas, -1);
				else if (evt.key === "Escape") exit(canvas);
				else if (evt.key === "Home") {
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
					counterEl.remove();
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
		command("set-start", ctx.t("presentation.setStart"), "flag", (c) => !c.readonly && selectedNodes(c).length === 1, (c) => setStart(c, selectedNodes(c)[0]!));
		command("set-edge-order", ctx.t("presentation.edgeOrder"), "list-ordered", (c) => !c.readonly && selectedEdges(c).length === 1, (c) => promptOrder(c, selectedEdges(c)[0]!));

		const promptOrder = (canvas: CanvasLike, edge: import("../../internals/types").CanvasEdgeLike) =>
			new NumberPromptModal(ctx.app, ctx.t, { title: ctx.t("presentation.edgeOrder"), help: ctx.t("presentation.edgeOrderHelp"), value: ctx.data.edge(edge).get().order, step: 1 }, (value) =>
				mutate(ctx, canvas, () => ctx.data.edge(edge).set({ order: value })),
			).open();

		ctx.onNodeMenu((menu, node) => {
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
	},
});
