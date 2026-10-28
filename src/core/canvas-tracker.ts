import type { App, EventRef } from "obsidian";
import { findCanvasShapeProblems, isCanvasView } from "../internals/guards";
import type { CanvasLike, CanvasViewLike } from "../internals/types";
import { logError } from "./log";

export type CanvasCallback = (canvas: CanvasLike, view: CanvasViewLike) => (() => void) | void;

interface Subscriber {
	readonly cb: CanvasCallback;
	readonly cleanups: Map<CanvasViewLike, () => void>;
}

/**
 * Tracks open canvas views and tells subscribers about existing and future ones.
 * Listens to the workspace only while at least one subscriber exists, so a plugin with
 * every module disabled has no listeners at all.
 */
export class CanvasTracker {
	private readonly subscribers = new Set<Subscriber>();
	private readonly views = new Set<CanvasViewLike>();
	private readonly refs: EventRef[] = [];
	private readonly rejected = new WeakSet<CanvasViewLike>();

	constructor(
		private readonly app: App,
		private readonly onIncompatible: (problems: string[]) => void,
	) {}

	/** Calls `cb` for every open canvas and every canvas opened later. Returns an unsubscribe. */
	subscribe(cb: CanvasCallback): () => void {
		const sub: Subscriber = { cb, cleanups: new Map() };
		this.subscribers.add(sub);
		if (this.subscribers.size === 1) this.start();
		else for (const view of this.views) this.attach(sub, view);
		return () => {
			if (!this.subscribers.delete(sub)) return;
			for (const cleanup of sub.cleanups.values()) safely(cleanup);
			sub.cleanups.clear();
			if (this.subscribers.size === 0) this.stop();
		};
	}

	/** Currently open, compatible canvas views. */
	openCanvases(): CanvasViewLike[] {
		return [...this.views];
	}

	private start(): void {
		const ws = this.app.workspace;
		const rescan = () => this.scan();
		this.refs.push(ws.on("layout-change", rescan), ws.on("active-leaf-change", rescan), ws.on("file-open", rescan));
		ws.onLayoutReady(rescan);
	}

	private stop(): void {
		for (const ref of this.refs) this.app.workspace.offref(ref);
		this.refs.length = 0;
		this.views.clear();
	}

	private scan(): void {
		if (this.subscribers.size === 0) return;
		const current = new Set<CanvasViewLike>();
		for (const leaf of this.app.workspace.getLeavesOfType("canvas")) {
			const view = leaf.view;
			if (!isCanvasView(view) || this.rejected.has(view)) continue;
			if (!this.views.has(view)) {
				const problems = findCanvasShapeProblems(view.canvas);
				if (problems.length > 0) {
					this.rejected.add(view);
					this.onIncompatible(problems);
					continue;
				}
			}
			current.add(view);
		}
		for (const view of [...this.views]) {
			if (current.has(view)) continue;
			this.views.delete(view);
			for (const sub of this.subscribers) {
				const cleanup = sub.cleanups.get(view);
				sub.cleanups.delete(view);
				if (cleanup) safely(cleanup);
			}
		}
		for (const view of current) {
			if (this.views.has(view)) continue;
			this.views.add(view);
			for (const sub of this.subscribers) this.attach(sub, view);
		}
	}

	private attach(sub: Subscriber, view: CanvasViewLike): void {
		try {
			const cleanup = sub.cb(view.canvas, view);
			if (cleanup) sub.cleanups.set(view, cleanup);
		} catch (error) {
			logError("[overpowered-canvas] canvas subscriber failed", error);
		}
	}
}

function safely(fn: () => void): void {
	try {
		fn();
	} catch (error) {
		logError("[overpowered-canvas] cleanup failed", error);
	}
}
