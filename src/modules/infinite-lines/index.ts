import { Menu, sanitizeHTMLToDom, setTooltip } from "obsidian";
import { defineModule } from "../../core/module";
import type { GuideData, OpcNode } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { NumberPromptModal } from "../../ui/number-prompt";
import { closePicker, showPicker, showPopover, type ChoiceAnchor } from "../../ui/picker";
import { common, isHiddenNode, mutate, nodeType, onlyNodes, randomId } from "../shared";
import { angleOf, HANDLE_LONG, HANDLE_SHORT, handleSize, normalizeAngle, projectOnLine, withAngle } from "./geometry";

/** Obsidian's hover layer over a card (resize handles, connection dots). */
interface InteractionLayer {
	interactionEl: HTMLElement;
	setTarget(target: CanvasNodeLike | null): void;
}
type ConnectableNode = CanvasNodeLike & { onConnectionPointerdown(evt: PointerEvent, side: string): void };

/**
 * Lines are drawn only across the visible part of the board (recomputed on every pan and zoom):
 * Chromium paints a very long turned element over the whole canvas.
 */
const VIEW_MARGIN = 200;
const WIDTHS = [1, 2, 4, 6, 10, 16];
const DEFAULT_WIDTH = 2;
const ANGLES = [0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165];
const isGuide = (node: CanvasNodeLike, extra: Readonly<OpcNode>) => extra.kind === "guide" && !!extra.guide && nodeType(node) === "text";

/** One canvas' line layer: a div under all cards holding one element per line. */
class GuideLayer {
	readonly el: HTMLElement;
	private readonly lines = new Map<CanvasNodeLike, { el: HTMLElement; guide: GuideData; watch: MutationObserver }>();

	constructor(
		private readonly canvas: CanvasLike,
		private readonly onLineDown: (node: CanvasNodeLike, evt: PointerEvent) => void,
	) {
		this.el = createDiv({ cls: "opc-guides" });
		canvas.canvasEl.prepend(this.el);
	}

	render(node: CanvasNodeLike, guide: GuideData): void {
		let entry = this.lines.get(node);
		if (!entry) {
			const el = this.el.createDiv({ cls: "opc-guide" });
			el.createDiv({ cls: "opc-guide-stroke" });
			el.addEventListener("pointerdown", (evt) => this.onLineDown(node, evt));
			// A double-click on the line must not create a card underneath.
			el.addEventListener("dblclick", (evt) => evt.stopPropagation());
			// The line follows its handle's layer (hidden / locked), whichever module marks it.
			const sync = () => {
				el.toggleClass("opc-layer-hidden", isHiddenNode(node));
				el.toggleAttribute("data-opc-layer-locked", node.nodeEl.hasAttribute("data-opc-layer-locked"));
			};
			const watch = new MutationObserver(sync);
			watch.observe(node.nodeEl, { attributes: true, attributeFilter: ["class", "data-opc-layer-locked"] });
			sync();
			entry = { el, guide, watch };
			this.lines.set(node, entry);
		}
		entry.guide = guide;
		const line = entry.el;
		const angle = angleOf(guide);
		line.dataset.axis = angle === 0 ? "h" : angle === 90 ? "v" : "angle";
		line.style.setProperty("--opc-guide-width", `${guide.width}px`);
		this.place(node, line, angle);
		// Colors: palette numbers use the core's classes, anything else is a hex value.
		for (const cls of [...line.classList]) if (cls.startsWith("mod-canvas-color-")) line.removeClass(cls);
		line.style.removeProperty("--canvas-color");
		if (/^\d+$/.test(node.color)) line.addClass(`mod-canvas-color-${node.color}`);
		else if (node.color) line.style.setProperty("--canvas-color", node.color);
		line.toggleClass("is-themed", !!node.color);
		line.toggleClass("is-selected", this.canvas.selection.has(node));
	}

