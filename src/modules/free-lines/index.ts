import { Setting } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { ARROW_STYLES, type ArrowStyle, type LineData } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { showPicker } from "../../ui/picker";
import { arrowPreview } from "../edge-styles/geometry";
import { mergeWithDefaults } from "../../settings/settings";
import { capturePointer, common, mutate, nodeType, onlyNodes } from "../shared";
import { attachTarget } from "./attach";
import { absoluteLine, carryBends, carrySquare, fitLine, isSquare, keepSquareEnds, snapEnds, type P } from "./model";
import { CONNECTOR, CONNECTOR_Z, renderLine } from "./render";

interface FreeLinesSettings {
	/** Lines attached to cards: drawn above the cards (never hidden by one they cross) or under them. */
	connectors: "above" | "below";
}

type Ctx = ModuleContext<FreeLinesSettings>;
/** Lifts a connector above the cards of its layer (layer bands are 2^24 apart, card values stay far below this). */
const ABOVE_CARDS = 2 ** 22;
const WIDTHS = [1, 2, 3, 5, 8, 12];

function lineOf(ctx: Ctx, node: CanvasNodeLike): LineData | null {
	if (nodeType(node) !== "text") return null;
	const extra = ctx.data.node(node).get();
	return extra.kind === "line" && extra.line && extra.line.points.length >= 2 ? extra.line : null;
}

const boxOf = (n: CanvasNodeLike) => ({ x: n.x, y: n.y, width: n.width, height: n.height });

/**
 * Free lines and arrows (kind "line"), drawn with the drawing tools. Their ends can attach to
 * cards and follow them when the cards move; drag an end handle onto a card to attach it, or
 * into empty space to detach. Color comes from the card color; arrowheads and width are
 * set from the selection toolbar.
 */
