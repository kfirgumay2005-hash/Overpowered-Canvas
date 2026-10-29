import { ItemView, Notice, Setting, setIcon, setTooltip, type Menu, type WorkspaceLeaf } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasEdgeData, CanvasNodeData } from "../../data/json-canvas";
import type { PageInfo } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mapRootOf, relayoutMap } from "../auto-layout/arrange";
import { mutate, nodeType, randomId, renderedZ, selectedNodes } from "../shared";
import { pagesHost } from "./api";
import { boundsOf, branchOf, cardLink, freeRegion, pageChildren, pagePath, titleOf, withLink, withoutLink, withoutPage, type PlanNode } from "./logic";
import { logError } from "../../core/log";

export const PAGES_VIEW = "opc-pages";

interface PagesSettings {
	/** Show one page at a time (off: every page shows in its own region of the board). */
	onePage: boolean;
	/** Text of the links between a card and its page ("" = the word for "Link" in the UI language). */
	linkLabel: string;
}

type Ctx = ModuleContext<PagesSettings>;
type BBoxLike = { minX: number; minY: number; maxX: number; maxY: number };
type HitTestingCanvas = CanvasLike & { hitTestNode(pos: { x: number; y: number }, margin?: number): CanvasNodeLike | null; nodeIndex: { search(bbox: BBoxLike): CanvasNodeLike[] } };

const HIDDEN = "opc-page-hidden";
/** Extra height for the link line added under a card's text (a blank line and the link). */
const LINK_ROOM = 48;

/** Per open view: the page it shows and where each page was last looked at. */
interface ViewState {
	page: string;
	viewports: Map<string, { x: number; y: number; zoom: number }>;
}

interface Placing {
	anchor: string;
	cleanup: () => void;
}

/**
 * Pages: a big map in parts, still one canvas. "Move branch to a new page" takes everything
 * below a card to a page of its own; the card stays in the map and links to the page's root
 * (a copy of it), which links back. One page shows at a time in each view; the index lists them
 * as a tree, and the bar at the top of the board shows where you are.
 */