	/** A bar through the line's point nearest the view center, long enough to cross the view. */
	private place(node: CanvasNodeLike, line: HTMLElement, angle: number): void {
		const v = this.canvas.getViewportBBox();
		const mid = projectOnLine({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, angle, { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 });
		const half = Math.hypot(v.maxX - v.minX, v.maxY - v.minY) / 2 + VIEW_MARGIN;
		line.setCssStyles({
			left: `${mid.x - half}px`,
			top: `${mid.y}px`,
			width: `${2 * half}px`,
			transform: `translateY(-50%) rotate(${angle}deg)`,
		});
	}

	/** After a pan or zoom. */
	placeAll(): void {
		for (const [node, { el, guide }] of this.lines) this.place(node, el, angleOf(guide));
	}

	remove(node: CanvasNodeLike): void {
		const entry = this.lines.get(node);
		entry?.watch.disconnect();
		entry?.el.remove();
		this.lines.delete(node);
	}

	syncSelection(): void {
		for (const [node, { el }] of this.lines) el.toggleClass("is-selected", this.canvas.selection.has(node));
	}

	destroy(): void {
		for (const { watch } of this.lines.values()) watch.disconnect();
		this.el.remove();
		this.lines.clear();
	}
}

/**
 * Infinite lines: lines at any angle across the whole board, with their own color and
 * thickness (selection toolbar). Each is stored as a small handle card on the line; the line is
 * drawn on a layer under all cards, so it stays visible wherever the handle is.
 */
export const infiniteLinesModule = defineModule({
	id: "infinite-lines",
	name: "infiniteLines.name",
	description: "infiniteLines.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		const layers = new Map<CanvasLike, GuideLayer>();

		/**
		 * Clicking the line far from its handle first slides the handle along the line to the
		 * pointer, so the selection box and toolbar appear where the user clicked.
		 */
		const onLineDown = (node: CanvasNodeLike, evt: PointerEvent) => {
			const canvas = node.canvas;
			if (evt.button !== 0 && evt.pointerType === "mouse") return;
			evt.stopPropagation();
			const guide = ctx.data.node(node).get().guide;
			if (!guide) return;
			if (!canvas.readonly) {
				const on = projectOnLine({ x: node.x + node.width / 2, y: node.y + node.height / 2 }, angleOf(guide), canvas.posFromEvt(evt));
				const pos = { x: Math.round(on.x - node.width / 2), y: Math.round(on.y - node.height / 2) };
				if (Math.abs(pos.x - node.x) > 1 || Math.abs(pos.y - node.y) > 1) {
					node.moveTo(pos);
					node.render();
					canvas.requestSave(false);
				}
			}
			(node as unknown as { onPointerdown(e: PointerEvent): void }).onPointerdown(evt);
		};

		// No edges from a line: the hover layer (resize handles and connection dots, shared by all
		// cards) is marked while it sits on a line's handle, and starting an edge there does nothing.
		const patchedLayers = new WeakSet<object>();
		ctx.onCanvas((canvas) => {
			const layer = (canvas as unknown as { nodeInteractionLayer?: InteractionLayer }).nodeInteractionLayer;
			if (!layer) return;
			const proto = Object.getPrototypeOf(layer) as InteractionLayer;
			if (patchedLayers.has(proto)) return;
			patchedLayers.add(proto);
			ctx.patch("nodeInteractionLayer.setTarget", proto, {
				setTarget: (next) =>
					function (this: InteractionLayer, target: CanvasNodeLike | null) {
						next.call(this, target);
						this.interactionEl.toggleClass("opc-on-guide", !!target && isGuide(target, ctx.data.node(target).get()));
					},
			});
		});
		ctx.register(() => {
			for (const canvas of ctx.canvases()) (canvas as unknown as { nodeInteractionLayer?: InteractionLayer }).nodeInteractionLayer?.interactionEl.removeClass("opc-on-guide");
		});
		const patchedNodes = new WeakSet<object>();
		const patchConnect = (node: CanvasNodeLike) => {
			for (let p = Object.getPrototypeOf(node) as object | null; p && p !== Object.prototype; p = Object.getPrototypeOf(p) as object | null) {
				if (!Object.prototype.hasOwnProperty.call(p, "onConnectionPointerdown") || patchedNodes.has(p)) continue;
				patchedNodes.add(p);
				ctx.patch("node.onConnectionPointerdown", p as ConnectableNode, {
					onConnectionPointerdown: (next) =>
						function (this: ConnectableNode, evt: PointerEvent, side: string) {
							if (isGuide(this, ctx.data.node(this).get())) return;
							next.call(this, evt, side);
						},
				});
			}
		};

		const apply = (node: CanvasNodeLike, extra: Readonly<OpcNode>) => {
			patchConnect(node);
			const layer = layers.get(node.canvas);
			if (isGuide(node, extra)) {
				node.nodeEl.setAttribute("data-opc-kind", "guide");
				node.nodeEl.setAttribute("data-opc-axis", angleOf(extra.guide!) === 90 ? "v" : "h");
				layer?.render(node, extra.guide!);
			} else {
				if (node.nodeEl.getAttribute("data-opc-kind") === "guide") {
					node.nodeEl.removeAttribute("data-opc-kind");
					node.nodeEl.removeAttribute("data-opc-axis");
				}
				layer?.remove(node);
			}
		};
		ctx.onCanvas((canvas) => {
			layers.set(canvas, new GuideLayer(canvas, onLineDown));
			for (const node of canvas.nodes.values()) apply(node, ctx.data.node(node).get());
			return () => {
				layers.get(canvas)?.destroy();
				layers.delete(canvas);
			};
		});

		ctx.decorateNodes({
			apply,
			clear: (node) => {
				if (node.nodeEl.getAttribute("data-opc-kind") === "guide") {
					node.nodeEl.removeAttribute("data-opc-kind");
					node.nodeEl.removeAttribute("data-opc-axis");
				}
				layers.get(node.canvas)?.remove(node);
			},
		});
		ctx.on("node-moved", (node) => {
			const extra = ctx.data.node(node).get();
			if (isGuide(node, extra)) layers.get(node.canvas)?.render(node, extra.guide!);
		});
		ctx.on("node-removed", (node) => layers.get(node.canvas)?.remove(node));
		ctx.on("canvas-frame", (canvas) => layers.get(canvas)?.placeAll());
		// An open angle popover would keep previewing into removed lines.
		ctx.register(closePicker);
		ctx.on("selection-change", (canvas) => layers.get(canvas)?.syncSelection());
		// Lines are not text to edit.
		ctx.intercept("node-start-editing", (node) => (isGuide(node, ctx.data.node(node).get()) ? true : undefined));

		const create = (canvas: CanvasLike, angle: number, center?: { x: number; y: number }) => {
			const v = canvas.getViewportBBox();
			const c = center ?? { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 };
			const guide = withAngle({ axis: "h", width: DEFAULT_WIDTH }, angle);
			const size = handleSize(angleOf(guide));
			const id = randomId();
			mutate(ctx, canvas, () => {
				canvas.importData(
					{ nodes: [{ id, type: "text", text: "", x: Math.round(c.x - size.width / 2), y: Math.round(c.y - size.height / 2), ...size, "x-opc": { kind: "guide", guide } }], edges: [] },
					false,
				);
			});
			const node = canvas.nodes.get(id);
			if (node) canvas.selectOnly(node);
		};

		ctx.addCardMenuButton({
			id: "infinite-line",
			icon: "separator-horizontal",
			tooltip: () => ctx.t("infiniteLines.add.tooltip"),
			order: 110,
			onClick: (canvas) => create(canvas, 0),
			onContextMenu: (canvas, evt) => {
				const menu = new Menu();
				menu.addItem((i) => i.setTitle(ctx.t("infiniteLines.add.h")).setIcon("separator-horizontal").onClick(() => create(canvas, 0)));
				menu.addItem((i) => i.setTitle(ctx.t("infiniteLines.add.v")).setIcon("separator-vertical").onClick(() => create(canvas, 90)));
				menu.showAtMouseEvent(evt);
			},
			drag: { size: () => handleSize(0), drop: (canvas, pos) => create(canvas, 0, { x: pos.x + HANDLE_LONG / 2, y: pos.y + HANDLE_SHORT / 2 }) },
		});
		for (const [suffix, angle] of [["h", 0], ["v", 90]] as const)
			ctx.addCommand({
				id: `add-${suffix}`,
				name: ctx.t(suffix === "h" ? "infiniteLines.add.h" : "infiniteLines.add.v"),
				icon: suffix === "h" ? "separator-horizontal" : "separator-vertical",
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || canvas.readonly) return false;
					if (!checking) create(canvas, angle);
					return true;
				},
			});
		const askAngle = (current: number, done: (angle: number) => void) =>
			new NumberPromptModal(ctx.app, ctx.t, { title: ctx.t("infiniteLines.angle.custom"), help: ctx.t("infiniteLines.angle.help"), value: current, step: 1 }, (v) => {
				if (v !== undefined) done(v);
			}).open();

