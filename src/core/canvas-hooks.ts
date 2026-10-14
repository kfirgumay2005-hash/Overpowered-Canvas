/**
 * Shared, reference-counted hooks into Obsidian's canvas classes.
 *
 * Modules subscribe to named hooks; the hub installs the prototype patches a hook needs only
 * while at least one listener exists and removes them when the last one leaves. With every
 * module disabled there are no listeners, hence zero patches.
 *
 * Prototypes are taken from live objects: the canvas (and its popup menu and view) from any
 * open canvas view, the node and edge base classes from the first node/edge seen. When a
 * canvas has no nodes yet, a temporary addNode/addEdge patch captures them on creation.
 * Every member touched here is documented in docs/INTERNALS.md.
 */
import type { CanvasFileData } from "../data/json-canvas";
import type { CanvasEdgeLike, CanvasLike, CanvasMenuLike, CanvasNodeLike, CanvasViewLike } from "../internals/types";
import type { CanvasTracker } from "./canvas-tracker";
import type { PatchFactories, Patcher } from "./patcher";

export interface HookMap {
	/** After node.render() (base class). */
	"node-render": [node: CanvasNodeLike];
	/** After node.setData() — load, paste, undo/redo. */
	"node-set-data": [node: CanvasNodeLike];
	/** After our own x-opc write on a node. */
	"node-extra-change": [node: CanvasNodeLike];
	"node-added": [node: CanvasNodeLike];
	"node-removed": [node: CanvasNodeLike];
	/** After node.moveAndResize(). */
	"node-moved": [node: CanvasNodeLike];
	/** After a node entered or left edit mode. */
	"node-editing": [node: CanvasNodeLike, editing: boolean];
	"edge-render": [edge: CanvasEdgeLike];
	/** After edge.updatePath(). */
	"edge-path": [edge: CanvasEdgeLike];
	"edge-set-data": [edge: CanvasEdgeLike];
	"edge-extra-change": [edge: CanvasEdgeLike];
	"edge-added": [edge: CanvasEdgeLike];
	"edge-removed": [edge: CanvasEdgeLike];
	/** After the popup menu was rebuilt (rebuild = true). */
	"menu-render": [menu: CanvasMenuLike];
	/** After the selection changed (fires synchronously with the change). */
	"selection-change": [canvas: CanvasLike];
	/** After a whole file was loaded into the canvas. */
	"data-load": [canvas: CanvasLike];
	/** After undo/redo applied a snapshot. */
	"history-apply": [canvas: CanvasLike, direction: "undo" | "redo"];
	/** After our own x-opc write on the canvas root. */
	"root-extra-change": [canvas: CanvasLike];
	/** After canvas.setReadonly(). */
	"readonly-change": [canvas: CanvasLike];
	/** Before / after the view writes the file. */
	"save-before": [canvas: CanvasLike];
	"save-after": [canvas: CanvasLike];
	/**
	 * Once per rendered canvas frame, after the view transform of that frame was applied (pan and
	 * zoom animate over several frames; markViewportChanged() only starts them).
	 */
	"canvas-frame": [canvas: CanvasLike];
	/** A node or edge element was clicked / double-clicked / right-clicked (DOM events). */
	"node-interaction": [node: CanvasNodeLike, type: "click" | "dblclick" | "contextmenu", evt: MouseEvent];
}

export type HookName = keyof HookMap;
type Listener<K extends HookName> = (...args: HookMap[K]) => void;

/** Interceptors can veto or replace core behavior. Return true when handled. */
export interface InterceptorMap {
	/** Before the base node's pointerdown (drag start). Return true to block the drag. */
	"node-pointerdown": [node: CanvasNodeLike, evt: PointerEvent];
	/** Before canvas.removeEdge(). Return true to keep the edge. */
	"edge-remove": [edge: CanvasEdgeLike];
	/** Before node.updateBreakpoint(show). Return a boolean to override `show`. */
	"node-breakpoint": [node: CanvasNodeLike, show: boolean];
	/** Before edge.updatePath(). Return true to skip the core path computation. */
	"edge-update-path": [edge: CanvasEdgeLike];
	/** Before node.moveAndResize(rect). Return true to block the move (locked items). */
	"node-move": [node: CanvasNodeLike, rect: { x: number; y: number; width: number; height: number }];
	/** Before node.startEditing(). Return true to block editing (read-only items). */
	"node-start-editing": [node: CanvasNodeLike];
	/** Before canvas.virtualize() (every frame). Return true to skip it for this frame. */
	"canvas-virtualize": [canvas: CanvasLike];
}

