import { ItemView, Menu, Notice, setIcon, setTooltip, type WorkspaceLeaf } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { SCHEMA_KEY, type LayerInfo } from "../../data/schema";
import type { CanvasItemLike, CanvasLike, CanvasNodeLike } from "../../internals/types";
import { ChoiceModal } from "../../ui/choice-modal";
import { TextPromptModal } from "../../ui/text-prompt";
import { CONNECTOR, CONNECTOR_Z } from "../free-lines/render";
import { mutate, nodeType, onlyNodes, randomId, renderedZ, selectedNodes } from "../shared";
import { BASE_LAYER, cardZ, groupZ, heirOf, layerIndex, layersOf, MAX_LAYERS, moveLayer, neighborLayer, nextLayerName } from "./logic";

export const LAYERS_VIEW = "opc-layers";

/**
 * Layered z-indexes go far above the core's own counter, which the hover layer (resize handles),
 * snapping guides and dragged cards use to stay on top: those get this value instead.
 */
const ABOVE_LAYERS = 2147483000;

/** Obsidian's hover layer over a card (resize handles, connection dots). */
interface InteractionLayer {
	interactionEl: HTMLElement;
	render(): void;
}
type SnappingCanvas = CanvasLike & { snapContainerEl?: SVGElement | null; renderSnapPoints(...args: unknown[]): void };
/** The core's geometric queries: hover target, selection box, snapping, edge targets, group contents, virtualization. */
type HitTestingCanvas = CanvasLike & { hitTestNode(pos: { x: number; y: number }, margin?: number): CanvasNodeLike | null; nodeIndex: { search(bbox: BBoxLike): CanvasNodeLike[] } };
type BBoxLike = { minX: number; minY: number; maxX: number; maxY: number };

type Ctx = ModuleContext<Record<string, never>>;

/** The stored layer id of a node, read straight from its data (fast, also for nodes off screen). */
function storedLayer(node: CanvasNodeLike): string | undefined {
	const layer = (node.unknownData[SCHEMA_KEY] as { layer?: unknown } | undefined)?.layer;
	return typeof layer === "string" ? layer : undefined;
}

/** Per-canvas layer state, rebuilt whenever the canvas root data changes. */
class LayerState {
	private readonly cache = new WeakMap<CanvasLike, LayerInfo[]>();
	/** New items until their layer is stored: they already count as on the active layer. */
	readonly pending = new WeakSet<CanvasNodeLike>();

	constructor(private readonly ctx: Ctx) {}

	layers(canvas: CanvasLike): LayerInfo[] {
		let layers = this.cache.get(canvas);
		if (!layers) {
			layers = layersOf(this.ctx.data.root(canvas).get().layers, this.ctx.t("layers.defaultName", { n: 1 }));
			this.cache.set(canvas, layers);
		}
		return layers;
	}

	invalidate(canvas: CanvasLike): void {
		this.cache.delete(canvas);
	}

	/** Items without a layer are on the base layer (or the bottom one once it is gone). */
	indexOf(node: CanvasNodeLike): number {
		const layers = this.layers(node.canvas);
		const stored = storedLayer(node);
		if (!stored && this.pending.has(node)) return layers.indexOf(this.active(node.canvas));
		return layerIndex(layers, stored ?? BASE_LAYER);
	}

	layerOf(node: CanvasNodeLike): LayerInfo {
		return this.layers(node.canvas)[this.indexOf(node)]!;
	}

	active(canvas: CanvasLike): LayerInfo {
		const layers = this.layers(canvas);
		const id = this.ctx.data.root(canvas).get().activeLayer;
		return layers.find((l) => l.id === id) ?? layers[layers.length - 1]!;
	}

	/** True when the canvas has more than its single implicit layer. */
	layered(canvas: CanvasLike): boolean {
		return this.layers(canvas).length > 1;
	}
}

/** The selected nodes, plus everything inside selected groups (a group moves with its contents). */
function withGroupContents(canvas: CanvasLike, nodes: CanvasNodeLike[]): CanvasNodeLike[] {
	const out = new Set(nodes);
	for (const n of nodes) if (nodeType(n) === "group") for (const inner of canvas.getContainingNodes(n.getBBox())) out.add(inner);
	return [...out];
}

