/**
 * Header cards on the board: one button in the popup over the selection, the same choices in the
 * card's menu (right click / long press) and in commands. A header card becomes a real heading in
 * the Markdown note (see headers.ts); a small badge on the card says so.
 */
import type { ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { ChoiceModal, type Choice } from "../../ui/choice-modal";
import { showPicker } from "../../ui/picker";
import { common, mutate, nodeType, onlyTextBoxes, selectedNodes } from "../shared";
import { headingMarks, withoutMarks } from "./headers";

const LEVELS = [1, 2, 3, 4, 5, 6];

export function enableHeaderCards(ctx: ModuleContext<object>): void {
	const t = ctx.t;
	const textOf = (n: CanvasNodeLike) => (nodeType(n) === "text" ? (n.text ?? "") : "");
	/** 0: automatic, 1–6: its level, undefined: not a header. */
	const stateOf = (n: CanvasNodeLike): number | undefined => {
		const own = ctx.data.node(n).get().header;
		if (own !== undefined) return own;
		return headingMarks(textOf(n)) || undefined;
	};
	const cards = (canvas: CanvasLike) => onlyTextBoxes(ctx, selectedNodes(canvas))?.filter((n) => nodeType(n) === "text") ?? [];

	/** "auto", "1"…"6" or "none". */
	const apply = (canvas: CanvasLike, nodes: CanvasNodeLike[], choice: string) =>
		mutate(ctx, canvas, () => {
			for (const n of nodes) {
				// Marks in the text make a header too: "not a header" takes them away.
				if (choice === "none" && headingMarks(textOf(n))) n.setData({ ...n.getData(), text: withoutMarks(textOf(n)) });
				ctx.data.node(n).set({ header: choice === "none" ? undefined : choice === "auto" ? 0 : Number(choice) });
			}
		});
	const choices = (nodes: CanvasNodeLike[]): Choice[] => {
		const now = common(nodes, stateOf);
		return [
			{ id: "auto", label: t("canvasMarkdown.header.auto"), icon: "heading", active: now === 0 },
			...LEVELS.map((l) => ({ id: String(l), label: t("canvasMarkdown.header.level", { level: l }), icon: `heading-${l}`, active: now === l })),
			{ id: "none", label: t("canvasMarkdown.header.none"), icon: "pilcrow", active: nodes.length > 0 && nodes.every((n) => stateOf(n) === undefined) },
		];
	};
	const choose = (canvas: CanvasLike, nodes: CanvasNodeLike[]) => new ChoiceModal(ctx.app, t("canvasMarkdown.header.choose"), choices(nodes), (id) => apply(canvas, nodes, id)).open();

	ctx.decorateNodes({
		apply: (node, extra) => {
			const own = extra.header;
			const marks = headingMarks(textOf(node));
			const level = own !== undefined ? own : marks || undefined;
			if (level === undefined || nodeType(node) !== "text") node.nodeEl.removeAttribute("data-opc-header");
			else node.nodeEl.setAttribute("data-opc-header", level ? `H${level}` : "H");
		},
		clear: (node) => node.nodeEl.removeAttribute("data-opc-header"),
	});

	ctx.addMenuButton({
		id: "header",
		icon: "heading",
		tooltip: () => t("canvasMarkdown.header.button"),
		order: 14,
		command: false,
		isVisible: (selection) => !!onlyTextBoxes(ctx, selection)?.every((n) => nodeType(n) === "text"),
		isActive: (selection) => (onlyTextBoxes(ctx, selection) ?? []).some((n) => stateOf(n) !== undefined),
		onClick: ({ canvas, selection, buttonEl }) => {
			const nodes = (onlyTextBoxes(ctx, selection) ?? []).filter((n) => nodeType(n) === "text");
			const list = choices(nodes);
			showPicker(
				buttonEl,
				[
					{ title: t("canvasMarkdown.header.button"), items: list.slice(0, 1), columns: 1 },
					{ items: list.slice(1, 7), columns: 6 },
					{ items: list.slice(7), columns: 1 },
				],
				(id) => apply(canvas, nodes, id),
			);
		},
	});

	ctx.onNodeMenu((menu, node) => {
		const canvas = node.canvas;
		if (canvas.readonly || nodeType(node) !== "text") return;
		const nodes = cards(canvas).includes(node) ? cards(canvas) : [node];
		menu.addItem((item) =>
			item
				.setSection("action")
				.setTitle(t("canvasMarkdown.header.choose"))
				.setIcon("heading")
				.onClick(() => choose(canvas, nodes)),
		);
	});

	const command = (id: string, name: string, icon: string, run: (canvas: CanvasLike, nodes: CanvasNodeLike[]) => void) =>
		ctx.addCommand({
			id,
			name,
			icon,
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const nodes = canvas ? cards(canvas) : [];
				if (!canvas || canvas.readonly || !nodes.length) return false;
				if (!checking) run(canvas, nodes);
				return true;
			},
		});
	command("header-toggle", t("canvasMarkdown.header.toggle"), "heading", (canvas, nodes) => apply(canvas, nodes, nodes.every((n) => stateOf(n) !== undefined) ? "none" : "auto"));
	command("header-choose", t("canvasMarkdown.header.choose"), "heading", choose);
}
