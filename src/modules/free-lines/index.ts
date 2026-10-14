import { defineModule, type ModuleContext } from "../../core/module";
import { ARROW_STYLES, type ArrowStyle, type LineData } from "../../data/schema";
import type { I18nKey } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { showPicker } from "../../ui/picker";
import { arrowPreview } from "../edge-styles/geometry";
import { capturePointer, common, mutate, nodeType, onlyNodes } from "../shared";
import { attachTarget } from "./attach";
import { absoluteLine, fitLine, snapEnds, type P } from "./model";
import { renderLine } from "./render";

type Ctx = ModuleContext<object>;
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
export const freeLinesModule = defineModule({
	id: "free-lines",
	name: "freeLines.name",
	description: "freeLines.desc",
	group: "drawing",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		const lines = new Set<CanvasNodeLike>();
		/** Lines being repositioned by us (their node-moved must not detach them). */
		const updating = new Set<CanvasNodeLike>();

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
		};

		/** Re-snaps the attached ends of `line` to its cards. */
		const follow = (node: CanvasNodeLike) => {
			const line = lineOf(ctx, node);
			if (!line) return;
			const canvas = node.canvas;
			const from = line.from ? canvas.nodes.get(line.from.node) : undefined;
			const to = line.to ? canvas.nodes.get(line.to.node) : undefined;
			const points = snapEnds(absoluteLine(line, node), from && boxOf(from), to && boxOf(to));
			// Ends whose card is gone become free.
			write(node, points, { from: from ? line.from : undefined, to: to ? line.to : undefined }, false);
		};

		const handlers = (node: CanvasNodeLike) => ({
			line: (evt: PointerEvent) => (node as unknown as { onPointerdown(e: PointerEvent): void }).onPointerdown(evt),
			end: (evt: PointerEvent, end: "from" | "to") => dragEnd(node, evt, end),
		});

		ctx.decorateNodes({
			apply: (node, extra) => {
				const line = extra.kind === "line" && nodeType(node) === "text" ? lineOf(ctx, node) : null;
				if (line) lines.add(node);
				else lines.delete(node);
				renderLine(node, line, extra.strokeWidth ?? 2, handlers(node));
			},
			clear: (node) => {
				lines.delete(node);
				renderLine(node, null, 0, handlers(node));
			},
		});
		ctx.intercept("node-start-editing", (node) => (lines.has(node) ? true : undefined));
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
});