class LayersView extends ItemView {
	private canvas: CanvasLike | null = null;
	private listEl!: HTMLElement;
	private footerEl!: HTMLElement;
	private timer = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: Ctx,
		private readonly state: LayerState,
		private readonly actions: LayerActions,
	) {
		super(leaf);
	}

	getViewType(): string {
		return LAYERS_VIEW;
	}

	getDisplayText(): string {
		return this.ctx.t("layers.title");
	}

	override getIcon(): string {
		return "layers";
	}

	protected override async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("opc-layers-view");
		const header = root.createDiv({ cls: "opc-layers-header" });
		header.createSpan({ cls: "opc-layers-heading", text: this.ctx.t("layers.title") });
		const add = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": this.ctx.t("layers.new") } });
		setIcon(add, "plus");
		setTooltip(add, this.ctx.t("layers.new"));
		add.addEventListener("click", () => this.canvas && this.actions.create(this.canvas, false));
		const addWith = header.createEl("button", { cls: "clickable-icon", attr: { "aria-label": this.ctx.t("layers.newFromSelection") } });
		setIcon(addWith, "copy-plus");
		setTooltip(addWith, this.ctx.t("layers.newFromSelection"));
		addWith.addEventListener("click", () => this.canvas && this.actions.create(this.canvas, true));
		this.listEl = root.createDiv({ cls: "opc-layers-list", attr: { role: "list" } });
		this.footerEl = root.createDiv({ cls: "opc-layers-footer" });
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.track()));
		this.track(true);
	}

	/**
	 * Follows the most recently active canvas. Clicking into the panel makes it the active leaf:
	 * rebuilding the rows then would swallow that first click, so only a new canvas re-renders.
	 */
	track(force = false): void {
		const prev = this.canvas;
		const leaf = this.app.workspace.getMostRecentLeaf();
		const view = leaf?.view as { getViewType(): string; canvas?: CanvasLike } | undefined;
		if (view?.getViewType() === "canvas" && view.canvas) this.canvas = view.canvas;
		else if (this.canvas && !this.canvas.wrapperEl.isConnected) this.canvas = null;
		if (force || this.canvas !== prev) this.render();
	}

	refresh(canvas: CanvasLike): void {
		if (canvas !== this.canvas || this.timer) return;
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			this.render();
		}, 80);
	}

	render(): void {
		if (!this.listEl) return;
		this.listEl.empty();
		this.footerEl.empty();
		const canvas = this.canvas;
		if (!canvas) {
			this.listEl.createDiv({ cls: "pane-empty", text: this.ctx.t("layers.noCanvas") });
			return;
		}
		const { ctx, state, actions } = this;
		const layers = state.layers(canvas);
		const active = state.active(canvas);
		const counts = new Map<string, number>();
		const selected = new Set<string>();
		for (const n of canvas.nodes.values()) {
			const id = state.layerOf(n).id;
			counts.set(id, (counts.get(id) ?? 0) + 1);
			if (canvas.selection.has(n)) selected.add(id);
		}
		const editable = !canvas.readonly;
		// Top layer first, like Photoshop.
		for (let index = layers.length - 1; index >= 0; index--) {
			const layer = layers[index]!;
			const row = this.listEl.createDiv({ cls: "opc-layers-item tree-item-self is-clickable", attr: { role: "listitem", draggable: String(editable), tabindex: "0", "data-layer": layer.id } });
			row.toggleClass("is-active", layer.id === active.id);
			row.toggleClass("has-selection", selected.has(layer.id));
			row.toggleClass("is-hidden-layer", !!layer.hidden);

			const eye = row.createDiv({ cls: "clickable-icon opc-layers-toggle", attr: { "aria-label": ctx.t(layer.hidden ? "layers.show" : "layers.hide") } });
			setIcon(eye, layer.hidden ? "eye-off" : "eye");
			eye.addEventListener("click", (e) => {
				e.stopPropagation();
				actions.update(canvas, layer.id, { hidden: !layer.hidden || undefined });
			});
			const lock = row.createDiv({ cls: "clickable-icon opc-layers-toggle", attr: { "aria-label": ctx.t(layer.locked ? "layers.unlock" : "layers.lock") } });
			setIcon(lock, layer.locked ? "lock" : "lock-open");
			lock.toggleClass("is-off", !layer.locked);
			lock.addEventListener("click", (e) => {
				e.stopPropagation();
				actions.update(canvas, layer.id, { locked: !layer.locked || undefined });
			});

			row.createSpan({ cls: "opc-layers-name", text: layer.name });
			row.createSpan({ cls: "opc-layers-count", text: String(counts.get(layer.id) ?? 0) });

			const here = row.createDiv({ cls: "clickable-icon opc-layers-here", attr: { "aria-label": ctx.t("layers.moveHere") } });
			setIcon(here, "log-in");
			setTooltip(here, ctx.t("layers.moveHere"));
			here.toggleClass("is-disabled", selectedNodes(canvas).length === 0);
			here.addEventListener("click", (e) => {
				e.stopPropagation();
				actions.moveTo(canvas, selectedNodes(canvas), layer.id);
			});

			row.addEventListener("click", () => actions.setActive(canvas, layer.id));
			// Quick clicks on the eye, lock or "move here" buttons are not a rename.
			row.addEventListener("dblclick", (e) => {
				if (!(e.target as HTMLElement).closest(".clickable-icon")) actions.rename(canvas, layer.id);
			});
			row.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					actions.setActive(canvas, layer.id);
				} else if (e.key === "F2") actions.rename(canvas, layer.id);
			});
			row.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				actions.rowMenu(canvas, layer.id).showAtMouseEvent(e);
			});
			if (!editable) continue;
			row.addEventListener("dragstart", (e) => {
				e.dataTransfer?.setData("text/plain", String(index));
				row.addClass("is-dragging");
			});
			row.addEventListener("dragend", () => row.removeClass("is-dragging"));
			row.addEventListener("dragover", (e) => {
				e.preventDefault();
				const r = row.getBoundingClientRect();
				row.toggleClass("drop-before", e.clientY < r.top + r.height / 2);
				row.toggleClass("drop-after", e.clientY >= r.top + r.height / 2);
			});
			row.addEventListener("dragleave", () => row.removeClasses(["drop-before", "drop-after"]));
			row.addEventListener("drop", (e) => {
				e.preventDefault();
				const from = Number(e.dataTransfer?.getData("text/plain"));
				const r = row.getBoundingClientRect();
				// The list runs top to bottom, the stored order bottom to top.
				const above = e.clientY < r.top + r.height / 2;
				row.removeClasses(["drop-before", "drop-after"]);
				if (!Number.isInteger(from)) return;
				let to = above ? index + 1 : index;
				if (from < to) to--;
				if (to !== from) actions.reorder(canvas, from, to);
			});
		}
		const sel = selectedNodes(canvas);
		if (sel.length > 0) {
			const names = [...new Set(sel.map((n) => state.layerOf(n).name))];
			this.footerEl.setText(ctx.t("layers.selectionOn", { layers: names.join(", ") }));
		} else this.footerEl.setText(ctx.t("layers.hint"));
	}

	protected override async onClose(): Promise<void> {
		window.clearTimeout(this.timer);
	}
}