/**
 * Transformers rewrite what canvas.getData() returns (used for saving, history and copy).
 * They run in registration order and must return a new object, never mutate their input.
 */
export type DataTransformer = (data: CanvasFileData, canvas: CanvasLike) => CanvasFileData;
export type InterceptorName = keyof InterceptorMap;
type Interceptor<K extends InterceptorName> = (...args: InterceptorMap[K]) => unknown;

type ProtoKind = "canvas" | "node" | "edge" | "menu" | "view";

interface PatchGroup {
	kind: ProtoKind;
	/** Names of hooks/interceptors that need this group. */
	needs: readonly string[];
	install(proto: object): () => void;
}

const OWNER = "core:hooks";

export class CanvasHooks {
	private readonly listeners = new Map<string, Set<(...args: never[]) => unknown>>();
	private readonly protos = new Map<ProtoKind, object>();
	private readonly installed = new Map<PatchGroup, () => void>();
	private readonly groups: PatchGroup[];
	private untrack: (() => void) | null = null;
	private uncapture: (() => void) | null = null;
	private syncing = false;
	private resync = false;

	constructor(
		private readonly patcher: Patcher,
		private readonly tracker: CanvasTracker,
	) {
		this.groups = this.defineGroups();
	}

	/** Subscribe to a hook; returns the unsubscribe function. */
	on<K extends HookName>(name: K, listener: Listener<K>): () => void {
		return this.add(name, listener as (...args: never[]) => unknown);
	}

	/** Register an interceptor; the first one returning a non-undefined value wins. */
	intercept<K extends InterceptorName>(name: K, fn: Interceptor<K>): () => void {
		return this.add(`intercept:${name}`, fn as (...args: never[]) => unknown);
	}

	emit<K extends HookName>(name: K, ...args: HookMap[K]): void {
		const set = this.listeners.get(name);
		if (!set) return;
		for (const fn of [...set]) {
			try {
				(fn as Listener<K>)(...args);
			} catch (error) {
				console.error(`[overpowered-canvas] ${name} listener failed`, error);
			}
		}
	}

	/** Runs interceptors in registration order; returns the first non-undefined result. */
	ask<K extends InterceptorName>(name: K, ...args: InterceptorMap[K]): unknown {
		const set = this.listeners.get(`intercept:${name}`);
		if (!set) return undefined;
		for (const fn of [...set]) {
			try {
				const result = (fn as Interceptor<K>)(...args);
				if (result !== undefined) return result;
			} catch (error) {
				console.error(`[overpowered-canvas] ${name} interceptor failed`, error);
			}
		}
		return undefined;
	}

	/** Registers a getData() transformer; returns the unregister function. */
	transformData(fn: DataTransformer): () => void {
		return this.add("transform:data", fn as unknown as (...args: never[]) => unknown);
	}

	/** Open canvases (only while the hub is active). */
	canvases(): CanvasLike[] {
		return this.tracker.openCanvases().map((v) => v.canvas);
	}

	forEachNode(fn: (node: CanvasNodeLike) => void): void {
		for (const canvas of this.canvases()) for (const node of canvas.nodes.values()) safe(() => fn(node));
	}

	forEachEdge(fn: (edge: CanvasEdgeLike) => void): void {
		for (const canvas of this.canvases()) for (const edge of canvas.edges.values()) safe(() => fn(edge));
	}

	// ---------- internals ----------