export const pagesModule = defineModule<PagesSettings>({
	id: "pages",
	name: "pages.name",
	description: "pages.desc",
	group: "mindmap",
	defaultEnabled: true,
	defaultSettings: { onePage: true, linkLabel: "" },
	sanitizeSettings: (raw, defaults) => {
		const r = (raw ?? {}) as Partial<PagesSettings>;
		return {
			onePage: typeof r.onePage === "boolean" ? r.onePage : defaults.onePage,
			linkLabel: typeof r.linkLabel === "string" ? r.linkLabel.replace(/[[\]|\n]/g, "").slice(0, 40) : defaults.linkLabel,
		};
	},

	enable(ctx) {
		const views = new WeakMap<CanvasLike, ViewState>();
		/** Last page shown per file, so reopening a canvas returns there. */
		const lastPage = new Map<string, string>();
		const placing = new Map<CanvasLike, Placing>();
		/** Nodes this module adds itself: their page is set already. */
		const ours = new Set<string>();
		let replaying = 0;

		const label = () => ctx.settings.linkLabel || ctx.t("pages.link");
		const pagesOf = (canvas: CanvasLike): PageInfo[] => ctx.data.root(canvas).get().pages ?? [];
		const pageOf = (node: CanvasNodeLike): string => ctx.data.node(node).get().page ?? "";
		const hasPages = (canvas: CanvasLike) => pagesOf(canvas).length > 0;
		const hiding = (canvas: CanvasLike) => ctx.settings.onePage && hasPages(canvas);
		const isHidden = (node: CanvasNodeLike) => node.nodeEl.hasClass(HIDDEN);

		const stateOf = (canvas: CanvasLike): ViewState => {
			let s = views.get(canvas);
			if (!s) {
				const path = canvas.view.file?.path;
				s = { page: (path && lastPage.get(path)) ?? "", viewports: new Map() };
				views.set(canvas, s);
			}
			return s;
		};
		const current = (canvas: CanvasLike): string => {
			const s = stateOf(canvas);
			if (s.page && !pagesOf(canvas).some((p) => p.id === s.page)) s.page = "";
			return s.page;
		};

		// ---------- showing one page ----------

		const decorate = (canvas: CanvasLike) => {
			const on = hiding(canvas);
			const page = current(canvas);
			for (const n of canvas.nodes.values()) n.nodeEl.toggleClass(HIDDEN, on && pageOf(n) !== page);
			for (const e of canvas.edges.values()) {
				const hidden = isHidden(e.from.node) || isHidden(e.to.node);
				e.lineGroupEl.toggleClass(HIDDEN, hidden);
				e.lineEndGroupEl.toggleClass(HIDDEN, hidden);
				e.labelElement?.wrapperEl.toggleClass(HIDDEN, hidden);
			}
			canvas.wrapperEl.toggleClass("opc-has-pages", hasPages(canvas));
			renderBar(canvas);
			refreshViews();
		};

		/** Selected cards on pages not shown are let go. */
		const prune = (canvas: CanvasLike) => {
			const drop = [...canvas.selection].filter((item): item is CanvasNodeLike => canvas.nodes.get(item.id) === item && isHidden(item));
			if (drop.length) canvas.updateSelection(() => drop.forEach((n) => canvas.selection.delete(n)));
		};

		const pageBox = (canvas: CanvasLike, page: string) =>
			boundsOf([...canvas.nodes.values()].filter((n) => pageOf(n) === page && !n.id.includes("~")).map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height })));

		/** Shows `page` in this view: back where it was last looked at, else the whole page. */
		const show = (canvas: CanvasLike, page: string, opts: { focus?: CanvasNodeLike; keepView?: boolean } = {}) => {
			const s = stateOf(canvas);
			const from = current(canvas);
			if (page && !pagesOf(canvas).some((p) => p.id === page)) page = "";
			if (from !== page) s.viewports.set(from, { x: canvas.tx, y: canvas.ty, zoom: canvas.tZoom });
			s.page = page;
			const path = canvas.view.file?.path;
			if (path) lastPage.set(path, page);
			decorate(canvas);
			prune(canvas);
			if (opts.focus) {
				canvas.tx = opts.focus.x + opts.focus.width / 2;
				canvas.ty = opts.focus.y + opts.focus.height / 2;
				canvas.zoomCenter = null;
				canvas.markViewportChanged();
			} else if (!opts.keepView && from !== page) {
				const saved = s.viewports.get(page);
				const box = pageBox(canvas, page);
				if (saved) {
					canvas.tx = saved.x;
					canvas.ty = saved.y;
					canvas.tZoom = saved.zoom;
					canvas.zoomCenter = null;
					canvas.markViewportChanged();
				} else if (box) canvas.zoomToBbox(box);
			}
			canvas.markViewportChanged();
			if (from !== page) ctx.events.emit("page-shown", canvas, page);
		};

		const pageTitle = (canvas: CanvasLike, page: string): string => {
			if (!page) return canvas.view.file?.basename ?? ctx.t("pages.main");
			const info = pagesOf(canvas).find((p) => p.id === page);
			const root = info ? canvas.nodes.get(info.root) : undefined;
			const text = root ? nodeLabel(root) : "";
			return text || ctx.t("pages.untitled");
		};

		// ---------- the bar at the top of the board ----------

		const bars = new WeakMap<CanvasLike, HTMLElement>();
		const renderBar = (canvas: CanvasLike) => {
			let bar = bars.get(canvas);
			if (!hasPages(canvas)) {
				bar?.remove();
				bars.delete(canvas);
				return;
			}
			if (!bar || !bar.isConnected) {
				bar = canvas.wrapperEl.createDiv({ cls: "opc-pages-bar" });
				// The bar is not part of the board: no panning or selecting through it.
				bar.addEventListener("pointerdown", (evt) => evt.stopPropagation());
				bars.set(canvas, bar);
			}
			bar.empty();
			const index = bar.createEl("button", { cls: "clickable-icon opc-pages-index", attr: { "aria-label": ctx.t("pages.index.open") } });
			setIcon(index, "list-tree");
			setTooltip(index, ctx.t("pages.index.open"));
			index.addEventListener("click", () => void openIndex());
			const page = current(canvas);
			const crumbs = [{ id: "", title: pageTitle(canvas, "") }, ...pagePath(pagesOf(canvas), page).map((p) => ({ id: p.id, title: pageTitle(canvas, p.id) }))];
			if (!ctx.settings.onePage) crumbs.splice(1);
			crumbs.forEach((c, i) => {
				if (i > 0) bar.createSpan({ cls: "opc-pages-sep", text: "›" });
				const el = bar.createEl("button", { cls: "opc-pages-crumb", text: c.title });
				el.toggleClass("is-current", c.id === page);
				el.addEventListener("click", () => show(canvas, c.id));
			});
		};

		// ---------- moving a branch ----------

		const planNodes = (canvas: CanvasLike): PlanNode[] =>
			[...canvas.nodes.values()]
				.filter((n) => !n.id.includes("~"))
				.map((n) => {
					const extra = ctx.data.node(n).get();
					return { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, group: nodeType(n) === "group", page: extra.page ?? "", ...(extra.anchor ? { stuckTo: extra.anchor } : {}) };
				});
		const planEdges = (canvas: CanvasLike) => [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id }));

		const branchNodes = (canvas: CanvasLike, anchor: CanvasNodeLike) =>
			branchOf(planNodes(canvas), planEdges(canvas), anchor.id)
				.map((id) => canvas.nodes.get(id))
				.filter((n): n is CanvasNodeLike => !!n);

		const linktextOf = (canvas: CanvasLike) => {
			const file = canvas.view.file;
			return file ? ctx.app.metadataCache.fileToLinktext(file, "", false) : "";
		};

		/**
		 * Moves the branch below `anchor` to a new page (`to` = "page") or to a point of the same page
		 * (the new root's center lands there). A copy of the anchor becomes the branch's root; the two
		 * link to each other. One undo step.
		 */
		const moveBranch = async (canvas: CanvasLike, anchor: CanvasNodeLike, to: "page" | { x: number; y: number }) => {
			if (canvas.readonly) return;
			const moving = branchNodes(canvas, anchor);
			if (moving.length === 0) {
				new Notice(ctx.t("pages.noBranch"));
				return;
			}
			const pageId = to === "page" ? randomId(8) : null;
			const parentPage = pageOf(anchor);
			const delta =
				to === "page"
					? (() => {
							const region = freeRegion(planNodes(canvas));
							const box = boundsOf([anchor, ...moving])!;
							return { x: region.x - box.minX, y: region.y - box.minY };
						})()
					: { x: Math.round(to.x - (anchor.x + anchor.width / 2)), y: Math.round(to.y - (anchor.y + anchor.height / 2)) };
			const rootId = randomId();
			const linktext = linktextOf(canvas);
			const isText = nodeType(anchor) === "text";
			const anchorData = anchor.getData();
			const anchorText = String((anchorData as { text?: string }).text ?? "");
			const extra = { ...ctx.data.node(anchor).get() };
			delete extra.page;
			if (pageId) extra.page = pageId;
			else if (parentPage) extra.page = parentPage;
			// Text cards grow by the link's line so it shows.
			const grow = isText ? LINK_ROOM : 0;
			const rootData = {
				...anchorData,
				id: rootId,
				x: anchor.x + delta.x,
				y: anchor.y + delta.y,
				height: anchor.height + grow,
				...(isText ? { text: withLink(anchorText, cardLink(linktext, anchor.id, label())) } : {}),
				"x-opc": { v: 1, ...extra },
			} as CanvasNodeData;
			const children = canvas.getEdgesForNode(anchor).filter((e) => e.from.node === anchor && moving.includes(e.to.node));
			const layouts = ctx.data.root(canvas).get().mapLayouts ?? {};
			const mapRoot = mapRootOf(planEdges(canvas), anchor.id);
			const layout = layouts[mapRoot];
			let root: CanvasNodeLike | undefined;
			ours.add(rootId);
			const ok = mutate(ctx, canvas, () => {
				canvas.importData({ nodes: [rootData], edges: [] }, false);
				root = canvas.nodes.get(rootId);
				if (!root) throw new Error("the page's root card was not created");
				// The branch hangs from the new root now.
				const rewired: CanvasEdgeData[] = children.map((e) => ({ ...e.getData(), fromNode: rootId }));
				for (const e of children) canvas.removeEdge(e);
				canvas.importData({ nodes: [], edges: rewired }, false);
				for (const n of moving) {
					n.moveTo({ x: n.x + delta.x, y: n.y + delta.y });
					if (pageId) ctx.data.node(n).set({ page: pageId });
				}
				if (isText) anchor.setData({ ...anchor.getData(), height: anchor.height + grow, text: withLink(anchorText, cardLink(linktext, rootId, label())) });
				const root0 = ctx.data.root(canvas);
				if (pageId) root0.set({ pages: [...pagesOf(canvas), { id: pageId, anchor: anchor.id, root: rootId, ...(parentPage ? { parent: parentPage } : {}) }] });
				if (layout) root0.set({ mapLayouts: { ...layouts, [rootId]: layout } });
			});
			ours.delete(rootId);
			if (!ok || !root) return;
			// The map closes the gap the branch left (when it has a recorded layout).
			if (layout) await relayoutMap(ctx, canvas, anchor).catch((e) => logError("[overpowered-canvas] pages: layout", e));
			ctx.events.emit("branch-moved", canvas, anchor, root, pageId);
			if (pageId && ctx.settings.onePage) {
				show(canvas, pageId, { keepView: true });
				const box = pageBox(canvas, pageId);
				if (box) canvas.zoomToBbox(box);
			} else if (!pageId) decorate(canvas);
			else {
				decorate(canvas);
				canvas.zoomToBbox(root.getBBox());
			}
			canvas.selectOnly(root);
			new Notice(ctx.t(pageId ? "pages.moved" : "pages.placed", { name: nodeLabel(anchor) || ctx.t("pages.untitled") }));
		};

		/** Puts a page back into its parent page, where the branch was. One undo step. */
		const mergePage = async (canvas: CanvasLike, pageId: string) => {
			if (canvas.readonly) return;
			const info = pagesOf(canvas).find((p) => p.id === pageId);
			if (!info) return;
			const anchor = canvas.nodes.get(info.anchor);
			const root = canvas.nodes.get(info.root);
			const members = [...canvas.nodes.values()].filter((n) => pageOf(n) === pageId);
			const delta = anchor && root ? { x: anchor.x - root.x, y: anchor.y - root.y } : { x: 0, y: 0 };
			const layouts = ctx.data.root(canvas).get().mapLayouts ?? {};
			const ok = mutate(ctx, canvas, () => {
				if (anchor && root) {
					// The branch hangs from the anchor again; the copy goes.
					const edges = canvas.getEdgesForNode(root);
					const rewired: CanvasEdgeData[] = edges
						.filter((e) => e.from.node !== anchor && e.to.node !== anchor)
						.map((e) => {
							const d = e.getData();
							return { ...d, ...(d.fromNode === root.id ? { fromNode: anchor.id } : {}), ...(d.toNode === root.id ? { toNode: anchor.id } : {}) };
						});
					for (const e of edges) canvas.removeEdge(e);
					canvas.removeNode(root);
					canvas.importData({ nodes: [], edges: rewired }, false);
					if (nodeType(anchor) === "text") {
						const text = withoutLink(anchor.text ?? "", root.id);
						const shrink = text !== anchor.text ? LINK_ROOM : 0;
						anchor.setData({ ...anchor.getData(), height: Math.max(40, anchor.height - shrink), text });
					}
				}
				for (const n of members) {
					if (n === root) continue;
					if (anchor && root) n.moveTo({ x: n.x + delta.x, y: n.y + delta.y });
					ctx.data.node(n).set({ page: info.parent });
				}
				const nextLayouts = { ...layouts };
				if (root) delete nextLayouts[root.id];
				ctx.data.root(canvas).set({ pages: withoutPage(pagesOf(canvas), pageId), mapLayouts: Object.keys(nextLayouts).length ? nextLayouts : undefined });
				if (pagesOf(canvas).length === 0) ctx.data.root(canvas).set({ pages: undefined });
			});
			if (!ok) return;
			show(canvas, info.parent ?? "", { keepView: true });
			if (anchor) {
				await relayoutMap(ctx, canvas, anchor).catch((e) => logError("[overpowered-canvas] pages: layout", e));
				canvas.selectOnly(anchor);
				canvas.zoomToBbox(anchor.getBBox());
			}
			ctx.events.emit("page-merged", canvas, pageId);
		};

		// ---------- placing a branch by hand ----------

		const stopPlacing = (canvas: CanvasLike) => {
			placing.get(canvas)?.cleanup();
			placing.delete(canvas);
		};
		const startPlacing = (canvas: CanvasLike, anchor: CanvasNodeLike) => {
			if (branchNodes(canvas, anchor).length === 0) {
				new Notice(ctx.t("pages.noBranch"));
				return;
			}
			stopPlacing(canvas);
			const banner = canvas.wrapperEl.createDiv({ cls: "opc-pages-placing" });
			banner.addEventListener("pointerdown", (evt) => evt.stopPropagation());
			banner.createSpan({ text: ctx.t("pages.placing.hint", { name: nodeLabel(anchor) || ctx.t("pages.untitled") }) });
			const put = banner.createEl("button", { cls: "mod-cta", text: ctx.t("pages.placing.put") });
			const cancel = banner.createEl("button", { text: ctx.t("pages.placing.cancel") });
			const id = anchor.id;
			put.addEventListener("click", () => void placeHere(canvas));
			cancel.addEventListener("click", () => stopPlacing(canvas));
			const onKey = (evt: KeyboardEvent) => {
				if (evt.key === "Escape" && ctx.activeCanvas() === canvas) stopPlacing(canvas);
			};
			const win = canvas.wrapperEl.win;
			win.addEventListener("keydown", onKey, true);
			placing.set(canvas, {
				anchor: id,
				cleanup: () => {
					banner.remove();
					win.removeEventListener("keydown", onKey, true);
				},
			});
		};
		const placeHere = async (canvas: CanvasLike) => {
			const p = placing.get(canvas);
			const anchor = p ? canvas.nodes.get(p.anchor) : undefined;
			stopPlacing(canvas);
			if (anchor) await moveBranch(canvas, anchor, { x: canvas.x, y: canvas.y });
		};

		// ---------- the core sees only the page shown ----------

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
			ctx.patch("canvas.setData/applyHistory (pages)", proto, { setData: guard, applyHistory: guard });
			const visible = (nodes: CanvasNodeLike[]) => nodes.filter((n) => !isHidden(n));
			ctx.patch("canvas hit testing (pages)", proto as HitTestingCanvas, {
				getIntersectingNodes: (next) =>
					function (this: HitTestingCanvas, bbox: BBoxLike) {
						return visible(next.call(this, bbox));
					},
				getContainingNodes: (next) =>
					function (this: HitTestingCanvas, bbox: BBoxLike) {
						return visible(next.call(this, bbox));
					},
				hitTestNode: (next) =>
					function (this: HitTestingCanvas, pos: { x: number; y: number }, margin = 0) {
						const hit = next.call(this, pos, margin);
						if (!hit || !isHidden(hit)) return hit;
						const hits = visible(this.nodeIndex.search({ minX: pos.x - margin, minY: pos.y - margin, maxX: pos.x + margin, maxY: pos.y + margin }));
						hits.sort((a, b) => renderedZ(b) - renderedZ(a));
						return hits[0] ?? null;
					},
				zoomToFit: (next) =>
					function (this: HitTestingCanvas) {
						if (!hiding(this)) return next.call(this);
						const box = pageBox(this, current(this));
						if (box) this.zoomToBbox(box);
					},
			});
		});

		ctx.decorateNodes({
			apply: (node) => node.nodeEl.toggleClass(HIDDEN, hiding(node.canvas) && pageOf(node) !== current(node.canvas)),
			clear: (node) => node.nodeEl.removeClass(HIDDEN),
		});
		ctx.onCanvas((canvas) => {
			decorate(canvas);
			// Opened from a link to a card on another page: that page (set by the link's reveal).
			return () => {
				stopPlacing(canvas);
				bars.get(canvas)?.remove();
				canvas.wrapperEl.removeClass("opc-has-pages");
				for (const e of canvas.edges.values()) {
					e.lineGroupEl.removeClass(HIDDEN);
					e.lineEndGroupEl.removeClass(HIDDEN);
					e.labelElement?.wrapperEl.removeClass(HIDDEN);
				}
			};
		});
		ctx.on("root-extra-change", decorate);
		ctx.on("data-load", decorate);
		ctx.on("history-apply", (canvas) => decorate(canvas));
		ctx.on("node-extra-change", (node) => decorate(node.canvas));
		ctx.on("edge-added", (edge) => {
			const hidden = isHidden(edge.from.node) || isHidden(edge.to.node);
			edge.lineGroupEl.toggleClass(HIDDEN, hidden);
			edge.lineEndGroupEl.toggleClass(HIDDEN, hidden);
		});
		ctx.on("node-removed", (node) => refreshViews(node.canvas));
		ctx.onSettingsChange(() => {
			for (const c of ctx.canvases()) decorate(c);
		});

		// A selection made elsewhere (search, a link to a card, the walk) that lies wholly on another
		// page shows that page; otherwise cards of other pages are let go.
		ctx.on("selection-change", (canvas) => {
			if (!hiding(canvas)) return;
			const nodes = selectedNodes(canvas);
			const hidden = nodes.filter(isHidden);
			if (hidden.length === 0) return;
			const pages = new Set(nodes.map(pageOf));
			if (hidden.length === nodes.length && pages.size === 1) show(canvas, [...pages][0]!, { keepView: true });
			else prune(canvas);
		});

		// New cards go to the page shown (pasted ones too, whatever page they were copied from).
		ctx.on("node-added", (node) => {
			if (replaying > 0 || ours.has(node.id)) return;
			const canvas = node.canvas;
			queueMicrotask(() => {
				if (canvas.nodes.get(node.id) !== node || ours.has(node.id)) return;
				const page = hasPages(canvas) ? current(canvas) : "";
				if (pageOf(node) === page) return;
				try {
					ctx.data.node(node).set({ page: page || undefined }, { history: false });
				} catch (error) {
					logError("[overpowered-canvas] pages: could not put a new card on the page shown", error);
				}
			});
		});

		pagesHost.api = {
			pageOf,
			current: (canvas) => current(canvas),
			reveal: (canvas, node) => {
				if (hiding(canvas) && pageOf(node) !== current(canvas)) show(canvas, pageOf(node), { keepView: true });
			},
			links: (canvas) => pagesOf(canvas).map((p) => ({ anchor: p.anchor, root: p.root })),
		};
		ctx.register(() => (pagesHost.api = null));

		// ---------- the index ----------

		const refreshViews = (canvas?: CanvasLike) => {
			for (const leaf of ctx.app.workspace.getLeavesOfType(PAGES_VIEW)) {
				const view = leaf.view;
				if (view instanceof PagesView) view.refresh(canvas);
			}
		};
		ctx.registerView(PAGES_VIEW, (leaf) => new PagesView(leaf, ctx, { pagesOf, current, show, pageTitle, merge: (c, id) => void mergePage(c, id), count: (c, id) => [...c.nodes.values()].filter((n) => pageOf(n) === id).length }));
		const openIndex = async () => {
			const existing = ctx.app.workspace.getLeavesOfType(PAGES_VIEW)[0];
			if (existing) return ctx.app.workspace.revealLeaf(existing);
			const leaf = ctx.app.workspace.getLeftLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: PAGES_VIEW, active: true });
			await ctx.app.workspace.revealLeaf(leaf);
		};
		ctx.addRibbonIcon("list-tree", ctx.t("pages.index.open"), () => void openIndex());

		// ---------- commands and menus ----------

		const pageLinkOf = (canvas: CanvasLike, node: CanvasNodeLike) => {
			const pages = pagesOf(canvas);
			return { leadsTo: pages.find((p) => p.anchor === node.id), rootOf: pages.find((p) => p.root === node.id) };
		};
		const goTo = (canvas: CanvasLike, id: string) => {
			const node = canvas.nodes.get(id);
			if (!node) return;
			show(canvas, pageOf(node), { focus: node });
			canvas.selectOnly(node);
		};
		const oneCard = (canvas: CanvasLike | null) => {
			const nodes = canvas ? selectedNodes(canvas) : [];
			return canvas && nodes.length === 1 ? nodes[0]! : null;
		};
		const command = (id: string, name: string, icon: string, can: (canvas: CanvasLike) => boolean, run: (canvas: CanvasLike) => void) =>
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
		command("move-branch", ctx.t("pages.moveBranch"), "file-plus-2", (c) => !c.readonly && !!oneCard(c), (c) => void moveBranch(c, oneCard(c)!, "page"));
		command("place-branch", ctx.t("pages.placeBranch"), "move", (c) => !c.readonly && !!oneCard(c), (c) => startPlacing(c, oneCard(c)!));
		command("put-branch-here", ctx.t("pages.placing.put"), "map-pin", (c) => placing.has(c), (c) => void placeHere(c));
		command("open-index", ctx.t("pages.index.open"), "list-tree", () => true, () => void openIndex());
		command("main-page", ctx.t("pages.goMain"), "home", (c) => hasPages(c) && current(c) !== "", (c) => show(c, ""));
		command("parent-page", ctx.t("pages.goUp"), "arrow-up-left", (c) => hasPages(c) && current(c) !== "", (c) => {
			const info = pagesOf(c).find((p) => p.id === current(c));
			if (info) goTo(c, info.anchor);
		});
		command("merge-page", ctx.t("pages.merge"), "combine", (c) => !c.readonly && hasPages(c) && current(c) !== "", (c) => void mergePage(c, current(c)));
		command("follow-link", ctx.t("pages.follow"), "arrow-right-left", (c) => {
			const n = oneCard(c);
			if (!n) return false;
			const l = pageLinkOf(c, n);
			return !!(l.leadsTo || l.rootOf);
		}, (c) => {
			const l = pageLinkOf(c, oneCard(c)!);
			if (l.leadsTo) goTo(c, l.leadsTo.root);
			else if (l.rootOf) goTo(c, l.rootOf.anchor);
		});

		const addItems = (menu: Menu, canvas: CanvasLike, node: CanvasNodeLike) => {
			const l = pageLinkOf(canvas, node);
			if (l.leadsTo) {
				const target = l.leadsTo.root;
				menu.addItem((i) => i.setSection("opc-pages").setTitle(ctx.t("pages.openPage")).setIcon("arrow-right-from-line").onClick(() => goTo(canvas, target)));
			}
			if (l.rootOf) {
				const info = l.rootOf;
				menu.addItem((i) => i.setSection("opc-pages").setTitle(ctx.t("pages.back")).setIcon("arrow-left-from-line").onClick(() => goTo(canvas, info.anchor)));
				if (!canvas.readonly) menu.addItem((i) => i.setSection("opc-pages").setTitle(ctx.t("pages.merge")).setIcon("combine").onClick(() => void mergePage(canvas, info.id)));
			}
			if (canvas.readonly || canvas.selection.size > 1 || nodeType(node) === "group" && !canvas.getEdgesForNode(node).length) return;
			const hasBranch = canvas.getEdgesForNode(node).some((e) => e.from.node === node && e.to.node !== node);
			if (!hasBranch) return;
			menu.addItem((i) => i.setSection("opc-pages").setTitle(ctx.t("pages.moveBranch")).setIcon("file-plus-2").onClick(() => void moveBranch(canvas, node, "page")));
			menu.addItem((i) => i.setSection("opc-pages").setTitle(ctx.t("pages.placeBranch")).setIcon("move").onClick(() => startPlacing(canvas, node)));
		};
		ctx.onNodeMenu((menu, node) => addItems(menu, node.canvas, node));

		ctx.register(() => {
			for (const c of [...placing.keys()]) stopPlacing(c);
		});
	},

	renderSettings(el, ctx) {
		new Setting(el)
			.setName(ctx.t("pages.onePage.name"))
			.setDesc(ctx.t("pages.onePage.desc"))
			.addToggle((t) => t.setValue(ctx.settings.onePage).onChange((v) => ctx.updateSettings({ onePage: v })));
		new Setting(el)
			.setName(ctx.t("pages.linkLabel.name"))
			.setDesc(ctx.t("pages.linkLabel.desc"))
			.addText((t) => t.setPlaceholder(ctx.t("pages.link")).setValue(ctx.settings.linkLabel).onChange((v) => ctx.updateSettings({ linkLabel: v })));
	},
});

