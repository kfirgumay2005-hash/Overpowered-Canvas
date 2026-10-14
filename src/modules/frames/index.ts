import { ItemView, Notice, setIcon, setTooltip, Setting, type WorkspaceLeaf } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { canvasDirection, mutate, nodeType } from "../shared";
import { matches, move, orderFrames, type FrameInfo } from "./logic";

export const FRAMES_VIEW = "opc-frames";

interface FramesSettings {
	fullscreen: boolean;
	padding: number;
}

type Ctx = ModuleContext<FramesSettings>;

function framesOf(ctx: Ctx, canvas: CanvasLike): FrameInfo[] {
	const groups: FrameInfo[] = [];
	for (const n of canvas.nodes.values()) if (nodeType(n) === "group") groups.push({ id: n.id, x: n.x, y: n.y, label: n.label ?? "" });
	return orderFrames(groups, ctx.data.root(canvas).get().frameOrder, canvasDirection(canvas) === "rtl");
}

function zoomTo(canvas: CanvasLike, node: CanvasNodeLike, padding: number): void {
	canvas.zoomToBbox({ minX: node.x - padding, minY: node.y - padding, maxX: node.x + node.width + padding, maxY: node.y + node.height + padding });
}

class FramesView extends ItemView {
	private canvas: CanvasLike | null = null;
	private query = "";
	private listEl!: HTMLElement;
	private headerEl!: HTMLElement;
	private timer = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: Ctx,
		private readonly present: (canvas: CanvasLike, from?: string) => void,
	) {
		super(leaf);
	}

	getViewType(): string {
		return FRAMES_VIEW;
	}

	getDisplayText(): string {
		return this.ctx.t("frames.title");
	}

	override getIcon(): string {
		return "frame";
	}

	protected override async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("opc-frames-view");
		this.headerEl = root.createDiv({ cls: "opc-frames-header" });
		const search = this.headerEl.createEl("input", { type: "search", cls: "opc-frames-search", attr: { placeholder: this.ctx.t("frames.search"), "aria-label": this.ctx.t("frames.search") } });
		search.addEventListener("input", () => {
			this.query = search.value;
			this.render();
		});
		const present = this.headerEl.createEl("button", { cls: "clickable-icon", attr: { "aria-label": this.ctx.t("frames.present") } });
		setIcon(present, "presentation");
		setTooltip(present, this.ctx.t("frames.present"));
		present.addEventListener("click", () => this.canvas && this.present(this.canvas));
		this.listEl = root.createDiv({ cls: "opc-frames-list", attr: { role: "list" } });
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.track()));
		this.track();
	}

	/** Follows the most recently active canvas. */
	track(): void {
		const leaf = this.app.workspace.getMostRecentLeaf();
		const view = leaf?.view as { getViewType(): string; canvas?: CanvasLike } | undefined;
		if (view?.getViewType() === "canvas" && view.canvas) this.canvas = view.canvas;
		else if (this.canvas && !this.canvas.wrapperEl.isConnected) this.canvas = null;
		this.render();
	}

	/** Re-renders soon (bursts of canvas changes coalesce). */
	refresh(canvas: CanvasLike): void {
		if (canvas !== this.canvas || this.timer) return;
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			this.render();
		}, 120);
	}

	render(): void {
		if (!this.listEl) return;
		this.listEl.empty();
		const canvas = this.canvas;
		if (!canvas) {
			this.listEl.createDiv({ cls: "pane-empty", text: this.ctx.t("frames.noCanvas") });
			return;
		}
		const all = framesOf(this.ctx, canvas);
		if (all.length === 0) {
			this.listEl.createDiv({ cls: "pane-empty", text: this.ctx.t("frames.empty") });
			return;
		}
		const shown = all.filter((f) => matches(f, this.query));
		const reorderable = this.query.trim() === "" && !canvas.readonly;
		shown.forEach((frame) => {
			const index = all.indexOf(frame);
			const node = canvas.nodes.get(frame.id);
			const item = this.listEl.createDiv({ cls: "opc-frames-item tree-item-self is-clickable", attr: { role: "listitem", draggable: String(reorderable), tabindex: "0" } });
			if (node && canvas.selection.has(node)) item.addClass("is-active");
			item.createSpan({ cls: "opc-frames-index", text: String(index + 1) });
			item.createSpan({ cls: "opc-frames-label", text: frame.label || this.ctx.t("frames.untitled") });
			const open = () => {
				const n = canvas.nodes.get(frame.id);
				if (!n) return;
				zoomTo(canvas, n, this.ctx.settings.padding);
				canvas.selectOnly(n);
				this.render();
			};
			item.addEventListener("click", open);
			item.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					open();
				}
			});
			item.addEventListener("contextmenu", (e) => {
				e.preventDefault();
				this.present(canvas, frame.id);
			});
			if (!reorderable) return;
			item.addEventListener("dragstart", (e) => {
				e.dataTransfer?.setData("text/plain", String(index));
				item.addClass("is-dragging");
			});
			item.addEventListener("dragend", () => item.removeClass("is-dragging"));
			item.addEventListener("dragover", (e) => {
				e.preventDefault();
				const r = item.getBoundingClientRect();
				item.toggleClass("drop-before", e.clientY < r.top + r.height / 2);
				item.toggleClass("drop-after", e.clientY >= r.top + r.height / 2);
			});
			item.addEventListener("dragleave", () => item.removeClasses(["drop-before", "drop-after"]));
			item.addEventListener("drop", (e) => {
				e.preventDefault();
				const from = Number(e.dataTransfer?.getData("text/plain"));
				const r = item.getBoundingClientRect();
				const to = e.clientY < r.top + r.height / 2 ? index : index + 1;
				item.removeClasses(["drop-before", "drop-after"]);
				if (!Number.isInteger(from) || from === to || from + 1 === to) return;
				const frameOrder = move(all.map((f) => f.id), from, to);
				mutate(this.ctx as ModuleContext<object>, canvas, () => this.ctx.data.root(canvas).set({ frameOrder }));
				this.render();
			});
		});
	}

	protected override async onClose(): Promise<void> {
		window.clearTimeout(this.timer);
	}
}