interface LayerActions {
	create(canvas: CanvasLike, withSelection: boolean): void;
	update(canvas: CanvasLike, id: string, patch: Partial<Omit<LayerInfo, "id">>): void;
	setActive(canvas: CanvasLike, id: string): void;
	rename(canvas: CanvasLike, id: string): void;
	reorder(canvas: CanvasLike, from: number, to: number): void;
	moveTo(canvas: CanvasLike, nodes: CanvasNodeLike[], id: string): void;
	rowMenu(canvas: CanvasLike, id: string): Menu;
}

/**
 * Layers, like in image editors: items sit on named layers; everything on a higher layer is drawn
 * above everything on a lower one. Layers can be hidden, locked, renamed, reordered and deleted
 * in the Layers panel; the selection moves to a layer, or one layer up or down, from the
 * selection toolbar, the context menu or commands. New items go to the active layer. Groups stay
 * behind cards (so their contents stay visible) and are ordered by layer among themselves; a
 * group moves to another layer together with the items inside it.
 */
export const layersModule = defineModule({
	id: "layers",
	name: "layers.name",
	description: "layers.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const state = new LayerState(ctx);
		const views = () => ctx.app.workspace.getLeavesOfType(LAYERS_VIEW).map((l) => l.view as LayersView);
		const refreshPanel = (canvas: CanvasLike) => views().forEach((v) => v.refresh(canvas));

		// ---------- locked and hidden layers ----------

		const blocked = (node: CanvasNodeLike) => {
			// A card being built (the core sizes and places it before adding it) is on no layer yet.
			if (node.canvas.nodes.get(node.id) !== node) return false;
			const layer = state.layerOf(node);
			return !!layer.locked || !!layer.hidden;
		};
		const hidden = (node: CanvasNodeLike) => node.canvas.nodes.get(node.id) === node && !!state.layerOf(node).hidden;
		ctx.intercept("node-pointerdown", (node) => (blocked(node) ? true : undefined));
		ctx.intercept("node-move", (node) => (blocked(node) ? true : undefined));
		ctx.intercept("node-start-editing", (node) => (blocked(node) ? true : undefined));
		/** A selection box or Select all never picks items of locked or hidden layers. */
		const pruneSelection = (canvas: CanvasLike) => {
			const drop = [...canvas.selection].filter((item): item is CanvasNodeLike => canvas.nodes.get(item.id) === item && blocked(item));
			if (drop.length > 0) canvas.updateSelection(() => drop.forEach((n) => canvas.selection.delete(n)));
		};
		ctx.on("selection-change", (canvas) => {
			pruneSelection(canvas);
			refreshPanel(canvas);
		});

		// ---------- drawing order and visibility ----------

		/** Classes for hidden / locked layers; edges of hidden cards hide with them. */
		const decorate = (node: CanvasNodeLike) => {
			const layer = state.layerOf(node);
			node.nodeEl.toggleClass("opc-layer-hidden", !!layer.hidden);
			node.nodeEl.toggleAttribute("data-opc-layer-locked", !!layer.locked);
		};
		const decorateEdges = (canvas: CanvasLike) => {
			for (const e of canvas.edges.values()) {
				const hidden = e.from.node.nodeEl.hasClass("opc-layer-hidden") || e.to.node.nodeEl.hasClass("opc-layer-hidden");
				e.lineGroupEl.toggleClass("opc-layer-hidden", hidden);
				e.lineEndGroupEl.toggleClass("opc-layer-hidden", hidden);
				e.labelElement?.wrapperEl.toggleClass("opc-layer-hidden", hidden);
			}
		};
		const refreshCanvas = (canvas: CanvasLike) => {
			state.invalidate(canvas);
			canvas.wrapperEl.toggleClass("opc-has-layers", state.layered(canvas));
			for (const n of canvas.nodes.values()) {
				decorate(n);
				n.renderZIndex();
			}
			decorateEdges(canvas);
			pruneSelection(canvas);
			// Shown or hidden layers mount or unmount their cards on the next frame.
			canvas.markViewportChanged();
			refreshPanel(canvas);
		};

		// The core's own z-index, moved into the node's layer band. Patched on every prototype that
		// defines renderZIndex (the base node and groups).
		const patchedProtos = new WeakSet<object>();
		const patchZ = (node: CanvasNodeLike) => {
			for (let proto = Object.getPrototypeOf(node) as object | null; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
				if (!Object.prototype.hasOwnProperty.call(proto, "renderZIndex") || patchedProtos.has(proto)) continue;
				patchedProtos.add(proto);
				ctx.patch("node.renderZIndex", proto as CanvasNodeLike, {
					renderZIndex: (next) =>
						function (this: CanvasNodeLike) {
							// The core skips the style write when its value didn't change; ours may have.
							(this as unknown as { renderedZIndex?: number }).renderedZIndex = Number.NaN;
							next.call(this);
							if (!state.layered(this.canvas)) return;
							const index = state.indexOf(this);
							// Drawn connectors stay under all cards (see free-lines).
							const z = this.nodeEl.hasAttribute(CONNECTOR)
								? CONNECTOR_Z
								: this.nodeEl.hasClass("is-dragging")
									? ABOVE_LAYERS
									: nodeType(this) === "group"
										? groupZ(index, this.width * this.height)
										: cardZ(index, this.canvas.selection.size === 1 && this.canvas.selection.has(this) ? this.canvas.zIndexCounter + 1 : this.zIndex);
							this.nodeEl.style.zIndex = String(z);
						},
				});
			}
		};

		ctx.decorateNodes({
			apply: (node) => {
				patchZ(node);
				decorate(node);
			},
			clear: (node) => {
				node.nodeEl.removeClass("opc-layer-hidden");
				node.nodeEl.removeAttribute("data-opc-layer-locked");
			},
		});
		ctx.onCanvas((canvas) => {
			for (const n of canvas.nodes.values()) patchZ(n);
			refreshCanvas(canvas);
			const controls = canvas.wrapperEl.querySelector(".canvas-controls");
			const group = controls?.createDiv({ cls: "canvas-control-group mod-raised opc-layers-control" });
			if (group) {
				const item = group.createDiv({ cls: "canvas-control-item", attr: { "aria-label": ctx.t("layers.open") } });
				setIcon(item, "layers");
				setTooltip(item, ctx.t("layers.open"), { placement: "left" });
				item.addEventListener("click", () => void openPanel());
			}
			return () => {
				group?.remove();
				canvas.wrapperEl.removeClass("opc-has-layers");
				for (const e of canvas.edges.values()) {
					e.lineGroupEl.removeClass("opc-layer-hidden");
					e.lineEndGroupEl.removeClass("opc-layer-hidden");
					e.labelElement?.wrapperEl.removeClass("opc-layer-hidden");
				}
				// Back to the core's own order (our patch is gone by then on disable).
				window.setTimeout(() => canvas.nodes.forEach((n) => n.renderZIndex()));
			};
		});
		ctx.on("root-extra-change", refreshCanvas);
		ctx.on("data-load", refreshCanvas);
		ctx.on("history-apply", (canvas) => refreshCanvas(canvas));
		ctx.on("node-extra-change", (node) => {
			decorate(node);
			node.renderZIndex();
			decorateEdges(node.canvas);
			refreshPanel(node.canvas);
		});
		ctx.on("node-removed", (node) => refreshPanel(node.canvas));
		ctx.on("edge-added", (edge) => decorateEdges(edge.canvas));

		// ---------- new items go to the active layer ----------

		// Loading a file or undoing must not reassign layers: count those calls.
		let replaying = 0;
		const patchedCanvas = new WeakSet<object>();
		ctx.onCanvas((canvas) => {
			const proto = Object.getPrototypeOf(canvas) as CanvasLike;
			if (patchedCanvas.has(proto)) return;
			patchedCanvas.add(proto);
			const guard =
				<A extends unknown[], R>(next: (...args: A) => R) =>
				function (this: CanvasLike, ...args: A): R {
					replaying++;
					try {
						return next.apply(this, args);
					} finally {
						replaying--;
					}
				};
			ctx.patch("canvas.setData/applyHistory (layers)", proto, { setData: guard, applyHistory: guard });
			// Hidden layers are gone for the core too, like a new board: no hover handles, snapping, edge
			// targets, selection box or group contents from them (and they are not even mounted).
			const visible = (nodes: CanvasNodeLike[]) => nodes.filter((n) => !hidden(n));
			ctx.patch("canvas hit testing (layers)", proto as HitTestingCanvas, {
				getIntersectingNodes: (next) =>
					function (this: HitTestingCanvas, bbox: BBoxLike) {
						const nodes = next.call(this, bbox);
						return state.layered(this) ? visible(nodes) : nodes;
					},
				getContainingNodes: (next) =>
					function (this: HitTestingCanvas, bbox: BBoxLike) {
						const nodes = next.call(this, bbox);
						return state.layered(this) ? visible(nodes) : nodes;
					},
				// The core picks the top card by its own counter; layers draw in another order.
				hitTestNode: (next) =>
					function (this: HitTestingCanvas, pos: { x: number; y: number }, margin = 0) {
						if (!state.layered(this)) return next.call(this, pos, margin);
						const hits = this.nodeIndex.search({ minX: pos.x - margin, minY: pos.y - margin, maxX: pos.x + margin, maxY: pos.y + margin }).filter((n) => !blocked(n));
						hits.sort((a, b) => renderedZ(b) - renderedZ(a));
						return hits[0] ?? null;
					},
			});
			ctx.patch("canvas.renderSnapPoints (layers)", proto as SnappingCanvas, {
				renderSnapPoints: (next) =>
					function (this: SnappingCanvas, ...args: unknown[]) {
						next.apply(this, args);
						if (this.snapContainerEl && state.layered(this)) this.snapContainerEl.style.zIndex = String(ABOVE_LAYERS + 1);
					},
			});
		});

		// The hover layer is placed with the core's counter on every render.
		const patchedHover = new WeakSet<object>();
		ctx.onCanvas((canvas) => {
			const layer = (canvas as unknown as { nodeInteractionLayer?: InteractionLayer }).nodeInteractionLayer;
			if (!layer) return;
			const proto = Object.getPrototypeOf(layer) as InteractionLayer;
			if (patchedHover.has(proto)) return;
			patchedHover.add(proto);
			ctx.patch("nodeInteractionLayer.render (layers)", proto, {
				render: (next) =>
					function (this: InteractionLayer & { canvas: CanvasLike }) {
						next.call(this);
						if (state.layered(this.canvas)) this.interactionEl.style.zIndex = String(ABOVE_LAYERS);
					},
			});
		});

		// Dragged cards were lifted above every layer: back into their layer once released.
		ctx.onCanvas((canvas) => {
			const settle = () =>
				window.setTimeout(() => {
					for (const n of canvas.nodes.values()) if (n.nodeEl.style.zIndex === String(ABOVE_LAYERS)) n.renderZIndex();
				});
			canvas.wrapperEl.addEventListener("pointerup", settle, true);
			canvas.wrapperEl.addEventListener("pointercancel", settle, true);
			return () => {
				canvas.wrapperEl.removeEventListener("pointerup", settle, true);
				canvas.wrapperEl.removeEventListener("pointercancel", settle, true);
			};
		});
		ctx.on("node-added", (node) => {
			if (replaying > 0) return;
			const canvas = node.canvas;
			// Editing and selecting a new card start before its layer is stored: until then it counts as
			// on the active layer (a hidden or locked bottom layer would block it).
			state.pending.add(node);
			// Pasted or imported items get their data right after being added: decide once it's there.
			queueMicrotask(() => {
				state.pending.delete(node);
				if (!canvas.nodes.has(node.id) || storedLayer(node) || !state.layered(canvas)) return;
				const layers = state.layers(canvas);
				const active = state.active(canvas);
				try {
					if (layerIndex(layers, BASE_LAYER) !== layers.indexOf(active)) ctx.data.node(node).set({ layer: active.id }, { history: false });
					// Adding to a hidden or locked layer would make the new item vanish or freeze at once.
					if (active.hidden || active.locked) {
						const next = layers.map((l) => (l.id === active.id ? { id: l.id, name: l.name } : l));
						ctx.data.root(canvas).set({ layers: next }, { history: false });
						new Notice(ctx.t("layers.revealed", { name: active.name }));
					}
				} catch (error) {
					console.error("[overpowered-canvas] layers: could not place a new item on the active layer", error);
				}
			});
		});

		// ---------- actions ----------

		const save = (canvas: CanvasLike, layers: LayerInfo[], activeLayer?: string) =>
			mutate(ctx, canvas, () => ctx.data.root(canvas).set({ layers, activeLayer: activeLayer ?? ctx.data.root(canvas).get().activeLayer }));

		const actions: LayerActions = {
			create: (canvas, withSelection) => {
				const layers = state.layers(canvas);
				if (layers.length >= MAX_LAYERS) {
					new Notice(ctx.t("layers.tooMany", { n: MAX_LAYERS }));
					return;
				}
				const layer: LayerInfo = { id: randomId(8), name: nextLayerName(layers, (n) => ctx.t("layers.defaultName", { n })) };
				const nodes = withSelection ? withGroupContents(canvas, selectedNodes(canvas)) : [];
				mutate(ctx, canvas, () => {
					// Above the active layer, like image editors.
					const at = layers.indexOf(state.active(canvas)) + 1;
					const next = [...layers];
					next.splice(at, 0, layer);
					ctx.data.root(canvas).set({ layers: next, activeLayer: layer.id });
					for (const n of nodes) ctx.data.node(n).set({ layer: layer.id });
				});
			},
			update: (canvas, id, patch) => {
				const layers = state.layers(canvas).map((l) => {
					if (l.id !== id) return l;
					const next: LayerInfo = { ...l, ...patch };
					for (const key of Object.keys(next) as (keyof LayerInfo)[]) if (next[key] === undefined) delete next[key];
					return next;
				});
				save(canvas, layers);
			},
			setActive: (canvas, id) => {
				if (state.active(canvas).id === id) return;
				// Not an undo step: it's a tool choice, not a change to the board.
				try {
					if (!state.layered(canvas)) return;
					ctx.data.root(canvas).set({ activeLayer: id }, { history: false });
				} catch (error) {
					console.error("[overpowered-canvas] layers: could not set the active layer", error);
				}
			},
			rename: (canvas, id) => {
				const layer = state.layers(canvas).find((l) => l.id === id);
				if (!layer || canvas.readonly) return;
				new TextPromptModal(ctx.app, ctx.t, { title: ctx.t("layers.rename"), value: layer.name }, (value) => {
					const name = value.trim();
					if (name && name !== layer.name) actions.update(canvas, id, { name });
				}).open();
			},
			reorder: (canvas, from, to) => save(canvas, moveLayer(state.layers(canvas), from, to)),
			moveTo: (canvas, nodes, id) => {
				const all = withGroupContents(canvas, nodes);
				if (all.length === 0) {
					new Notice(ctx.t("common.selectNodes"));
					return;
				}
				mutate(ctx, canvas, () => {
					// The implicit layer becomes a stored one the first time something moves.
					if (!ctx.data.root(canvas).get().layers) ctx.data.root(canvas).set({ layers: state.layers(canvas) });
					for (const n of all) ctx.data.node(n).set({ layer: id });
				});
			},
			rowMenu: (canvas, id) => {
				const menu = new Menu();
				const layers = state.layers(canvas);
				const index = layerIndex(layers, id);
				const editable = !canvas.readonly;
				menu.addItem((i) => i.setTitle(ctx.t("layers.rename")).setIcon("pencil").setDisabled(!editable).onClick(() => actions.rename(canvas, id)));
				menu.addItem((i) =>
					i
						.setTitle(ctx.t("layers.moveHere"))
						.setIcon("log-in")
						.setDisabled(!editable || selectedNodes(canvas).length === 0)
						.onClick(() => actions.moveTo(canvas, selectedNodes(canvas), id)),
				);
				menu.addItem((i) => i.setTitle(ctx.t("layers.selectItems")).setIcon("mouse-pointer-2").onClick(() => selectLayer(canvas, id)));
				menu.addSeparator();
				menu.addItem((i) => i.setTitle(ctx.t("layers.raise")).setIcon("arrow-up").setDisabled(!editable || index >= layers.length - 1).onClick(() => actions.reorder(canvas, index, index + 1)));
				menu.addItem((i) => i.setTitle(ctx.t("layers.lower")).setIcon("arrow-down").setDisabled(!editable || index <= 0).onClick(() => actions.reorder(canvas, index, index - 1)));
				menu.addSeparator();
				menu.addItem((i) =>
					i
						.setTitle(ctx.t("layers.delete"))
						.setIcon("trash-2")
						.setWarning(true)
						.setDisabled(!editable || layers.length < 2)
						.onClick(() => deleteLayer(canvas, id)),
				);
				return menu;
			},
		};

		const selectLayer = (canvas: CanvasLike, id: string) => {
			const layer = state.layers(canvas).find((l) => l.id === id);
			if (!layer || layer.hidden || layer.locked) {
				new Notice(ctx.t("layers.cantSelect"));
				return;
			}
			const nodes = [...canvas.nodes.values()].filter((n) => state.layerOf(n).id === id);
			canvas.deselectAll();
			canvas.updateSelection(() => nodes.forEach((n) => canvas.selection.add(n)));
		};

		/** Deleting a layer keeps its items: they move to the layer below (or above). */
		const deleteLayer = (canvas: CanvasLike, id: string) => {
			const layers = state.layers(canvas);
			const heir = heirOf(layers, id);
			if (!heir) return;
			const items = [...canvas.nodes.values()].filter((n) => state.layerOf(n).id === id);
			mutate(ctx, canvas, () => {
				for (const n of items) ctx.data.node(n).set({ layer: heir.id });
				const rest = layers.filter((l) => l.id !== id);
				const activeLayer = ctx.data.root(canvas).get().activeLayer;
				if (rest.length === 1 && rest[0]!.id === BASE_LAYER && !rest[0]!.hidden && !rest[0]!.locked) {
					// Back to a canvas without layers: drop the data altogether.
					ctx.data.root(canvas).set({ layers: undefined, activeLayer: undefined });
					for (const n of canvas.nodes.values()) if (storedLayer(n)) ctx.data.node(n).set({ layer: undefined });
				} else ctx.data.root(canvas).set({ layers: rest, activeLayer: activeLayer === id ? heir.id : activeLayer });
			});
		};

		/** One layer up / down for each selected item (and the contents of selected groups). */
		const step = (canvas: CanvasLike, nodes: CanvasNodeLike[], delta: 1 | -1) => {
			const all = withGroupContents(canvas, nodes);
			if (all.length === 0) return;
			const layers = state.layers(canvas);
			const moves = all.map((n) => [n, neighborLayer(layers, state.layerOf(n).id, delta)] as const).filter((m): m is readonly [CanvasNodeLike, LayerInfo] => !!m[1]);
			if (moves.length === 0) {
				new Notice(ctx.t(delta === 1 ? "layers.atTop" : "layers.atBottom"));
				return;
			}
			mutate(ctx, canvas, () => {
				for (const [n, layer] of moves) ctx.data.node(n).set({ layer: layer.id });
			});
		};

		/** The "move to layer" choices, plus a new layer. */
		const chooseLayer = (canvas: CanvasLike, nodes: CanvasNodeLike[], anchor?: { x: number; y: number } | MouseEvent) => {
			const layers = state.layers(canvas);
			const current = new Set(withGroupContents(canvas, nodes).map((n) => state.layerOf(n).id));
			const fill = (menu: Menu) => {
				for (const layer of [...layers].reverse())
					menu.addItem((i) =>
						i
							.setTitle(layer.name)
							.setIcon(layer.hidden ? "eye-off" : layer.locked ? "lock" : "layers")
							.setChecked(current.size === 1 && current.has(layer.id))
							.onClick(() => actions.moveTo(canvas, nodes, layer.id)),
					);
				menu.addSeparator();
				menu.addItem((i) => i.setTitle(ctx.t("layers.up")).setIcon("arrow-up").onClick(() => step(canvas, nodes, 1)));
				menu.addItem((i) => i.setTitle(ctx.t("layers.down")).setIcon("arrow-down").onClick(() => step(canvas, nodes, -1)));
				menu.addItem((i) => i.setTitle(ctx.t("layers.newFromSelection")).setIcon("copy-plus").onClick(() => actions.create(canvas, true)));
			};
			if (!anchor) {
				new ChoiceModal(
					ctx.app,
					ctx.t("layers.moveTo"),
					[...layers].reverse().map((l) => ({ id: l.id, label: l.name, icon: "layers", active: current.size === 1 && current.has(l.id) })),
					(id) => actions.moveTo(canvas, nodes, id),
				).open();
				return;
			}
			const menu = new Menu();
			fill(menu);
			if (anchor instanceof MouseEvent) menu.showAtMouseEvent(anchor);
			else menu.showAtPosition(anchor);
		};

		ctx.addMenuButton({
			id: "layer",
			command: false,
			icon: "layers",
			tooltip: () => ctx.t("layers.button"),
			order: 85,
			isVisible: (selection: CanvasItemLike[]) => !!onlyNodes(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const r = buttonEl.getBoundingClientRect();
				chooseLayer(canvas, onlyNodes(selection) ?? [], { x: r.left, y: r.bottom + 4 });
			},
		});

		const addContextItems = (menu: Menu, canvas: CanvasLike, nodes: CanvasNodeLike[]) => {
			if (canvas.readonly || nodes.length === 0) return;
			menu.addItem((item) => {
				item.setSection("opc-arrange").setTitle(ctx.t("layers.moveTo")).setIcon("layers");
				const sub = (item as unknown as { setSubmenu?(): Menu }).setSubmenu?.();
				if (sub) {
					const layers = state.layers(canvas);
					const current = new Set(withGroupContents(canvas, nodes).map((n) => state.layerOf(n).id));
					for (const layer of [...layers].reverse())
						sub.addItem((i) => i.setTitle(layer.name).setChecked(current.size === 1 && current.has(layer.id)).onClick(() => actions.moveTo(canvas, nodes, layer.id)));
					sub.addSeparator();
					sub.addItem((i) => i.setTitle(ctx.t("layers.newFromSelection")).setIcon("copy-plus").onClick(() => actions.create(canvas, true)));
				} else item.onClick(() => chooseLayer(canvas, nodes));
			});
			menu.addItem((i) => i.setSection("opc-arrange").setTitle(ctx.t("layers.up")).setIcon("arrow-up").onClick(() => step(canvas, nodes, 1)));
			menu.addItem((i) => i.setSection("opc-arrange").setTitle(ctx.t("layers.down")).setIcon("arrow-down").onClick(() => step(canvas, nodes, -1)));
		};
		ctx.onNodeMenu((menu, node) => addContextItems(menu, node.canvas, node.canvas.selection.has(node) ? selectedNodes(node.canvas) : [node]));
		ctx.onSelectionMenu((menu, canvas) => addContextItems(menu, canvas, selectedNodes(canvas)));

		// ---------- panel and commands ----------

		ctx.registerView(LAYERS_VIEW, (leaf) => new LayersView(leaf, ctx, state, actions));
		const openPanel = async () => {
			const existing = ctx.app.workspace.getLeavesOfType(LAYERS_VIEW)[0];
			if (existing) return ctx.app.workspace.revealLeaf(existing);
			const leaf = ctx.app.workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: LAYERS_VIEW, active: true });
			await ctx.app.workspace.revealLeaf(leaf);
		};

		const withSelection = (id: string, name: string, icon: string, run: (canvas: CanvasLike, nodes: CanvasNodeLike[]) => void) =>
			ctx.addCommand({
				id,
				name,
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					const nodes = canvas ? selectedNodes(canvas) : [];
					if (!canvas || canvas.readonly || nodes.length === 0) return false;
					if (!checking) run(canvas, nodes);
					return true;
				},
			});
		ctx.addCommand({ id: "open", name: ctx.t("layers.open"), icon: "layers", callback: () => void openPanel() });
		withSelection("move-to", ctx.t("layers.moveTo"), "layers", (canvas, nodes) => chooseLayer(canvas, nodes));
		withSelection("up", ctx.t("layers.up"), "arrow-up", (canvas, nodes) => step(canvas, nodes, 1));
		withSelection("down", ctx.t("layers.down"), "arrow-down", (canvas, nodes) => step(canvas, nodes, -1));
		ctx.addCommand({
			id: "new",
			name: ctx.t("layers.new"),
			icon: "plus",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) actions.create(canvas, selectedNodes(canvas).length > 0);
				return true;
			},
		});
	},
});