export const freeLinesModule = defineModule<FreeLinesSettings>({
	id: "free-lines",
	name: "freeLines.name",
	description: "freeLines.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: { connectors: "above" },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return { connectors: s.connectors === "below" ? "below" : defaults.connectors };
	},

	enable(ctx) {
		const lines = new Set<CanvasNodeLike>();
		/** Lines being repositioned by us (their node-moved must not detach them). */
		const updating = new Set<CanvasNodeLike>();

		/** Where each line's attached cards were when it was last laid out (to carry its bends). */
		const cardsAt = new WeakMap<CanvasNodeLike, { from?: { x: number; y: number }; to?: { x: number; y: number } }>();
		const remember = (node: CanvasNodeLike, line: LineData) => {
			const at = (a?: { node: string }) => {
				const n = a ? node.canvas.nodes.get(a.node) : undefined;
				return n ? { x: n.x, y: n.y } : undefined;
			};
			cardsAt.set(node, { from: at(line.from), to: at(line.to) });
		};

		/** Rewrites a line from absolute points, re-fitting its card. */
		const write = (node: CanvasNodeLike, points: P[], patch: Partial<LineData>, history: boolean) => {
			const line = lineOf(ctx, node);
			if (!line) return;
			const { box, rel } = fitLine(points);
			updating.add(node);
			try {
				if (box.x !== node.x || box.y !== node.y || box.width !== node.width || box.height !== node.height) node.moveAndResize(box);
			} finally {
				updating.delete(node);
			}
			const next: LineData = { ...line, ...patch, points: rel };
			for (const end of ["from", "to"] as const) if (next[end] === undefined) delete next[end];
			ctx.data.node(node).set({ line: next }, { history });
			remember(node, next);
		};

		/** Re-snaps the attached ends of `line` to its cards. */
		const follow = (node: CanvasNodeLike) => {
			const line = lineOf(ctx, node);
			if (!line) return;
			const canvas = node.canvas;
			const from = line.from ? canvas.nodes.get(line.from.node) : undefined;
			const to = line.to ? canvas.nodes.get(line.to.node) : undefined;
			const old = absoluteLine(line, node);
			let points = old;
			// Bend points keep the route's shape: the ends move as far as their cards moved since
			// the line was last laid out, the bends are carried along, then the ends re-snap.
			const seen = cardsAt.get(node);
			if (old.length > 2 && seen) {
				const shift = (p: P, card: CanvasNodeLike | undefined, was: { x: number; y: number } | undefined) => (card && was ? { x: p.x + card.x - was.x, y: p.y + card.y - was.y } : p);
				const start = shift(old[0]!, from, seen.from);
				const end = shift(old[old.length - 1]!, to, seen.to);
				points = isSquare(old) ? carrySquare(old, start, end) : carryBends(old, start, end);
			}
			points = snapEnds(keepSquareEnds(points, from && boxOf(from), to && boxOf(to)), from && boxOf(from), to && boxOf(to));
			// Ends whose card is gone become free.
			write(node, points, { from: from ? line.from : undefined, to: to ? line.to : undefined }, false);
		};

		const handlers = (node: CanvasNodeLike) => ({
			line: (evt: PointerEvent) => (node as unknown as { onPointerdown(e: PointerEvent): void }).onPointerdown(evt),
			end: (evt: PointerEvent, end: "from" | "to") => dragEnd(node, evt, end),
			bend: (evt: PointerEvent, index: number, insert: boolean) => dragBend(node, evt, index, insert),
			unbend: (index: number) => {
				const line = lineOf(ctx, node);
				if (!line || node.canvas.readonly || index <= 0 || index >= line.points.length - 1) return;
				mutate(ctx, node.canvas, () => {
					const points = absoluteLine(line, node);
					points.splice(index, 1);
					write(node, resnap(node, points, line), {}, true);
				});
			},
		});

		/** Attached ends back on their cards' borders, toward their neighbouring point. */
		const resnap = (node: CanvasNodeLike, points: P[], line: LineData): P[] => {
			const canvas = node.canvas;
			const from = line.from ? canvas.nodes.get(line.from.node) : undefined;
			const to = line.to ? canvas.nodes.get(line.to.node) : undefined;
			return snapEnds(points, from && boxOf(from), to && boxOf(to));
		};

		/** Drags a bend point; from a segment's middle, a new bend point is added there first. */
		const dragBend = (node: CanvasNodeLike, evt: PointerEvent, index: number, insert: boolean) => {
			const canvas = node.canvas;
			if (canvas.readonly || (evt.pointerType === "mouse" && evt.button !== 0)) return;
			evt.preventDefault();
			evt.stopPropagation();
			const el = evt.target as SVGElement;
			capturePointer(el, evt.pointerId);
			const at = insert ? index + 1 : index;
			let added = !insert;
			let changed = false;
			const move = (e: PointerEvent) => {
				const line = lineOf(ctx, node);
				if (!line) return;
				const points = absoluteLine(line, node);
				const p = canvas.posFromEvt(e);
				if (!added) {
					points.splice(at, 0, p);
					added = true;
				} else points[at] = p;
				write(node, resnap(node, points, line), {}, false);
				changed = true;
			};
			const up = () => {
				el.removeEventListener("pointermove", move);
				el.removeEventListener("pointerup", up);
				el.removeEventListener("pointercancel", up);
				if (changed) canvas.requestSave(); // one undo step for the gesture
			};
			el.addEventListener("pointermove", move);
			el.addEventListener("pointerup", up);
			el.addEventListener("pointercancel", up);
		};

		// Connectors sit above the cards (or under them, above groups): the core writes z-index
		// inline, so it is overridden after each write.
		const patchedProtos = new WeakSet<object>();
		const patchZ = (node: CanvasNodeLike) => {
			for (let proto = Object.getPrototypeOf(node) as object | null; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto) as object | null) {
				if (!Object.prototype.hasOwnProperty.call(proto, "renderZIndex") || patchedProtos.has(proto)) continue;
				patchedProtos.add(proto);
				ctx.patch("node.renderZIndex", proto as CanvasNodeLike, {
					renderZIndex: (next) =>
						function (this: CanvasNodeLike) {
							(this as unknown as { renderedZIndex?: number }).renderedZIndex = Number.NaN;
							next.call(this);
							if (!this.nodeEl.hasAttribute(CONNECTOR)) return;
							const z = Number.parseInt(this.nodeEl.style.zIndex, 10);
							this.nodeEl.style.zIndex = String(ctx.settings.connectors === "below" ? CONNECTOR_Z : (Number.isFinite(z) ? z : this.zIndex) + ABOVE_CARDS);
						},
				});
			}
		};
		const restack = (node: CanvasNodeLike, was: boolean) => {
			if (node.nodeEl.hasAttribute(CONNECTOR) !== was) node.renderZIndex();
		};

		ctx.decorateNodes({
			apply: (node, extra) => {
				patchZ(node);
				const line = extra.kind === "line" && nodeType(node) === "text" ? lineOf(ctx, node) : null;
				if (line) {
					lines.add(node);
					if (!cardsAt.has(node)) remember(node, line);
				} else lines.delete(node);
				const was = node.nodeEl.hasAttribute(CONNECTOR);
				renderLine(node, line, extra.strokeWidth ?? 2, handlers(node));
				restack(node, was);
			},
			clear: (node) => {
				lines.delete(node);
				const was = node.nodeEl.hasAttribute(CONNECTOR);
				renderLine(node, null, 0, handlers(node));
				restack(node, was);
			},
		});
		ctx.intercept("node-start-editing", (node) => (lines.has(node) ? true : undefined));
		ctx.onSettingsChange((next, prev) => {
			if (next.connectors !== prev.connectors) for (const node of lines) node.renderZIndex();
		});
		ctx.on("node-removed", (node) => {
			lines.delete(node);
		});

		ctx.on("node-moved", (moved) => {
			if (lines.size === 0) return;
			const canvas = moved.canvas;
			if (lines.has(moved)) {
				if (updating.has(moved)) return;
				// The user dragged the line: ends attached to cards that stay behind come loose.
				const line = lineOf(ctx, moved);
				if (!line) return;
				const stays = (a?: { node: string }) => !!a && !canvas.selection.has(canvas.nodes.get(a.node)!);
				if (stays(line.from) || stays(line.to)) {
					updating.add(moved);
					try {
						ctx.data.node(moved).set({ line: { ...line, from: stays(line.from) ? undefined : line.from, to: stays(line.to) ? undefined : line.to } }, { history: false });
					} finally {
						updating.delete(moved);
					}
				}
				return;
			}
			for (const node of lines) {
				if (node.canvas !== canvas || updating.has(node)) continue;
				// Moved together with its card: the core translates both.
				if (canvas.selection.has(node) && canvas.selection.has(moved)) continue;
				const line = lineOf(ctx, node);
				if (line && (line.from?.node === moved.id || line.to?.node === moved.id)) follow(node);
			}
		});

		const dragEnd = (node: CanvasNodeLike, evt: PointerEvent, end: "from" | "to") => {
			const canvas = node.canvas;
			if (canvas.readonly || evt.button !== 0) return;
			evt.preventDefault();
			evt.stopPropagation();
			const el = evt.target as SVGElement;
			capturePointer(el, evt.pointerId);
			let changed = false;
			const move = (e: PointerEvent) => {
				const line = lineOf(ctx, node);
				if (!line) return;
				const points = absoluteLine(line, node);
				points[end === "from" ? 0 : points.length - 1] = canvas.posFromEvt(e);
				write(node, points, { [end]: undefined }, false);
				changed = true;
			};
			const up = (e: PointerEvent) => {
				el.removeEventListener("pointermove", move);
				el.removeEventListener("pointerup", up);
				el.removeEventListener("pointercancel", up);
				const line = lineOf(ctx, node);
				if (!line || !changed) return;
				const target = attachTarget(ctx, canvas, canvas.posFromEvt(e), node);
				const other = end === "from" ? line.to : line.from;
				if (target && target.id !== other?.node) {
					const points = absoluteLine(line, node);
					write(node, snapEnds(points, end === "from" ? boxOf(target) : null, end === "to" ? boxOf(target) : null), { [end]: { node: target.id } }, false);
				}
				canvas.requestSave(); // one undo step for the gesture
			};
			el.addEventListener("pointermove", move);
			el.addEventListener("pointerup", up);
			el.addEventListener("pointercancel", up);
		};

		// ---------- selection toolbar ----------

		const selectedLines = (selection: Parameters<typeof onlyNodes>[0]) => {
			const nodes = onlyNodes(selection);
			return nodes && nodes.every((n) => lines.has(n)) ? nodes : null;
		};
		const setLine = (canvas: CanvasLike, nodes: CanvasNodeLike[], patch: (line: LineData) => Partial<LineData>) =>
			mutate(ctx, canvas, () => {
				for (const n of nodes) {
					const line = lineOf(ctx, n);
					if (!line) continue;
					const next = { ...line, ...patch(line) };
					for (const k of ["startArrow", "endArrow"] as const) if (next[k] === undefined || next[k] === "none") delete next[k];
					ctx.data.node(n).set({ line: next });
				}
			});
		const arrowItems = (current: ArrowStyle | undefined) =>
			ARROW_STYLES.map((style) => ({ id: style, label: ctx.t(`edgeStyles.arrow.${style}` as I18nKey), svg: arrowPreview(style), active: (current ?? "none") === style }));

		ctx.addMenuButton({
			id: "line-style",
			icon: "move-up-right",
			tooltip: () => ctx.t("freeLines.style"),
			order: 30,
			isVisible: (selection) => !!selectedLines(selection),
			onClick: ({ canvas, selection, buttonEl }) => {
				const nodes = selectedLines(selection) ?? [];
				const get = (n: CanvasNodeLike) => lineOf(ctx, n);
				const width = common(nodes, (n) => ctx.data.node(n).get().strokeWidth ?? 2);
				showPicker(
					buttonEl,
					[
						{ title: ctx.t("freeLines.startArrow"), items: arrowItems(common(nodes, (n) => get(n)?.startArrow)).map((i) => ({ ...i, id: `start:${i.id}` })), columns: 5 },
						{ title: ctx.t("freeLines.endArrow"), items: arrowItems(common(nodes, (n) => get(n)?.endArrow)).map((i) => ({ ...i, id: `end:${i.id}` })), columns: 5 },
						{
							title: ctx.t("freeLines.width"),
							columns: 6,
							items: WIDTHS.map((w) => ({
								id: `width:${w}`,
								label: `${w}px`,
								svg: `<svg viewBox="0 0 26 16" width="26" height="16"><path d="M3 8 L23 8" stroke="currentColor" stroke-width="${Math.min(w, 10)}" stroke-linecap="round"/></svg>`,
								active: width === w,
							})),
						},
					],
					(id) => {
						const [kind, value] = id.split(":") as [string, string];
						if (kind === "width")
							mutate(ctx, canvas, () => {
								for (const n of nodes) ctx.data.node(n).set({ strokeWidth: Number(value) === 2 ? undefined : Number(value) });
							});
						else if (kind === "start") setLine(canvas, nodes, () => ({ startArrow: value as ArrowStyle }));
						else setLine(canvas, nodes, () => ({ endArrow: value as ArrowStyle }));
					},
				);
			},
		});
		ctx.addMenuButton({
			id: "line-reverse",
			icon: "arrow-left-right",
			tooltip: () => ctx.t("freeLines.reverse"),
			order: 31,
			isVisible: (selection) => !!selectedLines(selection),
			onClick: ({ canvas, selection }) =>
				setLine(canvas, selectedLines(selection) ?? [], (l) => ({ points: l.points.slice().reverse(), from: l.to, to: l.from, startArrow: l.endArrow, endArrow: l.startArrow })),
		});
	},

	renderSettings(el, ctx: ModuleContext<FreeLinesSettings>) {
		new Setting(el)
			.setName(ctx.t("freeLines.connectors.name"))
			.setDesc(ctx.t("freeLines.connectors.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ above: ctx.t("freeLines.connectors.above"), below: ctx.t("freeLines.connectors.below") })
					.setValue(ctx.settings.connectors)
					.onChange((v) => ctx.updateSettings({ connectors: v as FreeLinesSettings["connectors"] })),
			);
	},
});