interface FrameSession {
	order: string[];
	index: number;
	wasReadonly: boolean;
	cleanup(): void;
}

/**
 * Frames panel: a side panel listing the groups ("frames") of the active canvas. Search,
 * click to zoom to a frame, drag to reorder (stored in the canvas), and present the frames
 * one by one in panel order.
 */
export const framesModule = defineModule<FramesSettings>({
	id: "frames",
	name: "frames.name",
	description: "frames.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: { fullscreen: true, padding: 40 },
	sanitizeSettings: (raw, defaults) => mergeWithDefaults(raw, defaults),

	enable(ctx) {
		const sessions = new Map<CanvasLike, FrameSession>();
		const views = () => ctx.app.workspace.getLeavesOfType(FRAMES_VIEW).map((l) => l.view as FramesView);

		const show = (canvas: CanvasLike, session: FrameSession, counter: HTMLElement) => {
			const node = canvas.nodes.get(session.order[session.index]!);
			if (!node) return;
			canvas.deselectAll();
			zoomTo(canvas, node, ctx.settings.padding);
			counter.setText(`${session.index + 1} / ${session.order.length}`);
		};
		const stop = (canvas: CanvasLike) => {
			const s = sessions.get(canvas);
			if (!s) return;
			sessions.delete(canvas);
			s.cleanup();
			canvas.setReadonly(s.wasReadonly);
		};
		const present = (canvas: CanvasLike, from?: string) => {
			if (sessions.has(canvas)) return;
			const order = framesOf(ctx, canvas).map((f) => f.id);
			if (order.length === 0) {
				new Notice(ctx.t("frames.empty"));
				return;
			}
			const wrapper = canvas.wrapperEl;
			const counter = wrapper.createDiv({ cls: "opc-frames-counter", attr: { "aria-live": "polite" } });
			const session: FrameSession = { order, index: Math.max(0, from ? order.indexOf(from) : 0), wasReadonly: canvas.readonly, cleanup: () => {} };
			const step = (delta: number) => {
				const next = Math.min(order.length - 1, Math.max(0, session.index + delta));
				if (next === session.index) return;
				session.index = next;
				show(canvas, session, counter);
			};
			const onKey = (evt: KeyboardEvent) => {
				if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(evt.key)) step(canvasDirection(canvas) === "rtl" && evt.key === "ArrowRight" ? -1 : 1);
				else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(evt.key)) step(canvasDirection(canvas) === "rtl" && evt.key === "ArrowLeft" ? 1 : -1);
				else if (evt.key === "Home") step(-order.length);
				else if (evt.key === "End") step(order.length);
				else if (evt.key === "Escape") stop(canvas);
				else return;
				evt.preventDefault();
				evt.stopPropagation();
			};
			const win = wrapper.win;
			win.addEventListener("keydown", onKey, true);
			let fullscreen = false;
			const onFullscreen = () => {
				if (!wrapper.doc.fullscreenElement && sessions.has(canvas)) stop(canvas);
			};
			if (ctx.settings.fullscreen && wrapper.doc.fullscreenEnabled) {
				fullscreen = true;
				void canvas.view.containerEl.requestFullscreen().catch(() => (fullscreen = false));
				wrapper.doc.addEventListener("fullscreenchange", onFullscreen);
			}
			wrapper.addClass("opc-frames-presenting");
			session.cleanup = () => {
				win.removeEventListener("keydown", onKey, true);
				wrapper.doc.removeEventListener("fullscreenchange", onFullscreen);
				if (fullscreen && wrapper.doc.fullscreenElement) void wrapper.doc.exitFullscreen().catch(() => {});
				wrapper.removeClass("opc-frames-presenting");
				counter.remove();
			};
			sessions.set(canvas, session);
			canvas.setReadonly(true);
			window.setTimeout(() => show(canvas, session, counter), fullscreen ? 250 : 0);
		};

		ctx.registerView(FRAMES_VIEW, (leaf) => new FramesView(leaf, ctx, present));

		const openPanel = async () => {
			const existing = ctx.app.workspace.getLeavesOfType(FRAMES_VIEW)[0];
			if (existing) return ctx.app.workspace.revealLeaf(existing);
			const leaf = ctx.app.workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: FRAMES_VIEW, active: true });
			await ctx.app.workspace.revealLeaf(leaf);
		};

		const refresh = (canvas: CanvasLike) => views().forEach((v) => v.refresh(canvas));
		ctx.on("node-added", (n) => nodeType(n) === "group" && refresh(n.canvas));
		ctx.on("node-removed", (n) => nodeType(n) === "group" && refresh(n.canvas));
		ctx.on("node-set-data", (n) => nodeType(n) === "group" && refresh(n.canvas));
		ctx.on("node-moved", (n) => nodeType(n) === "group" && refresh(n.canvas));
		ctx.on("node-editing", (n) => nodeType(n) === "group" && refresh(n.canvas));
		ctx.on("selection-change", refresh);
		ctx.on("root-extra-change", refresh);
		ctx.on("data-load", refresh);
		ctx.on("history-apply", refresh);
		ctx.on("readonly-change", refresh);

		ctx.onCanvas((canvas) => {
			const controls = canvas.wrapperEl.querySelector(".canvas-controls");
			const group = controls?.createDiv({ cls: "canvas-control-group mod-raised opc-frames-control" });
			if (group) {
				const item = group.createDiv({ cls: "canvas-control-item", attr: { "aria-label": ctx.t("frames.open"), "data-tooltip-position": "left" } });
				setIcon(item, "frame");
				setTooltip(item, ctx.t("frames.open"), { placement: "left" });
				item.addEventListener("click", () => void openPanel());
			}
			return () => {
				stop(canvas);
				group?.remove();
			};
		});
		ctx.register(() => {
			for (const canvas of [...sessions.keys()]) stop(canvas);
		});

		ctx.addCommand({ id: "open", name: ctx.t("frames.open"), icon: "frame", callback: () => void openPanel() });
		ctx.addCommand({
			id: "present",
			name: ctx.t("frames.present"),
			icon: "presentation",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || sessions.has(canvas)) return false;
				if (!checking) present(canvas);
				return true;
			},
		});
	},

	renderSettings(el, ctx: ModuleContext<FramesSettings>) {
		new Setting(el).setName(ctx.t("frames.fullscreen")).addToggle((t) => t.setValue(ctx.settings.fullscreen).onChange((v) => ctx.updateSettings({ fullscreen: v })));
		new Setting(el).setName(ctx.t("frames.padding")).addSlider((s) => s.setLimits(0, 200, 10).setValue(ctx.settings.padding).setDynamicTooltip().onChange((v) => ctx.updateSettings({ padding: v })));
	},
});
