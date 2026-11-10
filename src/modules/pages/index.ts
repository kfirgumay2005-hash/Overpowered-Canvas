import { ItemView, Notice, Setting, TFile, setIcon, setTooltip, type App, type Menu, type WorkspaceLeaf } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData } from "../../data/json-canvas";
import { SCHEMA_KEY, type MapLayout, type PageInfo } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mapRootOf, relayoutMap } from "../auto-layout/arrange";
import { centerOn, mutate, nodeType, randomId, renderedZ, selectedNodes } from "../shared";
import { pageSources, pagesHost, type PagesSource } from "./api";
import { renderPagesBar } from "./bar";
import { boundsOf, branchOf, cardLink, freeRegion, pageChildren, pointLinksAt, titleOf, withLink, withoutLink, withoutPage, type PlanNode } from "./logic";
import { logError } from "../../core/log";
import { debugMode, debugNotice } from "../../core/debug";
import { joinTopLane, LANE_RANK } from "../../ui/top-lane";
import { escapeMarkdown, plainTitle, renderTitle, titleMarkdown } from "../../ui/card-title";

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
	/** The view knew its file when the state was read: a view that is opening doesn't yet. */
	restored: boolean;
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
		/** Files to frame on the remembered page when they open (coming from another view). */
		const framing = new Set<string>();
		const placing = new Map<CanvasLike, Placing>();
		/** Nodes this module adds itself: their page is set already. */
		const ours = new Set<string>();
		/**
		 * New cards until their page is written. The core and the tools select a card as soon as they
		 * create it: until then it counts as on the page shown, or that selection would switch pages.
		 */
		const arriving = new Set<CanvasNodeLike>();
		let replaying = 0;

		const label = () => ctx.settings.linkLabel || ctx.t("pages.link");
		const pagesOf = (canvas: CanvasLike): PageInfo[] => ctx.data.root(canvas).get().pages ?? [];
		const pageOf = (node: CanvasNodeLike): string => ctx.data.node(node).get().page ?? "";
		const hasPages = (canvas: CanvasLike) => pagesOf(canvas).length > 0;
		const hiding = (canvas: CanvasLike) => ctx.settings.onePage && hasPages(canvas);
		const isHidden = (node: CanvasNodeLike) => node.nodeEl.hasClass(HIDDEN);
		const offPage = (node: CanvasNodeLike) => hiding(node.canvas) && !arriving.has(node) && pageOf(node) !== current(node.canvas);

		const stateOf = (canvas: CanvasLike): ViewState => {
			let s = views.get(canvas);
			if (!s) {
				s = { page: "", viewports: new Map(), restored: false };
				views.set(canvas, s);
			}
			const path = canvas.view.file?.path;
			if (!s.restored && path) {
				s.restored = true;
				s.page = lastPage.get(path) ?? "";
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
			for (const n of canvas.nodes.values()) n.nodeEl.toggleClass(HIDDEN, offPage(n));
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
			if (debugMode()) {
				const all = ["", ...pagesOf(canvas).map((p) => p.id)];
				debugNotice("debug.nav.shown", { page: plainTitle(pageTitle(canvas, page)), at: `${all.indexOf(page) + 1} / ${all.length}`, place: path ?? "" });
			}
		};

		/** A page's title as one line of Markdown (its first card's first line). */
		const pageTitle = (canvas: CanvasLike, page: string): string => {
			if (!page) return escapeMarkdown(canvas.view.file?.basename ?? ctx.t("pages.main"));
			const info = pagesOf(canvas).find((p) => p.id === page);
			const root = info ? canvas.nodes.get(info.root) : undefined;
			const text = root ? (nodeType(root) === "text" ? titleMarkdown(root.text ?? "") : escapeMarkdown(nodeLabel(root))) : "";
			return text || escapeMarkdown(ctx.t("pages.untitled"));
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
				// A plugin reload leaves the old bar behind.
				canvas.wrapperEl.querySelectorAll(".opc-pages-bar").forEach((el) => el.remove());
				bar = canvas.wrapperEl.createDiv({ cls: "opc-pages-bar" });
				joinTopLane(canvas.wrapperEl, bar, LANE_RANK.pages);
				// The bar is not part of the board: no panning or selecting through it.
				bar.addEventListener("pointerdown", (evt) => evt.stopPropagation());
				bars.set(canvas, bar);
			}
			renderPagesBar(ctx.app, bar, sourceOf(canvas), ctx.t, () => void openIndex(), ctx.settings.onePage);
		};

		/** The pages of a canvas on the board, for the bar and the index. */
		const sourceOf = (canvas: CanvasLike): PagesSource => ({
			key: canvas,
			path: canvas.view.file?.path,
			alive: () => canvas.wrapperEl.isConnected,
			pages: () => pagesOf(canvas),
			current: () => current(canvas),
			title: (page) => pageTitle(canvas, page),
			count: (page) => [...canvas.nodes.values()].filter((n) => pageOf(n) === page).length,
			show: (page) => show(canvas, page),
			...(canvas.readonly ? {} : { merge: (page: string) => void mergePage(canvas, page) }),
		});

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
			// The page's root is a copy: copies never join the anchor's smart group.
			delete extra.smartGroup;
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
				// The branch's sibling order goes with it to the new root.
				const { [anchor.id]: kept, ...order } = root0.get().childOrder ?? {};
				if (kept) root0.set({ childOrder: { ...order, [rootId]: kept } });
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
				centerOn(canvas, root);
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
				// Back under the anchor, in the order the page had.
				const { [root?.id ?? ""]: back, ...order } = ctx.data.root(canvas).get().childOrder ?? {};
				if (anchor && back) ctx.data.root(canvas).set({ childOrder: { ...order, [anchor.id]: back } });
				ctx.data.root(canvas).set({ pages: withoutPage(pagesOf(canvas), pageId), mapLayouts: Object.keys(nextLayouts).length ? nextLayouts : undefined });
				if (pagesOf(canvas).length === 0) ctx.data.root(canvas).set({ pages: undefined });
			});
			if (!ok) return;
			show(canvas, info.parent ?? "", { keepView: true });
			if (anchor) {
				await relayoutMap(ctx, canvas, anchor).catch((e) => logError("[overpowered-canvas] pages: layout", e));
				canvas.selectOnly(anchor);
				centerOn(canvas, anchor);
			}
			ctx.events.emit("page-merged", canvas, pageId);
		};

		// ---------- a copy with pages (templates) ----------

		const insertWithPages = (canvas: CanvasLike, data: CanvasFileData, center: { x: number; y: number }): CanvasNodeLike[] | null => {
			if (canvas.readonly) return null;
			const extra = (data[SCHEMA_KEY] ?? {}) as { pages?: PageInfo[]; mapLayouts?: Record<string, string> };
			const incoming = extra.pages ?? [];
			const known = new Set(incoming.map((p) => p.id));
			const pageOfData = (n: CanvasNodeData) => {
				const page = (n[SCHEMA_KEY] as { page?: string } | undefined)?.page ?? "";
				return known.has(page) ? page : "";
			};
			const nodes = data.nodes ?? [];
			const here = current(canvas);
			// The main page: centered where asked, on the page shown.
			const parts = new Map<string, CanvasNodeData[]>();
			for (const n of nodes) (parts.get(pageOfData(n)) ?? parts.set(pageOfData(n), []).get(pageOfData(n))!).push(n);
			const placed: CanvasNodeData[] = [];
			const occupied = planNodes(canvas).map((n) => ({ x: n.x, y: n.y, width: n.width, height: n.height }));
			for (const [page, list] of parts) {
				const box = boundsOf(list)!;
				const target = page ? freeRegion([...occupied, ...placed]) : { x: Math.round(center.x - (box.maxX - box.minX) / 2), y: Math.round(center.y - (box.maxY - box.minY) / 2) };
				const dx = target.x - box.minX;
				const dy = target.y - box.minY;
				for (const n of list) {
					const x = { ...((n[SCHEMA_KEY] as Record<string, unknown> | undefined) ?? { v: 1 }) };
					if (page) x.page = page;
					else if (here) x.page = here;
					else delete x.page;
					placed.push({ ...n, x: n.x + dx, y: n.y + dy, [SCHEMA_KEY]: x });
				}
			}
			const pages: PageInfo[] = incoming.map((p) => {
				const parent = p.parent && known.has(p.parent) ? p.parent : here;
				return { id: p.id, anchor: p.anchor, root: p.root, ...(parent ? { parent } : {}) };
			});
			for (const n of placed) ours.add(n.id);
			let added: Set<CanvasNodeLike> | undefined;
			const ok = mutate(ctx, canvas, () => {
				added = canvas.importData({ nodes: placed, edges: data.edges ?? [] }, false);
				const root = ctx.data.root(canvas);
				root.set({ pages: [...pagesOf(canvas), ...pages] });
				if (extra.mapLayouts && Object.keys(extra.mapLayouts).length) root.set({ mapLayouts: { ...(root.get().mapLayouts ?? {}), ...(extra.mapLayouts as Record<string, MapLayout>) } });
			});
			for (const n of placed) ours.delete(n.id);
			if (!ok) return null;
			decorate(canvas);
			return [...(added ?? [])];
		};

		// ---------- copies of a canvas: links point at the copy ----------

		/** Links between the cards of this canvas that still name the file it was copied from. */
		const relink = (canvas: CanvasLike) => {
			const file = canvas.view.file;
			if (!file || canvas.readonly) return;
			const linktext = linktextOf(canvas);
			const nodes = [...canvas.nodes.values()].map((n) => ({ id: n.id, type: nodeType(n), ...(nodeType(n) === "text" ? { text: n.text ?? "" } : {}), node: n }));
			const fixed = pointLinksAt(nodes, linktext, (path) => elsewhere(path, file));
			if (!fixed) return;
			for (const n of fixed) if (n.text !== undefined && n.text !== n.node.text) n.node.setData({ ...n.node.getData(), text: n.text });
			canvas.requestSave();
		};
		/** A link path that names a canvas other than `file`. */
		const elsewhere = (path: string, file: TFile) => {
			const dest = ctx.app.metadataCache.getFirstLinkpathDest(path, file.path);
			return !!dest && dest !== file && dest.extension === "canvas";
		};
		/** A canvas file just made (a copy, a template): fixed in the file, before it is opened. */
		const relinkFile = async (file: TFile) => {
			const text = await ctx.app.vault.read(file);
			let data: CanvasFileData;
			try {
				data = JSON.parse(text) as CanvasFileData;
			} catch {
				return;
			}
			const linktext = ctx.app.metadataCache.fileToLinktext(file, "", false);
			const fixed = pointLinksAt(data.nodes ?? [], linktext, (path) => elsewhere(path, file));
			if (!fixed) return;
			await ctx.app.vault.process(file, (current) => (current === text ? JSON.stringify({ ...data, nodes: fixed }, null, "	") : current));
		};
		ctx.app.workspace.onLayoutReady(() =>
			ctx.registerEvent(
				ctx.app.vault.on("create", (file) => {
					if (file instanceof TFile && file.extension === "canvas") void relinkFile(file).catch((e) => logError("[overpowered-canvas] pages: relink a copy", e));
				}),
			),
		);

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
				if (ctx.isShortcut("pages.cancelPlacing", evt) && ctx.activeCanvas() === canvas) stopPlacing(canvas);
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
			apply: (node) => node.nodeEl.toggleClass(HIDDEN, offPage(node)),
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
		ctx.on("data-load", (canvas) => {
			// A copy made while the plugin was off still links to the canvas it was copied from.
			relink(canvas);
			decorate(canvas);
			const path = canvas.view.file?.path;
			if (!path || !framing.delete(path)) return;
			const box = pageBox(canvas, current(canvas));
			if (box) canvas.zoomToBbox(box);
		});
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
			arriving.add(node);
			node.nodeEl.removeClass(HIDDEN);
			queueMicrotask(() => {
				arriving.delete(node);
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
			remember: (path, page) => {
				lastPage.set(path, page);
				framing.add(path);
			},
			openIndex: () => openIndex(),
			refreshIndex: () => refreshViews(),
			show: (canvas, page) => show(canvas, page),
			keepingPages: (fn) => {
				replaying++;
				try {
					return fn();
				} finally {
					replaying--;
				}
			},
			insertWithPages: (canvas, data, center) => insertWithPages(canvas, data, center),
		};
		ctx.register(() => (pagesHost.api = null));

		// ---------- the index ----------

		const refreshViews = (canvas?: CanvasLike) => {
			for (const leaf of ctx.app.workspace.getLeavesOfType(PAGES_VIEW)) {
				const view = leaf.view;
				if (view instanceof PagesView) view.refresh(canvas);
			}
		};
		ctx.registerView(PAGES_VIEW, (leaf) => new PagesView(leaf, ctx, sourceOf));
		const openIndex = async () => {
			const existing = ctx.app.workspace.getLeavesOfType(PAGES_VIEW)[0];
			if (existing) await ctx.app.workspace.revealLeaf(existing);
			else {
				const leaf = ctx.app.workspace.getLeftLeaf(false);
				if (!leaf) return;
				await leaf.setViewState({ type: PAGES_VIEW, active: true });
				await ctx.app.workspace.revealLeaf(leaf);
			}
			if (debugMode()) {
				// Checked a moment later: on a tablet the side drawer can close right after opening.
				window.setTimeout(() => {
					const index = ctx.app.workspace.getLeavesOfType(PAGES_VIEW)[0];
					const shown = !!index && (index.getRoot() !== ctx.app.workspace.leftSplit || !ctx.app.workspace.leftSplit.collapsed);
					debugNotice(shown ? "debug.nav.indexOpen" : "debug.nav.indexClosed");
				}, 800);
			}
		};

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
		ctx.addCommand({ id: "open-index", name: ctx.t("pages.index.open"), icon: "list-tree", callback: () => void openIndex() });
		command("main-page", ctx.t("pages.goMain"), "home", (c) => hasPages(c) && current(c) !== "", (c) => show(c, ""));
		command("parent-page", ctx.t("pages.goUp"), "arrow-up-left", (c) => hasPages(c) && current(c) !== "", (c) => {
			const info = pagesOf(c).find((p) => p.id === current(c));
			if (info) goTo(c, info.anchor);
		});
		/** The page a selected card opens, else the page shown ("" = the main page: nothing to merge). */
		const pageToMerge = (c: CanvasLike): string => {
			const n = oneCard(c);
			return (n && pageLinkOf(c, n).leadsTo?.id) || current(c);
		};
		command("merge-page", ctx.t("pages.merge"), "combine", (c) => !c.readonly && hasPages(c) && !!pageToMerge(c), (c) => void mergePage(c, pageToMerge(c)));
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
				const page = l.leadsTo.id;
				menu.addItem((i) => i.setSection("opc-pages").setTitle(ctx.t("pages.openPage")).setIcon("arrow-right-from-line").onClick(() => goTo(canvas, target)));
				if (!canvas.readonly) menu.addItem((i) => i.setSection("opc-pages").setTitle(ctx.t("pages.merge")).setIcon("combine").onClick(() => void mergePage(canvas, page)));
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

/** The pages of the canvas in front (on the board or as text), as a tree; a click shows that page. */
/** Where the index remembers the folded pages (per vault): file path → ids of the pages folded there. */
const FOLDED_KEY = "overpowered-canvas:pages-folded";
/** Files remembered at most (the oldest are forgotten). */
const FOLDED_FILES = 200;

function readFolded(app: App): Record<string, string[]> {
	try {
		const raw: unknown = app.loadLocalStorage(FOLDED_KEY);
		return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, string[]>) : {};
	} catch {
		return {};
	}
}