		/** Turns lines around the middle of their handles. */
		const setAngle = (canvas: CanvasLike, nodes: CanvasNodeLike[], angle: number) => {
			mutate(ctx, canvas, () => {
				for (const n of nodes) {
					const guide = withAngle(ctx.data.node(n).get().guide!, angle);
					const cx = n.x + n.width / 2;
					const cy = n.y + n.height / 2;
					const size = handleSize(angleOf(guide));
					n.moveAndResize({ x: Math.round(cx - size.width / 2), y: Math.round(cy - size.height / 2), ...size });
					ctx.data.node(n).set({ guide });
				}
			});
			canvas.menu.render(true);
		};

		// Selection toolbar: thickness and angle.
		const selectedGuides = (selection: Parameters<typeof onlyNodes>[0]) => {
			const nodes = onlyNodes(selection);
			return nodes && nodes.every((n) => isGuide(n, ctx.data.node(n).get())) ? nodes : null;
		};
		ctx.addMenuButton({
			id: "guide-width",
			icon: "minus",
			tooltip: () => ctx.t("infiniteLines.width"),
			order: 6,
			isVisible: (selection) => !!selectedGuides(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = selectedGuides(selection) ?? [];
				const current = common(nodes, (n) => ctx.data.node(n).get().guide?.width);
				showPicker(
					buttonEl,
					[{ columns: 6, items: WIDTHS.map((w) => ({ id: String(w), label: `${w}px`, svg: widthSwatch(w), active: current === w })) }],
					(id) =>
						mutate(ctx, canvas, () => {
							for (const n of nodes) {
								const guide = ctx.data.node(n).get().guide!;
								ctx.data.node(n).set({ guide: { ...guide, width: Number(id) } });
							}
						}),
				);
			},
		});
		ctx.addMenuButton({
			id: "guide-axis",
			icon: "rotate-cw",
			tooltip: () => ctx.t("infiniteLines.rotate"),
			order: 7,
			isVisible: (selection) => !!selectedGuides(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = selectedGuides(selection) ?? [];
				const current = common(nodes, (n) => angleOf(ctx.data.node(n).get().guide!));
				// From the command palette: presets and a typed angle.
				if ((buttonEl as ChoiceAnchor).opcChoose) {
					showPicker(
						buttonEl,
						[
							{ columns: 6, items: ANGLES.map((a) => ({ id: String(a), label: `${a}°`, svg: angleSwatch(a), active: current === a })) },
							{ columns: 1, items: [{ id: "custom", label: ctx.t("infiniteLines.angle.custom"), icon: "pencil" }] },
						],
						(id) => {
							if (id === "custom") askAngle(current ?? 0, (a) => setAngle(canvas, nodes, a));
							else setAngle(canvas, nodes, Number(id));
						},
					);
					return;
				}
				showAnglePopover(canvas, nodes, buttonEl, current ?? 0);
			},
		});