	private add(key: string, fn: (...args: never[]) => unknown): () => void {
		let set = this.listeners.get(key);
		if (!set) this.listeners.set(key, (set = new Set()));
		set.add(fn);
		this.activate();
		this.sync();
		let removed = false;
		return () => {
			if (removed) return;
			removed = true;
			set.delete(fn);
			if (set.size === 0) this.listeners.delete(key);
			this.sync();
			if (this.listeners.size === 0) this.deactivate();
		};
	}

	private needed(group: PatchGroup): boolean {
		return group.needs.some((n) => this.listeners.has(n) || this.listeners.has(`intercept:${n}`));
	}

	private activate(): void {
		if (this.untrack) return;
		this.untrack = this.tracker.subscribe((canvas, view) => {
			this.learn(canvas, view);
			this.sync();
		});
	}

	private deactivate(): void {
		for (const uninstall of this.installed.values()) uninstall();
		this.installed.clear();
		this.uncapture?.();
		this.uncapture = null;
		this.untrack?.();
		this.untrack = null;
	}

	private learn(canvas: CanvasLike, view?: CanvasViewLike): void {
		if (!this.protos.has("canvas")) this.protos.set("canvas", Object.getPrototypeOf(canvas) as object);
		if (!this.protos.has("menu") && canvas.menu) this.protos.set("menu", Object.getPrototypeOf(canvas.menu) as object);
		if (!this.protos.has("view") && view) this.protos.set("view", Object.getPrototypeOf(view) as object);
		const node = canvas.nodes.values().next().value as CanvasNodeLike | undefined;
		if (node) this.learnNode(node);
		const edge = canvas.edges.values().next().value as CanvasEdgeLike | undefined;
		if (edge) this.learnEdge(edge);
	}

	private learnNode(node: CanvasNodeLike): void {
		if (this.protos.has("node")) return;
		// The base node class is the last prototype before Object.prototype.
		let proto = Object.getPrototypeOf(node) as object;
		while (Object.getPrototypeOf(proto) && Object.getPrototypeOf(proto) !== Object.prototype) proto = Object.getPrototypeOf(proto) as object;
		if (Object.prototype.hasOwnProperty.call(proto, "getData") && Object.prototype.hasOwnProperty.call(proto, "render")) this.protos.set("node", proto);
	}

	private learnEdge(edge: CanvasEdgeLike): void {
		if (this.protos.has("edge")) return;
		this.protos.set("edge", Object.getPrototypeOf(edge) as object);
	}

	/** Installs needed groups whose prototype is known, removes unneeded ones, captures missing prototypes. */
	private sync(): void {
		if (!this.untrack) return;
		// Installing a group may subscribe to other hooks, which calls sync() again.
		if (this.syncing) {
			this.resync = true;
			return;
		}
		this.syncing = true;
		try {
			do {
				this.resync = false;
				this.syncOnce();
			} while (this.resync);
		} finally {
			this.syncing = false;
		}
	}

	private syncOnce(): void {
		let missing = false;
		for (const group of this.groups) {
			const want = this.needed(group);
			const has = this.installed.has(group);
			if (want && !has) {
				const proto = this.protos.get(group.kind);
				if (!proto) {
					missing = true;
					continue;
				}
				this.installed.set(group, group.install(proto));
			} else if (!want && has) {
				this.installed.get(group)!();
				this.installed.delete(group);
			}
		}
		if (missing && !this.uncapture && this.protos.has("canvas")) this.installCapture();
		if (!missing && this.uncapture) {
			this.uncapture();
			this.uncapture = null;
		}
	}

	/** Learns node/edge prototypes from the first ones created on an empty canvas. */
	private installCapture(): void {
		const hub = this;
		this.uncapture = this.patcher.apply<CanvasLike>(OWNER, "capture prototypes", this.protos.get("canvas") as CanvasLike, {
			addNode: (next) =>
				function (this: CanvasLike, node: CanvasNodeLike) {
					next.call(this, node);
					if (!hub.protos.has("node")) {
						hub.learnNode(node);
						queueMicrotask(() => hub.sync());
					}
				},
			addEdge: (next) =>
				function (this: CanvasLike, edge: CanvasEdgeLike) {
					next.call(this, edge);
					if (!hub.protos.has("edge")) {
						hub.learnEdge(edge);
						queueMicrotask(() => hub.sync());
					}
				},
		});
	}