function writeFolded(app: App, all: Record<string, string[]>): void {
	try {
		const entries = Object.entries(all).filter(([, ids]) => Array.isArray(ids) && ids.length);
		app.saveLocalStorage(FOLDED_KEY, Object.fromEntries(entries.slice(-FOLDED_FILES)));
	} catch {
		// Storage blocked or full: the folds last for this session only.
	}
}

class PagesView extends ItemView {
	private source: PagesSource | null = null;
	private timer = 0;
	/** Pages whose pages are folded away, per file (and without a file, for this session). */
	private readonly folded = new Map<string, Set<string>>();
	/** The page shown at the last drawing: a page newly shown inside a folded one unfolds it. */
	private lastCurrent: string | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly ctx: Ctx,
		private readonly sourceOf: (canvas: CanvasLike) => PagesSource,
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
		const prev = this.source?.key;
		const leaf = this.app.workspace.getMostRecentLeaf();
		const view = leaf?.view as { getViewType(): string; canvas?: CanvasLike; pagesSource?(): PagesSource | null } | undefined;
		let own = view?.pagesSource?.() ?? null;
		for (const provider of pageSources) own ??= provider(view);
		if (own) this.source = own;
		else if (view?.getViewType() === "canvas" && view.canvas) this.source = this.sourceOf(view.canvas);
		else if (this.source && !this.source.alive()) this.source = null;
		if (force || this.source?.key !== prev) this.render();
	}

	refresh(canvas?: CanvasLike): void {
		if ((canvas && canvas !== this.source?.key) || this.timer) return;
		this.timer = window.setTimeout(() => {
			this.timer = 0;
			this.track(true);
		}, 80);
	}

	private foldsOf(source: PagesSource): Set<string> {
		const key = source.path ?? "";
		let set = this.folded.get(key);
		if (!set) {
			set = new Set(source.path ? (readFolded(this.app)[source.path] ?? []) : []);
			this.folded.set(key, set);
		}
		return set;
	}

	private saveFolds(source: PagesSource): void {
		if (!source.path) return;
		const all = readFolded(this.app);
		delete all[source.path];
		all[source.path] = [...(this.folded.get(source.path) ?? [])];
		writeFolded(this.app, all);
	}

	render(): void {
		const root = this.contentEl;
		root.empty();
		const source = this.source;
		root.createDiv({ cls: "opc-pages-heading", text: this.ctx.t("pages.index") });
		if (!source) {
			root.createDiv({ cls: "pane-empty", text: this.ctx.t("pages.index.noCanvas") });
			return;
		}
		const pages = source.pages();
		const children = pageChildren(pages);
		const current = source.current();
		const folded = this.foldsOf(source);
		// A page just shown inside a folded one: the pages above it open, so it can be seen.
		if (current !== this.lastCurrent) {
			const parents = new Map(pages.map((p) => [p.id, p.parent ?? ""]));
			let changed = false;
			for (let up = parents.get(current); up !== undefined; up = up ? parents.get(up) : undefined) {
				if (folded.delete(up)) changed = true;
				if (!up) break;
			}
			if (changed) this.saveFolds(source);
			this.lastCurrent = current;
		}
		const list = root.createDiv({ cls: "opc-pages-tree", attr: { role: "tree" } });
		const row = (id: string, depth: number) => {
			const kids = children.get(id) ?? [];
			const closed = kids.length > 0 && folded.has(id);
			const item = list.createDiv({ cls: "opc-pages-item", attr: { role: "treeitem", tabindex: "0" } });
			item.setCssProps({ "--opc-pages-depth": String(depth) });
			item.toggleClass("is-current", id === current);
			item.toggleClass("has-pages", kids.length > 0);
			item.toggleClass("is-folded", closed);
			if (kids.length) item.setAttr("aria-expanded", String(!closed));
			// The page's icon folds and unfolds its pages; its name shows it.
			const marker = item.createSpan({ cls: "opc-pages-icon" });
			if (kids.length) setIcon(marker.createSpan({ cls: "opc-pages-fold" }), "right-triangle");
			setIcon(marker.createSpan({ cls: "opc-pages-glyph" }), id ? "file-text" : "home");
			const fold = (to: boolean) => {
				if (!kids.length || to === folded.has(id)) return;
				if (to) folded.add(id);
				else folded.delete(id);
				this.saveFolds(source);
				this.render();
			};
			if (kids.length) {
				const label = this.ctx.t(closed ? "pages.index.unfold" : "pages.index.fold");
				marker.setAttrs({ role: "button", "aria-label": label });
				setTooltip(marker, label);
				marker.addEventListener("click", (evt) => {
					evt.stopPropagation();
					fold(!folded.has(id));
				});
			}
			renderTitle(this.ctx.app, item.createSpan({ cls: "opc-pages-title" }), source.title(id), source.path ?? "");
			item.createSpan({ cls: "opc-pages-count", text: String(source.count(id)) });
			if (id && source.merge) {
				const merge = item.createEl("button", { cls: "clickable-icon opc-pages-merge", attr: { "aria-label": this.ctx.t("pages.merge") } });
				setIcon(merge, "combine");
				setTooltip(merge, this.ctx.t("pages.merge"));
				merge.addEventListener("click", (evt) => {
					evt.stopPropagation();
					source.merge?.(id);
				});
			}
			const open = () => {
				source.show(id);
				this.render();
			};
			item.addEventListener("click", open);
			item.addEventListener("keydown", (evt) => {
				if (evt.key === "Enter") open();
				else if (evt.key === "ArrowLeft" || evt.key === "ArrowRight") {
					// Toward the end of the line opens, toward its start folds (as file trees do).
					const rtl = getComputedStyle(item).direction === "rtl";
					fold((evt.key === "ArrowLeft") !== rtl);
				}
			});
			if (!closed) for (const child of kids) row(child.id, depth + 1);
		};
		row("", 0);
		if (pages.length === 0) root.createDiv({ cls: "opc-pages-empty", text: this.ctx.t("pages.index.empty") });
	}
}