		/** Slider, number and presets; the lines turn live and each release is one undo step. */
		const showAnglePopover = (canvas: CanvasLike, nodes: CanvasNodeLike[], anchor: HTMLElement, start: number) => {
			const layer = layers.get(canvas);
			const preview = (angle: number) => {
				for (const n of nodes) layer?.render(n, withAngle(ctx.data.node(n).get().guide!, angle));
			};
			// Anything previewed but not applied goes back when the popover closes.
			const restore = () => {
				for (const n of nodes) if (canvas.nodes.has(n.id)) layer?.render(n, ctx.data.node(n).get().guide!);
			};
			showPopover(
				anchor,
				(el) => {
					el.addClass("opc-angle-popover");
					const row = el.createDiv({ cls: "opc-angle-row" });
					const slider = row.createEl("input", { type: "range", cls: "slider", attr: { min: "0", max: "179", step: "1", "aria-label": ctx.t("infiniteLines.rotate") } });
					const number = row.createEl("input", { type: "number", cls: "opc-angle-number", attr: { min: "0", max: "179.9", step: "1", "aria-label": ctx.t("infiniteLines.rotate") } });
					row.createSpan({ text: "°" });
					const presets = el.createDiv({ cls: "opc-picker-grid" });
					presets.setCssProps({ "--opc-picker-columns": "6" });
					const show = (angle: number) => {
						const a = normalizeAngle(angle);
						slider.value = String(Math.round(a));
						if (el.doc.activeElement !== number) number.value = String(a);
						for (const b of Array.from(presets.children)) b.toggleClass("is-active", Number((b as HTMLElement).dataset.angle) === a);
					};
					const commit = (angle: number) => {
						setAngle(canvas, nodes, angle);
						show(angle);
					};
					for (const a of ANGLES) {
						const b = presets.createEl("button", { cls: "opc-picker-item clickable-icon", attr: { "aria-label": `${a}°`, "data-angle": String(a) } });
						b.appendChild(sanitizeHTMLToDom(angleSwatch(a)));
						setTooltip(b, `${a}°`, { placement: "top" });
						b.addEventListener("click", () => commit(a));
					}
					slider.addEventListener("input", () => {
						number.value = slider.value;
						preview(Number(slider.value));
					});
					slider.addEventListener("change", () => commit(Number(slider.value)));
					const typed = () => (number.value.trim() !== "" && Number.isFinite(Number(number.value)) ? Number(number.value) : null);
					number.addEventListener("input", () => {
						const v = typed();
						if (v === null) return;
						slider.value = String(Math.round(normalizeAngle(v)));
						preview(v);
					});
					number.addEventListener("change", () => {
						const v = typed();
						if (v !== null) commit(v);
					});
					number.addEventListener("keydown", (e) => {
						if (e.key === "Enter") number.blur();
					});
					show(start);
					window.setTimeout(() => slider.focus());
				},
				restore,
			);
		};
	},
});

function angleSwatch(angle: number): string {
	const rad = (normalizeAngle(angle) * Math.PI) / 180;
	const dx = 10 * Math.cos(rad);
	const dy = 10 * Math.sin(rad);
	return `<svg viewBox="0 0 24 24" width="20" height="20"><line x1="${12 - dx}" y1="${12 - dy}" x2="${12 + dx}" y2="${12 + dy}" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
}

function widthSwatch(width: number): string {
	return `<svg viewBox="0 0 24 24" width="20" height="20"><line x1="2" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="${Math.min(width, 12)}" stroke-linecap="round"/></svg>`;
}