	private patch<T extends object>(label: string, proto: object, factories: PatchFactories<T>): () => void {
		return this.patcher.apply<T>(OWNER, label, proto as T, factories);
	}

	private defineGroups(): PatchGroup[] {
		const hub = this;
		return [
			{
				kind: "node",
				needs: ["node-render"],
				install: (proto) =>
					this.patch<CanvasNodeLike>("node.render", proto, {
						render: (next) =>
							function (this: CanvasNodeLike) {
								next.call(this);
								hub.emit("node-render", this);
							},
					}),
			},
			{
				kind: "node",
				needs: ["node-set-data"],
				install: (proto) =>
					this.patch<CanvasNodeLike>("node.setData", proto, {
						setData: (next) =>
							function (this: CanvasNodeLike, data) {
								next.call(this, data);
								hub.emit("node-set-data", this);
							},
					}),
			},
			{
				kind: "node",
				needs: ["node-moved", "node-move"],
				install: (proto) =>
					this.patch<CanvasNodeLike>("node.moveAndResize", proto, {
						moveAndResize: (next) =>
							function (this: CanvasNodeLike, rect) {
								if (hub.ask("node-move", this, rect) === true) return;
								next.call(this, rect);
								hub.emit("node-moved", this);
							},
					}),
			},
			{
				kind: "node",
				needs: ["node-editing"],
				install: (proto) =>
					this.patch<CanvasNodeLike & { setIsEditing(editing: boolean): void }>("node.setIsEditing", proto, {
						setIsEditing: (next) =>
							function (this: CanvasNodeLike, editing: boolean) {
								const before = this.isEditing;
								next.call(this, editing);
								if (before !== this.isEditing) hub.emit("node-editing", this, this.isEditing);
							},
					}),
			},
			{
				kind: "node",
				needs: ["node-pointerdown"],
				install: (proto) =>
					this.patch<CanvasNodeLike & { onPointerdown(evt: PointerEvent): void }>("node.onPointerdown", proto, {
						onPointerdown: (next) =>
							function (this: CanvasNodeLike, evt: PointerEvent) {
								if (hub.ask("node-pointerdown", this, evt) === true) return;
								next.call(this, evt);
							},
					}),
			},
			{
				kind: "node",
				needs: ["node-breakpoint"],
				// updateBreakpoint is overridden by content nodes; patch the base and let subclasses
				// reach it through super calls. The override value is applied before any of them run.
				install: (proto) => this.installBreakpointPatch(proto),
			},
			{
				kind: "edge",
				needs: ["edge-render"],
				install: (proto) =>
					this.patch<CanvasEdgeLike>("edge.render", proto, {
						render: (next) =>
							function (this: CanvasEdgeLike) {
								next.call(this);
								hub.emit("edge-render", this);
							},
					}),
			},
			{
				kind: "edge",
				needs: ["edge-path", "edge-update-path"],
				install: (proto) =>
					this.patch<CanvasEdgeLike>("edge.updatePath", proto, {
						updatePath: (next) =>
							function (this: CanvasEdgeLike) {
								if (hub.ask("edge-update-path", this) !== true) next.call(this);
								hub.emit("edge-path", this);
							},
					}),
			},
			{
				kind: "edge",
				needs: ["edge-set-data"],
				install: (proto) =>
					this.patch<CanvasEdgeLike>("edge.setData", proto, {
						setData: (next) =>
							function (this: CanvasEdgeLike, data) {
								const fromBefore = this.from.node;
								const toBefore = this.to.node;
								next.call(this, data);
								// Undo/redo re-attaches ends through setData, which doesn't update the
								// canvas's edge indexes (getEdgesForNode would go stale). Repair them.
								const canvas = this.canvas;
								if (fromBefore !== this.from.node) {
									canvas.edgeFrom.delete(fromBefore, this);
									canvas.edgeFrom.add(this.from.node, this);
								}
								if (toBefore !== this.to.node) {
									canvas.edgeTo.delete(toBefore, this);
									canvas.edgeTo.add(this.to.node, this);
								}
								hub.emit("edge-set-data", this);
							},
					}),
			},
			{
				kind: "canvas",
				needs: ["node-added", "node-removed"],
				install: (proto) =>
					this.patch<CanvasLike>("canvas.addNode/removeNode", proto, {
						addNode: (next) =>
							function (this: CanvasLike, node) {
								next.call(this, node);
								hub.emit("node-added", node);
							},
						removeNode: (next) =>
							function (this: CanvasLike, node) {
								next.call(this, node);
								hub.emit("node-removed", node);
							},
					}),
			},
			{
				kind: "canvas",
				needs: ["edge-added", "edge-removed", "edge-remove"],
				install: (proto) =>
					this.patch<CanvasLike>("canvas.addEdge/removeEdge", proto, {
						addEdge: (next) =>
							function (this: CanvasLike, edge) {
								next.call(this, edge);
								hub.emit("edge-added", edge);
							},
						removeEdge: (next) =>
							function (this: CanvasLike, edge) {
								if (hub.ask("edge-remove", edge) === true) return;
								const had = this.edges.has(edge.id);
								next.call(this, edge);
								if (had) hub.emit("edge-removed", edge);
							},
					}),
			},
			{
				kind: "canvas",
				needs: ["canvas-frame", "canvas-virtualize"],
				install: (proto) =>
					this.patch<CanvasLike & { virtualize(): void }>("canvas.virtualize", proto as CanvasLike & { virtualize(): void }, {
						virtualize: (next) =>
							function (this: CanvasLike & { virtualize(): void }) {
								hub.emit("canvas-frame", this);
								if (hub.ask("canvas-virtualize", this) === true) return;
								next.call(this);
							},
					}),
			},
			{
				kind: "canvas",
				needs: ["selection-change"],
				install: (proto) =>
					this.patch<CanvasLike>("canvas.updateSelection", proto, {
						updateSelection: (next) =>
							function (this: CanvasLike, fn) {
								next.call(this, fn);
								hub.emit("selection-change", this);
							},
					}),
			},
			{
				kind: "canvas",
				needs: ["data-load"],
				install: (proto) =>
					this.patch<CanvasLike>("canvas.setData", proto, {
						setData: (next) =>
							function (this: CanvasLike, data) {
								next.call(this, data);
								hub.emit("data-load", this);
							},
					}),
			},
			{
				kind: "canvas",
				needs: ["history-apply"],
				install: (proto) =>
					this.patch<CanvasLike>("canvas.undo/redo", proto, {
						undo: (next) =>
							function (this: CanvasLike) {
								const before = this.history.current;
								next.call(this);
								if (this.history.current !== before) hub.emit("history-apply", this, "undo");
							},
						redo: (next) =>
							function (this: CanvasLike) {
								const before = this.history.current;
								next.call(this);
								if (this.history.current !== before) hub.emit("history-apply", this, "redo");
							},
					}),
			},
			{
				kind: "canvas",
				needs: ["readonly-change"],
				install: (proto) =>
					this.patch<CanvasLike>("canvas.setReadonly", proto, {
						setReadonly: (next) =>
							function (this: CanvasLike, value) {
								next.call(this, value);
								hub.emit("readonly-change", this);
							},
					}),
			},
			{
				kind: "canvas",
				needs: ["transform:data"],
				install: (proto) =>
					this.patch<CanvasLike>("canvas.getData", proto, {
						getData: (next) =>
							function (this: CanvasLike) {
								let data = next.call(this);
								for (const fn of [...(hub.listeners.get("transform:data") ?? [])]) {
									try {
										data = (fn as unknown as DataTransformer)(data, this);
									} catch (error) {
										console.error("[overpowered-canvas] data transformer failed", error);
									}
								}
								return data;
							},
					}),
			},
			{
				kind: "view",
				needs: ["save-before", "save-after"],
				install: (proto) =>
					this.patch<CanvasViewLike>("view.save", proto, {
						save: (next) =>
							async function (this: CanvasViewLike, clear?: boolean) {
								hub.emit("save-before", this.canvas);
								const result = await next.call(this, clear);
								hub.emit("save-after", this.canvas);
								return result;
							},
					}),
			},
			{
				kind: "node",
				needs: ["node-start-editing"],
				install: (proto) => this.installStartEditingPatch(proto),
			},
			{
				kind: "menu",
				needs: ["menu-render"],
				install: (proto) =>
					this.patch<CanvasMenuLike>("menu.render", proto, {
						render: (next) =>
							function (this: CanvasMenuLike, rebuild: boolean) {
								next.call(this, rebuild);
								if (!rebuild || this.canvas.selection.size === 0 || this.canvas.isDragging) return;
								const before = this.menuEl.childElementCount;
								hub.emit("menu-render", this);
								// Re-run positioning so the wider toolbar stays centered over the selection.
								if (this.menuEl.childElementCount !== before) next.call(this, false);
							},
					}),
			},
		];
	}