/** A card's title for lists: the first line of its text, a file's name, a group's label. */
function nodeLabel(node: CanvasNodeLike): string {
	const type = nodeType(node);
	if (type === "group") return node.label ?? "";
	if (type === "file") return (node.filePath ?? "").split("/").pop()?.replace(/\.md$/, "") ?? "";
	if (type === "link") return String((node.getData() as { url?: string }).url ?? "");
	return titleOf(node.text ?? "");
}

interface IndexHost {
	pagesOf(canvas: CanvasLike): PageInfo[];
	current(canvas: CanvasLike): string;
	show(canvas: CanvasLike, page: string): void;
	pageTitle(canvas: CanvasLike, page: string): string;
	merge(canvas: CanvasLike, page: string): void;
	count(canvas: CanvasLike, page: string): number;
}

/** The pages of the canvas in front, as a tree; a click shows that page. */
class PagesView extends ItemView {
	private canvas: CanvasLike | null = null;
	private timer = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: Ctx,
		private readonly host: IndexHost,
	) {
		super(leaf);
	}

	getViewType(): string {
		return PAGES_VIEW;
	}

	getDisplayText(): string {
		return this.ctx.t("pages.index");
	}

	override getIcon(): string {
		return "list-tree";
	}

	protected override async onOpen(): Promise<void> {
		this.contentEl.addClass("opc-pages-view");
		this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.track()));
		this.track(true);
	}

	/** Follows the most recently active canvas. */
	track(force = false): void {
		const prev = this.canvas;
		const leaf = this.app.workspace.getMostRecentLeaf();
		const view = leaf?.view as { getViewType(): string; canvas?: CanvasLike } | undefined;
		if (view?.getViewType() === "canvas" && view.canvas) this.canvas = view.canvas;
		else if (this.canvas && !this.canvas.wrapperEl.isConnected) this.canvas = null;
		if (force || this.canvas !== prev) this.render();
	}

	refresh(canvas?: CanvasLike): void {
		if ((canvas && canvas !== this.canvas) || this.timer) return;
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			this.track(true);
		}, 80);
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		const canvas = this.canvas;
		root.createDiv({ cls: "opc-pages-heading", text: this.ctx.t("pages.index") });
		if (!canvas) {
			root.createDiv({ cls: "pane-empty", text: this.ctx.t("pages.index.noCanvas") });
			return;
		}
		const pages = this.host.pagesOf(canvas);
		const children = pageChildren(pages);
		const current = this.host.current(canvas);
		const list = root.createDiv({ cls: "opc-pages-tree", attr: { role: "tree" } });
		const row = (id: string, depth: number) => {
			const item = list.createDiv({ cls: "opc-pages-item", attr: { role: "treeitem", tabindex: "0" } });
			item.setCssProps({ "--opc-pages-depth": String(depth) });
			item.toggleClass("is-current", id === current);
			setIcon(item.createSpan({ cls: "opc-pages-icon" }), id ? "file-text" : "home");
			item.createSpan({ cls: "opc-pages-title", text: this.host.pageTitle(canvas, id) });
			item.createSpan({ cls: "opc-pages-count", text: String(this.host.count(canvas, id)) });
			const open = () => {
				this.host.show(canvas, id);
				this.render();
			};
			item.addEventListener("click", open);
			item.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") open();
			});
			for (const child of children.get(id) ?? []) row(child.id, depth + 1);
		};
		row("", 0);
		if (pages.length === 0) root.createDiv({ cls: "opc-pages-empty", text: this.ctx.t("pages.index.empty") });
	}
}
