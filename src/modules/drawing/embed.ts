/**
 * Strokes into a card and back out: "Embed into a new card" (a card made around the strokes),
 * "Embed into the card under it", "Take out of its card". Embedded strokes are ink stuck to the
 * card (x-opc.anchor), so they move, copy and delete with it and show wherever the card shows
 * (column view, table of contents); a card made for them (`drawingCard`) also stretches them when
 * it is resized (anchors.ts). Works on the strokes picked with the drawing bar's lasso, else on
 * the drawings (and the cards with ink) selected on the board.
 */
import { Menu, Notice } from "obsidian";
import type { ModuleContext } from "../../core/module";
import type { Stroke } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mutate, nodeType, randomId } from "../shared";
import { anchorOf, isInk, stickyTargets } from "./anchors";
import { absolutePoints, CARRIER_TEXT, refit, type Box } from "./carriers";
import { cardUnder, cardUnderMost } from "./stick";
import type { DrawingSettings } from "./toolbar";

type Ctx = ModuleContext<DrawingSettings>;

/** Strokes picked: a drawing and which of its strokes (null: all of them). */
export interface InkPick {
	carrier: CanvasNodeLike;
	ids: ReadonlySet<string> | null;
}

export type EmbedTarget = "new" | "under";

export interface EmbedApi {
	/** Opens the choice (new card, card under it, take out) at a screen point. */
	menu(canvas: CanvasLike, at: { x: number; y: number }): void;
	embed(canvas: CanvasLike, target: EmbedTarget): boolean;
	takeOut(canvas: CanvasLike): boolean;
}

/**
 * @param lasso the strokes picked with the drawing bar's lasso on this canvas (empty: none)
 * @param picked called after strokes moved: the lasso lets go of what it held
 */
