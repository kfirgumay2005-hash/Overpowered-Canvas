import { MarkdownView, Notice, Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { EdgeSide } from "../../data/json-canvas";
import type { CanvasLike, CanvasNodeLike, CanvasViewLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { getElk } from "../auto-layout/engine";
import { layoutMap } from "../canvas-markdown/apply";
import { estimateSize } from "../canvas-markdown/size";
import { childPosition, childrenOf, directionBetween, logical, parentOf, type Dir, type TEdge, type TNode } from "../mindmap/tree";
import { canvasDirection, mutate, nodeType, randomId } from "../shared";
import { blockAt, type Block } from "./block";

interface NoteBlocksSettings {
	/** Hold this long (ms) on a line to pick up its block. */
	holdMs: number;
	/** A drag handle beside the line under the mouse. */
	handle: boolean;
	/** "Add as child" / "Add as sibling" targets over mind-map cards while dragging. */
	dropZones: boolean;
	/** Label of the group that clicked blocks are sent to (inbox mode). */
	inboxName: string;
	/** The handle's look: an emoji or short text ("" = the dot grip). */
	handleSymbol: string;
	/** The handle's look as a small image (data URL; wins over the symbol). */
	handleImage: string;
}

const SIDE: Record<Dir, EdgeSide> = { right: "right", left: "left", down: "bottom", up: "top" };
const OPPOSITE: Record<Dir, EdgeSide> = { right: "left", left: "right", down: "top", up: "bottom" };
/** A press that moves farther than this (px) is a scroll or a selection, not a hold. */
const SLOP = 8;
const MAX_WIDTH = 480;
/** Around a card and its child / sibling targets (px), the targets stay while dragging. */
const ZONE_MARGIN = 24;
/** How far left of the text (px) the pointer still counts as on a line: the way to the handle. */
const HANDLE_REACH = 48;
/** Custom handle images are scaled down to this size (px) before they are stored. */
const IMAGE_SIZE = 64;
/** Longest custom handle symbol (characters). */
const SYMBOL_MAX = 4;

const shortSymbol = (v: string) => [...v.trim()].slice(0, SYMBOL_MAX).join("");

/** Reads an image file and returns it scaled to fit IMAGE_SIZE, as a PNG data URL. */
async function shrinkImage(file: File): Promise<string> {
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		const w = img.naturalWidth || IMAGE_SIZE;
		const h = img.naturalHeight || IMAGE_SIZE;
		const scale = Math.min(1, IMAGE_SIZE / Math.max(w, h));
		const canvas = createEl("canvas");
		canvas.width = Math.max(1, Math.round(w * scale));
		canvas.height = Math.max(1, Math.round(h * scale));
		canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
		return canvas.toDataURL("image/png");
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** The parts of CodeMirror's EditorView used here (Obsidian's editor exposes it as `cm`). */
interface CmView {
	posAtCoords(coords: { x: number; y: number }, precise?: false): number | null;
	coordsAtPos(pos: number): { top: number; bottom: number; left: number } | null;
	state: { doc: { lineAt(pos: number): { number: number; from: number }; line(n: number): { from: number; to: number } } };
	contentDOM: HTMLElement;
	scrollDOM: HTMLElement;
}

function cmOf(view: MarkdownView): CmView | null {
	const cm = (view.editor as unknown as { cm?: CmView }).cm;
	return cm && typeof cm.posAtCoords === "function" ? cm : null;
}

/** The block under a screen point of an editor, with its lines (0-based). */
function blockUnder(view: MarkdownView, x: number, y: number): Block | null {
	const cm = cmOf(view);
	if (!cm) return null;
	const pos = cm.posAtCoords({ x, y }, false);
	if (pos === null) return null;
	const line = cm.state.doc.lineAt(pos).number - 1;
	return blockAt(view.editor.getValue().split("\n"), line);
}

type Zone = "child" | "sibling";

interface Target {
	canvas: CanvasLike;
	/** Canvas coordinates of the pointer. */
	pos: { x: number; y: number };
	/** A drop zone under the pointer, and the card it belongs to. */
	zone: { kind: Zone; node: CanvasNodeLike } | null;
}

/**
 * Note blocks → canvas: hold a line (or grab its handle) to pick up the whole block — a bullet
 * with its children, a heading with its section, a paragraph — and drop it on a canvas as a
 * card, or onto a mind-map card's "child" / "sibling" target. Inbox mode sends clicked blocks
 * into a named group of the open canvas. Pointer and touch events both drive it (iPad).
 */
export const noteBlocksModule = defineModule<NoteBlocksSettings>({
	id: "note-blocks",
	name: "noteBlocks.name",
	description: "noteBlocks.desc",
	group: "data",
	defaultEnabled: true,
	defaultSettings: { holdMs: 350, handle: true, dropZones: true, inboxName: "Inbox", handleSymbol: "", handleImage: "" },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			holdMs: typeof s.holdMs === "number" && s.holdMs >= 150 && s.holdMs <= 2000 ? s.holdMs : defaults.holdMs,
			handle: typeof s.handle === "boolean" ? s.handle : defaults.handle,
			dropZones: typeof s.dropZones === "boolean" ? s.dropZones : defaults.dropZones,
			inboxName: typeof s.inboxName === "string" && s.inboxName.trim() ? s.inboxName.trim() : defaults.inboxName,
			handleSymbol: typeof s.handleSymbol === "string" ? shortSymbol(s.handleSymbol) : defaults.handleSymbol,
			handleImage: typeof s.handleImage === "string" && s.handleImage.startsWith("data:image/") ? s.handleImage : defaults.handleImage,
		};
	},

	enable(ctx) {
		const app = ctx.app;
		const t = ctx.t;
		let inbox = false;

		// ---- Placing cards ---------------------------------------------------------------

		const sizeFor = (canvas: CanvasLike, text: string) => {
			const base = canvas.config.defaultTextNodeDimensions;
			const est = estimateSize(text, Math.max(base.width, MAX_WIDTH));
			return { width: Math.max(base.width, est.width), height: Math.max(base.height, est.height) };
		};

		const edgesOf = (canvas: CanvasLike): TEdge[] => [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id }));

		/** Which way a card's children grow: from its children, else from its own parent, else forward. */
		const growth = (canvas: CanvasLike, node: CanvasNodeLike): Dir => {
			const edges = edgesOf(canvas);
			const kid = childrenOf(edges, node.id).map((id) => canvas.nodes.get(id)).find((n) => !!n);
			if (kid) return directionBetween(node, kid);
			const parent = parentOf(edges, node.id);
			const p = parent ? canvas.nodes.get(parent) : undefined;
			if (p) return directionBetween(p, node);
			return logical("right", canvasDirection(canvas) === "rtl");
		};

		/** Re-arranges a map that has a recorded layout (auto layout or built from a note). */
		const relayout = async (canvas: CanvasLike, start: CanvasNodeLike) => {
			const edges = edgesOf(canvas);
			let root = start.id;
			const seen = new Set<string>();
			for (let p = parentOf(edges, root); p && !seen.has(p); p = parentOf(edges, root)) {
				seen.add(root);
				root = p;
			}
			const layout = ctx.data.root(canvas).get().mapLayouts?.[root];
			if (!layout || layout === "grid" || layout.startsWith("layered")) return;
			const kids = new Map<string, string[]>();
			const ids: string[] = [];
			const stack = [root];
			const visited = new Set<string>();
			while (stack.length) {
				const id = stack.pop()!;
				if (visited.has(id)) continue;
				visited.add(id);
				ids.push(id);
				const children = childrenOf(edges, id).filter((c) => !visited.has(c) && canvas.nodes.has(c));
				kids.set(id, children);
				stack.push(...children);
			}
			const nodes: TNode[] = ids.map((id) => {
				const n = canvas.nodes.get(id)!;
				return { id, x: n.x, y: n.y, width: n.width, height: n.height };
			});
			const tree = ids.flatMap((id) => (kids.get(id) ?? []).map((c) => ({ from: id, to: c })));
			const pos = await layoutMap(getElk(), nodes, tree, root, kids, layout, { rtl: canvasDirection(canvas) === "rtl", spacing: 30, levelSpacing: 80 });
			// Keep the root where it is.
			const r = canvas.nodes.get(root)!;
			const p0 = pos.get(root);
			if (!p0) return;
			const dx = r.x - p0.x;
			const dy = r.y - p0.y;
			mutate(ctx, canvas, () => {
				for (const id of ids) {
					const p = pos.get(id);
					if (p) canvas.nodes.get(id)!.moveTo({ x: Math.round(p.x + dx), y: Math.round(p.y + dy) });
				}
			});
		};

		const dropCard = (target: Target, text: string): CanvasNodeLike | null => {
			const { canvas } = target;
			if (canvas.readonly) return null;
			const size = sizeFor(canvas, text);
			let created: CanvasNodeLike | null = null;
			let parent: CanvasNodeLike | null = null;
			let dir: Dir = "right";
			if (target.zone) {
				const node = target.zone.node;
				if (target.zone.kind === "child") parent = node;
				else {
					const p = parentOf(edgesOf(canvas), node.id);
					parent = p ? (canvas.nodes.get(p) ?? null) : null;
				}
				dir = parent ? (target.zone.kind === "sibling" ? directionBetween(parent, node) : growth(canvas, parent)) : "down";
			}
			const ok = mutate(ctx, canvas, () => {
				let pos: { x: number; y: number };
				if (parent) {
					const kids = childrenOf(edgesOf(canvas), parent.id).map((id) => canvas.nodes.get(id)).filter((n): n is CanvasNodeLike => !!n);
					pos = childPosition(parent, kids, size, dir);
				} else if (target.zone) {
					// A sibling of a card without a parent: right below it.
					const n = target.zone.node;
					pos = { x: n.x, y: n.y + n.height + 30 };
				} else pos = { x: target.pos.x - size.width / 2, y: target.pos.y - size.height / 2 };
				created = canvas.createTextNode({ pos: { x: Math.round(pos.x), y: Math.round(pos.y) }, size, text, save: false, focus: false });
				if (parent && created) {
					const color = parent.color;
					canvas.importData({ nodes: [], edges: [{ id: randomId(), fromNode: parent.id, fromSide: SIDE[dir], toNode: created.id, toSide: OPPOSITE[dir], ...(color ? { color } : {}) }] }, false);
				}
			});
			if (!ok || !created) return null;
			const card: CanvasNodeLike = created;
			if (parent) void relayout(canvas, card).catch((e) => console.error("[overpowered-canvas] note-blocks layout", e));
			ctx.events.emit("note-block-dropped", canvas, card);
			return card;
		};

		// ---- Inbox -----------------------------------------------------------------------

		/** The canvas last worked in (still open), else a visible one, else any. */
		let lastCanvas: CanvasLike | null = null;
		ctx.registerEvent(
			app.workspace.on("active-leaf-change", (leaf) => {
				const view = leaf?.view as CanvasViewLike | undefined;
				if (view?.getViewType?.() === "canvas" && view.canvas) lastCanvas = view.canvas;
			}),
		);
		const activeCanvas = (): CanvasLike | null => {
			const open = app.workspace.getLeavesOfType("canvas").map((l) => (l.view as CanvasViewLike).canvas).filter((c): c is CanvasLike => !!c);
			if (lastCanvas && open.includes(lastCanvas)) return lastCanvas;
			return open.find((c) => c.wrapperEl.isShown()) ?? open[0] ?? null;
		};

		const sendToInbox = (text: string) => {
			const canvas = activeCanvas();
			if (!canvas) {
				new Notice(t("noteBlocks.noCanvas"));
				return;
			}
			const name = ctx.settings.inboxName.toLowerCase();
			const group = [...canvas.nodes.values()].find((n) => nodeType(n) === "group" && (n.label ?? "").trim().toLowerCase() === name);
			if (!group) {
				new Notice(t("noteBlocks.inbox.missing", { name: ctx.settings.inboxName }));
				return;
			}
			if (canvas.readonly) return;
			const size = sizeFor(canvas, text);
			const pad = 20;
			const inside = [...canvas.nodes.values()].filter((n) => n !== group && n.x >= group.x && n.y >= group.y && n.x + n.width <= group.x + group.width && n.y + n.height <= group.y + group.height);
			const bottom = inside.length ? Math.max(...inside.map((n) => n.y + n.height)) : group.y + pad;
			const rtl = canvasDirection(canvas) === "rtl";
			const pos = { x: rtl ? group.x + group.width - pad - size.width : group.x + pad, y: Math.round(bottom + pad) };
			let created: CanvasNodeLike | null = null;
			mutate(ctx, canvas, () => {
				created = canvas.createTextNode({ pos, size, text, save: false, focus: false });
				// The group grows to hold the new card.
				const needW = size.width + 2 * pad;
				const needH = pos.y + size.height + pad - group.y;
				if (group.width < needW || group.height < needH) {
					const width = Math.max(group.width, needW);
					group.moveAndResize({ x: rtl ? group.x + group.width - width : group.x, y: group.y, width, height: Math.max(group.height, needH) });
				}
			});
			if (created) {
				new Notice(t("noteBlocks.inbox.sent", { name: group.label ?? ctx.settings.inboxName }));
				ctx.events.emit("note-block-dropped", canvas, created);
			}
		};

		const toggleInbox = () => {
			inbox = !inbox;
			renderStatus();
			new Notice(inbox ? t("noteBlocks.inbox.on", { name: ctx.settings.inboxName }) : t("noteBlocks.inbox.off"));
		};
		const ribbon = ctx.addRibbonIcon("inbox", t("noteBlocks.ribbon"), toggleInbox);
		ribbon.addClass("opc-note-blocks-ribbon");
		const status = ctx.addStatusBarItem();
		status.addClass("opc-note-blocks-status");
		const renderStatus = () => {
			status.setText(inbox ? t("noteBlocks.inbox.status", { name: ctx.settings.inboxName }) : "");
			status.toggle(inbox);
			ribbon.toggleClass("is-active", inbox);
			ribbon.setAttr("aria-pressed", String(inbox));
		};
		status.onClickEvent(() => {
			inbox = false;
			renderStatus();
		});
		renderStatus();
		ctx.addCommand({
			id: "toggle-inbox",
			name: t("noteBlocks.cmd.inbox"),
			icon: "inbox",
			callback: toggleInbox,
		});

		// ---- Dragging --------------------------------------------------------------------

		/** Screen → canvas conversions use a rect the core measures on resize only; a layout
		 * change around the pane (a toolbar appearing above it) leaves it stale. */
		const fresh = (canvas: CanvasLike) => {
			const r = canvas.wrapperEl.getBoundingClientRect();
			const c = canvas.canvasRect;
			if (Math.abs(r.top - c.top) > 1 || Math.abs(r.left - c.left) > 1 || Math.abs(r.height - c.height) > 1 || Math.abs(r.width - c.width) > 1) canvas.onResize?.();
		};

		/** The canvas (and drop zone) under a screen point. */
		const targetAt = (x: number, y: number, zonesEl: HTMLElement | null): Target | null => {
			const el = activeDocument.elementFromPoint(x, y);
			const wrapper = el?.closest(".canvas-wrapper");
			if (!wrapper) return null;
			for (const leaf of app.workspace.getLeavesOfType("canvas")) {
				const canvas = (leaf.view as CanvasViewLike).canvas;
				if (!canvas || canvas.wrapperEl !== wrapper) continue;
				fresh(canvas);
				let zone: Target["zone"] = null;
				const z = el?.closest<HTMLElement>(".opc-note-blocks-zone");
				if (z && zonesEl?.contains(z)) {
					const node = canvas.nodes.get(zonesEl.dataset.node ?? "");
					if (node) zone = { kind: z.dataset.zone as Zone, node };
				}
				return { canvas, pos: canvas.posFromClient({ x, y }), zone };
			}
			return null;
		};

		/** The card under a canvas point that can take a child or a sibling. */
		const cardAt = (canvas: CanvasLike, p: { x: number; y: number }): CanvasNodeLike | null => {
			let best: CanvasNodeLike | null = null;
			for (const n of canvas.nodes.values()) {
				const type = nodeType(n);
				if (type === "group" || n.id.includes("~") || ctx.data.node(n).get().kind === "ink") continue;
				if (p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height) best = n;
			}
			return best;
		};

		/** Whether a screen point is still around a card and its targets (on the way to one). */
		const nearZones = (zones: HTMLElement | null, card: CanvasNodeLike | null, x: number, y: number): boolean => {
			if (!zones || !card) return false;
			const rects = [card.nodeEl.getBoundingClientRect(), ...[...zones.children].map((z) => z.getBoundingClientRect())];
			const left = Math.min(...rects.map((r) => r.left)) - ZONE_MARGIN;
			const right = Math.max(...rects.map((r) => r.right)) + ZONE_MARGIN;
			const top = Math.min(...rects.map((r) => r.top)) - ZONE_MARGIN;
			const bottom = Math.max(...rects.map((r) => r.bottom)) + ZONE_MARGIN;
			return x >= left && x <= right && y >= top && y <= bottom;
		};

		/** "Add as child" / "Add as sibling" targets around a card, on the side its map grows to. */
		const renderZones = (canvas: CanvasLike, card: CanvasNodeLike): HTMLElement => {
			const dir = growth(canvas, card);
			const r = card.nodeEl.getBoundingClientRect();
			const host = canvas.wrapperEl.getBoundingClientRect();
			const zones = canvas.wrapperEl.createDiv({ cls: "opc-note-blocks-zones" });
			zones.dataset.node = card.id;
			zones.dataset.dir = dir;
			const add = (kind: Zone, label: string, left: number, top: number) => {
				const z = zones.createDiv({ cls: `opc-note-blocks-zone is-${kind}`, text: label });
				z.dataset.zone = kind;
				z.style.left = `${left - host.left}px`;
				z.style.top = `${top - host.top}px`;
				// Keep it inside the canvas pane (a card at the edge would push it out of sight).
				const zr = z.getBoundingClientRect();
				const shiftX = zr.right > host.right - 4 ? host.right - 4 - zr.right : zr.left < host.left + 4 ? host.left + 4 - zr.left : 0;
				const shiftY = zr.bottom > host.bottom - 4 ? host.bottom - 4 - zr.bottom : zr.top < host.top + 4 ? host.top + 4 - zr.top : 0;
				if (shiftX || shiftY) {
					z.style.left = `${left - host.left + shiftX}px`;
					z.style.top = `${top - host.top + shiftY}px`;
				}
			};
			// Child on the side the map grows to; sibling after the card along its siblings.
			const cx = dir === "right" ? r.right + 8 : dir === "left" ? r.left - 8 : r.left + r.width / 2;
			const cy = dir === "down" ? r.bottom + 8 : dir === "up" ? r.top - 8 : r.top + r.height / 2;
			add("child", t("noteBlocks.zone.child"), cx, cy);
			const horizontal = dir === "right" || dir === "left";
			add("sibling", t("noteBlocks.zone.sibling"), horizontal ? r.left + r.width / 2 : r.right + 8, horizontal ? r.bottom + 8 : r.top + r.height / 2);
			return zones;
		};

		/** Text dragged the usual way (from a card being edited, or selected text in a note) gets
		 * the same targets: dropped on one, it becomes a linked card; elsewhere the core handles it. */
		ctx.onCanvas((canvas) => {
			const wrapper = canvas.wrapperEl;
			let zones: HTMLElement | null = null;
			let zoneNode: CanvasNodeLike | null = null;
			const clear = () => {
				zones?.remove();
				zones = null;
				zoneNode = null;
			};
			const textDrag = (e: DragEvent) => {
				const types = e.dataTransfer?.types ?? [];
				return types.includes("text/plain") && !types.includes("Files") && !types.includes("obsidian/canvas");
			};
			const zoneUnder = (e: DragEvent): { kind: Zone; node: CanvasNodeLike } | null => {
				const z = (activeDocument.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(".opc-note-blocks-zone");
				const node = zoneNode;
				return z && node && zones?.contains(z) ? { kind: z.dataset.zone as Zone, node } : null;
			};
			const onOver = (e: DragEvent) => {
				if (!ctx.settings.dropZones || canvas.readonly || !textDrag(e)) return;
				fresh(canvas);
				const hot = zoneUnder(e);
				zones?.querySelectorAll(".opc-note-blocks-zone").forEach((z) => z.toggleClass("is-hot", (z as HTMLElement).dataset.zone === hot?.kind));
				if (hot) {
					e.preventDefault();
					return;
				}
				const card = cardAt(canvas, canvas.posFromClient({ x: e.clientX, y: e.clientY }));
				if (card === zoneNode || (!card && nearZones(zones, zoneNode, e.clientX, e.clientY))) return;
				clear();
				if (card) {
					zoneNode = card;
					zones = renderZones(canvas, card);
				}
			};
			const onDrop = (e: DragEvent) => {
				const hot = textDrag(e) ? zoneUnder(e) : null;
				const text = e.dataTransfer?.getData("text/plain") ?? "";
				clear();
				if (!hot || !text.trim()) return;
				e.preventDefault();
				e.stopPropagation();
				dropCard({ canvas, pos: canvas.posFromClient({ x: e.clientX, y: e.clientY }), zone: hot }, text.trim());
			};
			const onLeave = (e: DragEvent) => {
				if (!e.relatedTarget || !wrapper.contains(e.relatedTarget as Node)) clear();
			};
			wrapper.addEventListener("dragover", onOver, true);
			wrapper.addEventListener("drop", onDrop, true);
			wrapper.addEventListener("dragleave", onLeave, true);
			wrapper.addEventListener("dragend", clear, true);
			return () => {
				clear();
				wrapper.removeEventListener("dragover", onOver, true);
				wrapper.removeEventListener("drop", onDrop, true);
				wrapper.removeEventListener("dragleave", onLeave, true);
				wrapper.removeEventListener("dragend", clear, true);
			};
		});

		const startDrag = (block: Block, source: MarkdownView, x: number, y: number, pointerId: number | null) => {
			const doc = activeDocument;
			const ghost = doc.body.createDiv({ cls: "opc-note-blocks-ghost" });
			ghost.setText(block.text.length > 240 ? `${block.text.slice(0, 240)}…` : block.text);
			let zones: HTMLElement | null = null;
			let zoneNode: CanvasNodeLike | null = null;
			let last = { x, y };
			doc.body.addClass("opc-note-blocks-dragging");
			doc.getSelection()?.removeAllRanges();

			const showZones = (target: Target | null, mx: number, my: number) => {
				const card = ctx.settings.dropZones && target ? cardAt(target.canvas, target.pos) : null;
				if (card === zoneNode && (card || !zones)) return;
				// Leaving the card towards one of its targets keeps them.
				if (!card && target && nearZones(zones, zoneNode, mx, my)) return;
				zones?.remove();
				zones = null;
				zoneNode = card;
				if (!card || !target) return;
				zones = renderZones(target.canvas, card);
			};

			const move = (mx: number, my: number) => {
				last = { x: mx, y: my };
				ghost.style.transform = `translate(${mx + 12}px, ${my + 12}px)`;
				const target = targetAt(mx, my, zones);
				ghost.toggleClass("is-over-canvas", !!target);
				ghost.toggleClass("is-compact", !!zones);
				zones?.querySelectorAll(".opc-note-blocks-zone").forEach((z) => z.toggleClass("is-hot", !!target?.zone && (z as HTMLElement).dataset.zone === target.zone.kind));
				if (!target?.zone) showZones(target, mx, my);
			};

			const finish = (drop: boolean) => {
				cleanup();
				if (!drop) return;
				const target = targetAt(last.x, last.y, zones);
				zones?.remove();
				if (target) dropCard(target, block.text);
			};

			const onPointerMove = (e: PointerEvent) => {
				if (pointerId !== null && e.pointerId !== pointerId) return;
				e.preventDefault();
				move(e.clientX, e.clientY);
			};
			const onPointerUp = (e: PointerEvent) => {
				if (pointerId !== null && e.pointerId !== pointerId) return;
				finish(true);
			};
			// A touch drag may lose its pointer stream to the browser; touch events carry on.
			const onTouchMove = (e: TouchEvent) => {
				e.preventDefault();
				const tt = e.touches[0];
				if (tt) move(tt.clientX, tt.clientY);
			};
			const onTouchEnd = () => finish(true);
			const onKey = (e: KeyboardEvent) => {
				if (e.key === "Escape") {
					e.preventDefault();
					finish(false);
				}
			};
			// A mouse hold started CodeMirror's selection drag: keep it from seeing the moves.
			const swallow = (e: MouseEvent) => e.stopPropagation();
			const win = doc.win;
			win.addEventListener("mousemove", swallow, true);
			win.addEventListener("mouseup", swallow, true);
			win.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
			win.addEventListener("pointerup", onPointerUp, true);
			win.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
			win.addEventListener("touchend", onTouchEnd, true);
			win.addEventListener("keydown", onKey, true);
			const cleanup = () => {
				win.removeEventListener("pointermove", onPointerMove, true);
				win.removeEventListener("pointerup", onPointerUp, true);
				win.removeEventListener("touchmove", onTouchMove, true);
				win.removeEventListener("touchend", onTouchEnd, true);
				win.removeEventListener("keydown", onKey, true);
				win.removeEventListener("mousemove", swallow, true);
				win.removeEventListener("mouseup", swallow, true);
				ghost.remove();
				doc.body.removeClass("opc-note-blocks-dragging");
				active = null;
				// The click that ends a mouse drag must not move the editor's cursor.
				win.setTimeout(() => (suppressClickUntil = 0), 0);
			};
			active = () => {
				zones?.remove();
				cleanup();
			};
			suppressClickUntil = Date.now() + 60_000;
			// Show what is being moved in the note (selecting would open the keyboard on touch).
			if (pointerId === null || !isTouch) source.editor.setSelection({ line: block.from, ch: 0 }, { line: block.to, ch: source.editor.getLine(block.to).length });
			move(x, y);
		};

		let active: (() => void) | null = null;
		let suppressClickUntil = 0;
		let isTouch = false;
		ctx.register(() => active?.());

		// ---- Editors: hold to pick up, handle on hover, click in inbox mode ----------------

		// The handle's look: the dot grip, or the user's own emoji or image.
		const handles = new Set<HTMLElement>();
		const styleHandle = (el: HTMLElement) => {
			const { handleImage, handleSymbol } = ctx.settings;
			el.empty();
			el.toggleClass("mod-image", !!handleImage);
			el.toggleClass("mod-symbol", !handleImage && !!handleSymbol);
			if (handleImage) el.createEl("img", { attr: { src: handleImage, alt: "", draggable: "false" } });
			else if (handleSymbol) el.setText(handleSymbol);
		};
		ctx.onSettingsChange((next, prev) => {
			if (next.handleImage !== prev.handleImage || next.handleSymbol !== prev.handleSymbol) for (const el of handles) styleHandle(el);
		});

		const attached = new WeakSet<MarkdownView>();
		const attach = (view: MarkdownView) => {
			if (attached.has(view)) return;
			attached.add(view);
			const content = view.contentEl;
			const handle = content.createDiv({ cls: "opc-note-blocks-handle", attr: { "aria-label": t("noteBlocks.handle") } });
			handle.hide();
			handles.add(handle);
			styleHandle(handle);
			let handleBlock: Block | null = null;
			/** Where the shown block's first line starts on screen. */
			let handleTextLeft = 0;
			let lastX = 0;
			let press: { x: number; y: number; id: number; timer: number; type: string } | null = null;

			const editing = () => view.getMode() === "source" && !!cmOf(view);
			const inText = (e: PointerEvent) => editing() && (e.target as HTMLElement | null)?.closest?.(".cm-content") != null;

			const cancelPress = () => {
				if (press) window.clearTimeout(press.timer);
				press = null;
			};

			const onDown = (e: PointerEvent) => {
				if (handle.contains(e.target as Node)) return;
				if (!inText(e) || (e.pointerType === "mouse" && e.button !== 0)) return;
				cancelPress();
				const id = e.pointerId;
				press = {
					x: e.clientX,
					y: e.clientY,
					id,
					type: e.pointerType,
					timer: window.setTimeout(() => {
						const p = press;
						press = null;
						if (!p) return;
						const block = blockUnder(view, p.x, p.y);
						if (!block) return;
						isTouch = p.type !== "mouse";
						navigator.vibrate?.(15);
						startDrag(block, view, p.x, p.y, id);
					}, ctx.settings.holdMs),
				};
			};
			const onMove = (e: PointerEvent) => {
				if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > SLOP) cancelPress();
				// Handle beside the line under the mouse.
				if (e.pointerType !== "mouse" || !ctx.settings.handle || active || !editing() || e.buttons) return;
				if (handle.contains(e.target as Node)) return;
				const cm = cmOf(view);
				const text = cm?.contentDOM.getBoundingClientRect();
				// The line goes by height alone, and the strip left of the text counts too: moving
				// sideways towards the handle never switches to another line.
				const near = !!text && e.clientY >= text.top && e.clientY <= text.bottom && e.clientX >= text.left - HANDLE_REACH && e.clientX <= text.right;
				// On the way to the handle (moving left, or already left of the text), a little up or
				// down keeps the same line.
				const towards = e.clientX < lastX || e.clientX < handleTextLeft;
				lastX = e.clientX;
				if (near && handleBlock && towards) {
					const r = handle.getBoundingClientRect();
					if (Math.abs(e.clientY - (r.top + r.bottom) / 2) <= r.height) return;
				}
				const block = near && text ? blockUnder(view, text.left + 1, e.clientY) : null;
				if (!block || !cm || !text) {
					handle.hide();
					handleBlock = null;
					return;
				}
				const coords = cm.coordsAtPos(cm.state.doc.line(block.from + 1).from);
				if (!coords) return;
				handle.show();
				const parent = (handle.offsetParent as HTMLElement | null) ?? content;
				const box = parent.getBoundingClientRect();
				// Centred on the block's first line.
				const mid = (coords.top + coords.bottom) / 2;
				handle.style.top = `${mid - box.top + parent.scrollTop - handle.offsetHeight / 2}px`;
				handle.style.left = `${Math.max(0, text.left - box.left + parent.scrollLeft - handle.offsetWidth - 4)}px`;
				handleBlock = block;
				handleTextLeft = coords.left;
			};
			const onUp = (e: PointerEvent) => {
				const wasPress = press && e.pointerId === press.id;
				cancelPress();
				// Inbox mode: a plain click sends the block under it.
				if (wasPress && inbox && inText(e)) {
					const block = blockUnder(view, e.clientX, e.clientY);
					if (block) sendToInbox(block.text);
				}
			};
			const onClick = (e: MouseEvent) => {
				if (Date.now() < suppressClickUntil) {
					e.preventDefault();
					e.stopPropagation();
				}
			};
			const onHandleDown = (e: PointerEvent) => {
				if (!handleBlock || (e.pointerType === "mouse" && e.button !== 0)) return;
				e.preventDefault();
				e.stopPropagation();
				isTouch = false;
				startDrag(handleBlock, view, e.clientX, e.clientY, e.pointerId);
			};
			const onScroll = () => handle.hide();
			// Stop iOS from scrolling or selecting once a hold has turned into a drag.
			const onTouchMove = (e: TouchEvent) => {
				if (active) e.preventDefault();
			};

			content.addEventListener("pointerdown", onDown, true);
			content.addEventListener("pointermove", onMove, true);
			content.addEventListener("pointerup", onUp, true);
			content.addEventListener("pointercancel", cancelPress, true);
			content.addEventListener("click", onClick, true);
			content.addEventListener("scroll", onScroll, true);
			content.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
			content.addEventListener("pointerleave", () => handle.hide());
			handle.addEventListener("pointerdown", onHandleDown);
			ctx.register(() => {
				cancelPress();
				content.removeEventListener("pointerdown", onDown, true);
				content.removeEventListener("pointermove", onMove, true);
				content.removeEventListener("pointerup", onUp, true);
				content.removeEventListener("pointercancel", cancelPress, true);
				content.removeEventListener("click", onClick, true);
				content.removeEventListener("scroll", onScroll, true);
				content.removeEventListener("touchmove", onTouchMove, true);
				handle.remove();
				handles.delete(handle);
			});
		};
		const attachAll = () => {
			for (const leaf of app.workspace.getLeavesOfType("markdown")) if (leaf.view instanceof MarkdownView) attach(leaf.view);
		};
		app.workspace.onLayoutReady(attachAll);
		ctx.registerEvent(app.workspace.on("layout-change", attachAll));
		ctx.registerEvent(app.workspace.on("active-leaf-change", attachAll));
	},

	renderSettings(el, ctx: ModuleContext<NoteBlocksSettings>) {
		new Setting(el)
			.setName(ctx.t("noteBlocks.hold.name"))
			.setDesc(ctx.t("noteBlocks.hold.desc"))
			.addSlider((s) => s.setLimits(150, 1500, 50).setValue(ctx.settings.holdMs).onChange((v) => ctx.updateSettings({ holdMs: v })));
		new Setting(el)
			.setName(ctx.t("noteBlocks.handleSetting.name"))
			.setDesc(ctx.t("noteBlocks.handleSetting.desc"))
			.addToggle((tg) => tg.setValue(ctx.settings.handle).onChange((v) => ctx.updateSettings({ handle: v })));
		const look = new Setting(el).setName(ctx.t("noteBlocks.handleLook.name")).setDesc(ctx.t("noteBlocks.handleLook.desc"));
		const preview = look.controlEl.createDiv({ cls: "opc-note-blocks-handle-preview" });
		const showPreview = () => {
			const { handleImage, handleSymbol } = ctx.settings;
			preview.empty();
			preview.toggleClass("mod-grip", !handleImage && !handleSymbol);
			if (handleImage) preview.createEl("img", { attr: { src: handleImage, alt: "" } });
			else if (handleSymbol) preview.setText(handleSymbol);
		};
		showPreview();
		let symbolInput: HTMLInputElement | null = null;
		look.addText((tx) => {
			symbolInput = tx.inputEl;
			tx.setPlaceholder(ctx.t("noteBlocks.handleLook.placeholder"))
				.setValue(ctx.settings.handleSymbol)
				.onChange(async (v) => {
					await ctx.updateSettings({ handleSymbol: shortSymbol(v), handleImage: "" });
					showPreview();
				});
		});
		look.addButton((b) =>
			b.setButtonText(ctx.t("noteBlocks.handleLook.image")).onClick(() => {
				// Created in the settings' own window (it may be a separate one): a file input of
				// another window gets no file dialog.
				look.controlEl.querySelector("input[type=file]")?.remove();
				const input = look.controlEl.createEl("input", { cls: "opc-hidden-file", attr: { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp,image/svg+xml" } });
				input.addEventListener("cancel", () => input.remove());
				input.addEventListener("change", () => {
					const file = input.files?.[0];
					input.remove();
					if (!file) return;
					shrinkImage(file)
						.then(async (url) => {
							await ctx.updateSettings({ handleImage: url });
							showPreview();
						})
						.catch(() => new Notice(ctx.t("noteBlocks.handleLook.bad")));
				});
				input.click();
			}),
		);
		look.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip(ctx.t("noteBlocks.handleLook.reset"))
				.onClick(async () => {
					await ctx.updateSettings({ handleSymbol: "", handleImage: "" });
					if (symbolInput) symbolInput.value = "";
					showPreview();
				}),
		);
		new Setting(el)
			.setName(ctx.t("noteBlocks.zones.name"))
			.setDesc(ctx.t("noteBlocks.zones.desc"))
			.addToggle((tg) => tg.setValue(ctx.settings.dropZones).onChange((v) => ctx.updateSettings({ dropZones: v })));
		new Setting(el)
			.setName(ctx.t("noteBlocks.inboxName.name"))
			.setDesc(ctx.t("noteBlocks.inboxName.desc"))
			.addText((tx) => tx.setPlaceholder("Inbox").setValue(ctx.settings.inboxName).onChange((v) => ctx.updateSettings({ inboxName: v.trim() || "Inbox" })));
	},
});