	/** startEditing is overridden by text/file/group nodes; patch every class that defines it. */
	private installStartEditingPatch(baseProto: object): () => void {
		const hub = this;
		const uninstallers: (() => void)[] = [];
		const seen = new Set<object>();
		const patchProto = (proto: object) => {
			if (seen.has(proto) || !Object.prototype.hasOwnProperty.call(proto, "startEditing")) return;
			seen.add(proto);
			uninstallers.push(
				this.patch<CanvasNodeLike>("node.startEditing", proto, {
					startEditing: (next) =>
						function (this: CanvasNodeLike, ...args: unknown[]) {
							if (hub.ask("node-start-editing", this) === true) return;
							return (next as (...a: unknown[]) => void).apply(this, args);
						},
				}),
			);
		};
		const visit = (node: CanvasNodeLike) => {
			let proto = Object.getPrototypeOf(node) as object | null;
			while (proto && proto !== Object.prototype) {
				patchProto(proto);
				proto = Object.getPrototypeOf(proto) as object | null;
			}
		};
		patchProto(baseProto);
		this.forEachNode(visit);
		const off = this.on("node-render", visit);
		return () => {
			off();
			for (const u of uninstallers.reverse()) u();
		};
	}

	private installBreakpointPatch(baseProto: object): () => void {
		const hub = this;
		// Patch every prototype in the chain of known node classes that defines updateBreakpoint,
		// so the override reaches content nodes (which don't call super for unmounting logic).
		const uninstallers: (() => void)[] = [];
		const seen = new Set<object>();
		const patchProto = (proto: object) => {
			if (seen.has(proto) || !Object.prototype.hasOwnProperty.call(proto, "updateBreakpoint")) return;
			seen.add(proto);
			uninstallers.push(
				this.patch<CanvasNodeLike>("node.updateBreakpoint", proto, {
					updateBreakpoint: (next) =>
						function (this: CanvasNodeLike, show: boolean) {
							// Only the most-derived call decides; super calls pass the already-overridden value.
							const override = (this as { __opcBp?: boolean }).__opcBp === undefined ? hub.ask("node-breakpoint", this, show) : undefined;
							if (typeof override !== "boolean") return next.call(this, show);
							(this as { __opcBp?: boolean }).__opcBp = true;
							try {
								return next.call(this, override);
							} finally {
								delete (this as { __opcBp?: boolean }).__opcBp;
							}
						},
				}),
			);
		};
		// Walk prototypes of all live nodes to find the subclasses.
		const visit = (node: CanvasNodeLike) => {
			let proto = Object.getPrototypeOf(node) as object | null;
			while (proto && proto !== Object.prototype) {
				patchProto(proto);
				proto = Object.getPrototypeOf(proto) as object | null;
			}
		};
		patchProto(baseProto);
		this.forEachNode(visit);
		// Subclasses first seen later are patched when such a node is rendered.
		const off = this.on("node-render", visit);
		return () => {
			off();
			for (const u of uninstallers.reverse()) u();
		};
	}
}

function safe(fn: () => void): void {
	try {
		fn();
	} catch (error) {
		console.error("[overpowered-canvas]", error);
	}
}