export function enableEmbed(ctx: Ctx, lasso: (canvas: CanvasLike) => InkPick[], picked: (canvas: CanvasLike) => void): EmbedApi {
	const { t } = ctx;
	const strokesOf = (c: CanvasNodeLike): Stroke[] => ctx.data.node(c).get().strokes ?? [];
	const chosen = (pick: InkPick): Stroke[] => strokesOf(pick.carrier).filter((s) => !pick.ids || pick.ids.has(s.id));

	/** The lasso's strokes, else the drawings selected on the board (and the ink on selected cards). */
	const picks = (canvas: CanvasLike): InkPick[] => {
		const fromLasso = lasso(canvas).filter((p) => canvas.nodes.get(p.carrier.id) === p.carrier);
		if (fromLasso.length) return fromLasso;
		const selected = [...canvas.selection].filter((i): i is CanvasNodeLike => "nodeEl" in i);
		const carriers = new Set(selected.filter((n) => isInk(ctx, n)));
		const cards = new Set(selected.filter((n) => !isInk(ctx, n)).map((n) => n.id));
		if (cards.size) for (const n of canvas.nodes.values()) if (isInk(ctx, n) && cards.has(anchorOf(ctx, n) ?? "")) carriers.add(n);
		return [...carriers].map((carrier) => ({ carrier, ids: null }));
	};

	/** The one card selected besides the drawings: strokes go into it. */
	const selectedCard = (canvas: CanvasLike): CanvasNodeLike | null => {
		const cards = [...canvas.selection].filter((i): i is CanvasNodeLike => "nodeEl" in i && !isInk(ctx, i) && nodeType(i) !== "group");
		return cards.length === 1 ? cards[0]! : null;
	};

	/** The card the picked strokes are on: the selected card, else the topmost one under most of their points. */
	const cardFor = (canvas: CanvasLike, list: InkPick[]): CanvasNodeLike | null => {
		const sel = selectedCard(canvas);
		if (sel && lasso(canvas).length === 0) return sel;
		const points = list.flatMap((p) => chosen(p).flatMap((s) => absolutePoints(s, p.carrier)));
		const id = cardUnderMost(points, stickyTargets(ctx, canvas));
		return id ? (canvas.nodes.get(id) ?? null) : null;
	};

	/**
	 * Moves the picked strokes into ink stuck to `anchor` (undefined: free on the board). A drawing
	 * moved whole keeps its card; strokes picked out of a drawing become drawings of their own
	 * (one each, or one together when strokes are set to join), the rest stays where it was.
	 */
	const move = (canvas: CanvasLike, list: InkPick[], anchor: string | undefined): number => {
		let count = 0;
		for (const { carrier, ids } of list) {
			const all = strokesOf(carrier);
			const take = all.filter((s) => !ids || ids.has(s.id));
			if (!take.length) continue;
			count += take.length;
			if (take.length === all.length) {
				if (anchorOf(ctx, carrier) !== anchor) ctx.data.node(carrier).set({ anchor });
				continue;
			}
			const origin = { x: carrier.x, y: carrier.y };
			const groups = ctx.settings.groupStrokes ? [take] : take.map((s) => [s]);
			for (const group of groups) {
				const fit = refit(group, origin);
				if (fit) canvas.importData({ nodes: [{ id: randomId(), type: "text", text: CARRIER_TEXT, ...fit.box, "x-opc": { kind: "ink", strokes: fit.strokes, ...(anchor ? { anchor } : {}) } }], edges: [] }, false);
			}
			const rest = refit(
				all.filter((s) => !take.includes(s)),
				origin,
			);
			if (!rest) canvas.removeNode(carrier);
			else {
				carrier.moveAndResize(rest.box);
				ctx.data.node(carrier).set({ strokes: rest.strokes });
			}
		}
		return count;
	};

	/** The box around the picked strokes (padded like a drawing's card). */
	const boxOf = (list: InkPick[]): Box | null => {
		const all = list.flatMap((p) => chosen(p).map((s) => ({ s, origin: { x: p.carrier.x, y: p.carrier.y } })));
		if (!all.length) return null;
		// Strokes relative to (0, 0): refit gives their box on the board.
		const abs = all.map(({ s, origin }) => ({ ...s, pts: s.pts.map((v, i) => (i % 3 === 0 ? v + origin.x : i % 3 === 1 ? v + origin.y : v)) }));
		return refit(abs, { x: 0, y: 0 })?.box ?? null;
	};

	const embed = (canvas: CanvasLike, target: EmbedTarget): boolean => {
		if (canvas.readonly) return false;
		const list = picks(canvas).filter((p) => chosen(p).length);
		if (!list.length) {
			new Notice(t("drawing.embedCard.nothing"));
			return false;
		}
		const out: { card: CanvasNodeLike | null; count: number } = { card: null, count: 0 };
		if (target === "under") {
			out.card = cardFor(canvas, list);
			if (!out.card) {
				new Notice(t("drawing.embedCard.noCard"));
				return false;
			}
		}
		const ok = mutate(ctx, canvas, () => {
			if (target === "new") {
				const box = boxOf(list);
				if (!box) return;
				const id = randomId();
				canvas.importData({ nodes: [{ id, type: "text", text: "", ...box, "x-opc": { drawingCard: true } }], edges: [] }, false);
				out.card = canvas.nodes.get(id) ?? null;
			}
			if (out.card) out.count = move(canvas, list, out.card.id);
		});
		const { card, count } = out;
		if (!ok || !card || !count) return false;
		picked(canvas);
		ctx.events.emit("ink-embedded", canvas, card, count);
		new Notice(t("drawing.embedCard.done", { count: String(count) }));
		return true;
	};

	/** Frees the picked ink from its cards; a card made for a drawing that is left empty goes too. */
	const takeOut = (canvas: CanvasLike): boolean => {
		if (canvas.readonly) return false;
		const list = picks(canvas).filter((p) => anchorOf(ctx, p.carrier) && chosen(p).length);
		if (!list.length) {
			new Notice(t("drawing.embedCard.nothingOut"));
			return false;
		}
		const cards = new Set(list.map((p) => anchorOf(ctx, p.carrier)!));
		let count = 0;
		const ok = mutate(ctx, canvas, () => {
			count = move(canvas, list, undefined);
			for (const id of cards) {
				const card = canvas.nodes.get(id);
				if (!card || !ctx.data.node(card).get().drawingCard || (card.text ?? "").trim()) continue;
				const stillInked = [...canvas.nodes.values()].some((n) => anchorOf(ctx, n) === id);
				if (!stillInked) canvas.removeNode(card);
			}
		});
		if (!ok || !count) return false;
		picked(canvas);
		ctx.events.emit("ink-taken-out", canvas, count);
		new Notice(t("drawing.embedCard.outDone", { count: String(count) }));
		return true;
	};

	/**
	 * Without anything picked: every free drawing over a card sticks to it, stroke by stroke (the
	 * command's earlier behavior, kept).
	 */
	const attachAll = (canvas: CanvasLike) => {
		const carriers = [...canvas.nodes.values()].filter((n) => isInk(ctx, n) && !anchorOf(ctx, n));
		const cards = stickyTargets(ctx, canvas);
		mutate(ctx, canvas, () => {
			for (const carrier of carriers) {
				const byCard = new Map<string, Set<string>>();
				for (const s of strokesOf(carrier)) {
					const card = cardUnder(absolutePoints(s, carrier), cards);
					if (card) byCard.set(card, (byCard.get(card) ?? new Set()).add(s.id));
				}
				// The carrier may go away once its strokes moved: each card takes its strokes in turn.
				for (const [card, ids] of byCard) if (canvas.nodes.get(carrier.id) === carrier) move(canvas, [{ carrier, ids }], card);
			}
		});
	};

	const menu = (canvas: CanvasLike, at: { x: number; y: number }) => {
		const list = picks(canvas);
		const m = new Menu();
		m.addItem((i) => i.setTitle(t("drawing.embedCard.new")).setIcon("square-plus").onClick(() => embed(canvas, "new")));
		m.addItem((i) => i.setTitle(t("drawing.embedCard.under")).setIcon("pin").setDisabled(!cardFor(canvas, list)).onClick(() => embed(canvas, "under")));
		if (list.some((p) => anchorOf(ctx, p.carrier))) m.addItem((i) => i.setTitle(t("drawing.embedCard.out")).setIcon("pin-off").onClick(() => takeOut(canvas)));
		m.showAtPosition(at, canvas.wrapperEl.doc);
	};

	const command = (id: string, name: string, icon: string, run: (canvas: CanvasLike) => void) =>
		ctx.addCommand({
			id,
			name,
			icon,
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) run(canvas);
				return true;
			},
		});
	command("embed-ink-new", t("drawing.embedCard.new"), "square-plus", (c) => void embed(c, "new"));
	// The ids of the earlier "stick to cards" / "unstick" commands are kept (hotkeys stay).
	command("attach-ink", t("drawing.embedCard.under"), "pin", (c) => (picks(c).length ? void embed(c, "under") : attachAll(c)));
	command("detach-ink", t("drawing.embedCard.out"), "pin-off", (c) => void takeOut(c));

	// The same from a drawing's or a card's context menu (touch: long press).
	ctx.onNodeMenu((menu, node) => {
		const canvas = node.canvas;
		if (canvas.readonly) return;
		const ink = isInk(ctx, node);
		const inked = !ink && [...canvas.nodes.values()].some((n) => anchorOf(ctx, n) === node.id);
		if (!ink && !inked) return;
		const select = () => {
			if (!canvas.selection.has(node)) canvas.selectOnly(node);
		};
		if (ink) {
			menu.addItem((i) => i.setSection("opc-ink").setTitle(t("drawing.embedCard.new")).setIcon("square-plus").onClick(() => (select(), embed(canvas, "new"))));
			if (!anchorOf(ctx, node)) menu.addItem((i) => i.setSection("opc-ink").setTitle(t("drawing.embedCard.under")).setIcon("pin").onClick(() => (select(), embed(canvas, "under"))));
		}
		if (inked || anchorOf(ctx, node)) menu.addItem((i) => i.setSection("opc-ink").setTitle(t("drawing.embedCard.out")).setIcon("pin-off").onClick(() => (select(), takeOut(canvas))));
	});

	return { menu, embed, takeOut };
}
