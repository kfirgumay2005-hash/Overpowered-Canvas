import { Notice, Platform } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasEdgeData, CanvasNodeData } from "../../data/json-canvas";
import type { CanvasItemLike, CanvasLike, Point } from "../../internals/types";
import { mutate } from "../shared";

type Ctx = ModuleContext<Record<string, never>>;
type Clip = { nodes: CanvasNodeData[]; edges: CanvasEdgeData[]; center: Point };

/** The system clipboard's canvas data type (what the core writes on copy). */
const MIME = "obsidian/canvas";
/** A pointer seen over the board this recently (ms) is where a paste goes. */
const POINTER_FRESH = 30_000;

/**
 * Cut, copy and paste for selections: Ctrl/Cmd+X cuts in one undo step (cards, the edges
 * between them, ink strokes, drawn lines); pastes land under the pointer instead of the middle
 * of the view; Cut / Copy in the selection toolbar and Paste in the card bar on phones and
 * tablets, where there is no keyboard.
 */
export const clipboardModule = defineModule({
	id: "clipboard",
	name: "clipboard.name",
	description: "clipboard.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx: Ctx) {
		/** Last copied or cut selection (also for devices whose clipboard can't carry canvas data). */
		let buffer: Clip | null = null;
		const pointers = new Map<CanvasLike, { pos: Point; at: number }>();

		/** Removes the selection in one undo step. */
		const remove = (canvas: CanvasLike) => {
			const count = canvas.selection.size;
			mutate(ctx, canvas, () => canvas.deleteSelection());
			ctx.events.emit("selection-cut", canvas, count);
		};

		/**
		 * Toolbar buttons: the system clipboard can't take canvas data outside a key press, so the
		 * selection goes into the in-app buffer and its card text into the clipboard as a marker;
		 * a later paste of exactly that text pastes the buffer.
		 */
		let bufferText: string | null = null;
		const viaButton = (canvas: CanvasLike, command: "cut" | "copy"): boolean => {
			if (canvas.selection.size === 0) return false;
			buffer = canvas.getSelectionData();
			const text = buffer.nodes.map((n) => (typeof n.text === "string" ? n.text : "")).filter(Boolean).join("\n\n") || " ";
			bufferText = text;
			void navigator.clipboard?.writeText(text).catch(() => undefined);
			if (command === "cut" && !canvas.readonly) remove(canvas);
			return true;
		};
		const cut = (canvas: CanvasLike) => void viaButton(canvas, "cut");
		const copy = (canvas: CanvasLike) => viaButton(canvas, "copy");

		const paste = (canvas: CanvasLike, clip: Clip, at: Point) => {
			if (canvas.readonly || !clip.nodes?.length) return;
			let added: Set<CanvasItemLike> = new Set();
			mutate(ctx, canvas, () => {
				const data = canvas.cloneData({ nodes: clip.nodes, edges: clip.edges ?? [] }, { x: at.x - clip.center.x, y: at.y - clip.center.y });
				added = new Set(canvas.importData(data, false) ?? []);
			});
			if (added.size) canvas.selectAll(added);
		};

		/** Where a paste goes: under the pointer when it is over the board, else the middle. */
		const target = (canvas: CanvasLike): Point => {
			const p = pointers.get(canvas);
			return p && Date.now() - p.at < POINTER_FRESH ? p.pos : canvas.posCenter();
		};

		ctx.onCanvas((canvas) => {
			const wrapper = canvas.wrapperEl;
			const win = wrapper.win;
			const onMove = (e: PointerEvent) => pointers.set(canvas, { pos: canvas.posFromEvt(e), at: Date.now() });
			const onLeave = () => pointers.delete(canvas);
			// Pastes of canvas data go under the pointer (the core puts them in the middle).
			const onPaste = (e: ClipboardEvent) => {
				if (e.defaultPrevented || canvas.readonly || wrapper.doc.activeElement !== wrapper) return;
				const raw = e.clipboardData?.getData(MIME);
				// What a Cut / Copy button left: its marker text, with the selection in the buffer.
				if (!raw && buffer && bufferText !== null && e.clipboardData?.getData("text/plain").replace(/\r\n/g, "\n") === bufferText) {
					e.preventDefault();
					e.stopImmediatePropagation();
					paste(canvas, buffer, target(canvas));
					return;
				}
				if (!raw || !pointers.has(canvas)) return;
				let clip: Clip;
				try {
					clip = JSON.parse(raw) as Clip;
				} catch {
					return;
				}
				if (!Array.isArray(clip.nodes) || !clip.center) return;
				e.preventDefault();
				paste(canvas, clip, target(canvas));
			};
			// Ctrl/Cmd+X (or the Cut button): the core removes items one by one, outside the undo
			// history; this writes the clipboard the same way and removes them in one step.
			const onCut = (e: ClipboardEvent) => {
				if (canvas.readonly || wrapper.doc.activeElement !== wrapper || canvas.selection.size === 0) return;
				const data = canvas.getSelectionData();
				buffer = data;
				bufferText = null;
				e.clipboardData?.setData(MIME, JSON.stringify(data));
				e.preventDefault();
				e.stopImmediatePropagation();
				remove(canvas);
			};
			// Remember native copies too, for the Paste button.
			const onCopy = () => {
				if (wrapper.doc.activeElement === wrapper && canvas.selection.size > 0) {
					buffer = canvas.getSelectionData();
					bufferText = null;
				}
			};
			wrapper.addEventListener("pointermove", onMove);
			wrapper.addEventListener("pointerleave", onLeave);
			win.addEventListener("paste", onPaste, true);
			win.addEventListener("cut", onCut, true);
			win.addEventListener("copy", onCopy, true);
			return () => {
				wrapper.removeEventListener("pointermove", onMove);
				wrapper.removeEventListener("pointerleave", onLeave);
				win.removeEventListener("paste", onPaste, true);
				win.removeEventListener("cut", onCut, true);
				win.removeEventListener("copy", onCopy, true);
				pointers.delete(canvas);
			};
		});

		ctx.addMenuButton({
			id: "cut",
			icon: "scissors",
			tooltip: () => ctx.t("clipboard.cut"),
			order: 900,
			command: false,
			isVisible: (selection) => selection.length > 0,
			onClick: ({ canvas }) => cut(canvas),
		});
		if (Platform.isMobile) {
			ctx.addMenuButton({
				id: "copy",
				icon: "copy",
				tooltip: () => ctx.t("clipboard.copy"),
				order: 901,
				command: false,
				readonly: true,
				isVisible: (selection) => selection.length > 0,
				onClick: ({ canvas }) => {
					if (copy(canvas)) new Notice(ctx.t("clipboard.copied", { count: canvas.selection.size }));
				},
			});
			ctx.addCardMenuButton({
				id: "paste",
				icon: "clipboard-paste",
				tooltip: () => ctx.t("clipboard.paste"),
				order: 6,
				onClick: (canvas) => {
					if (!buffer) new Notice(ctx.t("clipboard.empty"));
					else paste(canvas, buffer, canvas.posCenter());
				},
			});
		}

		const command = (id: string, name: string, icon: string, fn: (c: CanvasLike) => void) =>
			ctx.addCommand({
				id,
				name,
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas) return false;
					if (!checking) fn(canvas);
					return true;
				},
			});
		command("cut", ctx.t("clipboard.cut"), "scissors", cut);
		command("paste-here", ctx.t("clipboard.pasteHere"), "clipboard-paste", (canvas) => {
			if (!buffer) new Notice(ctx.t("clipboard.empty"));
			else paste(canvas, buffer, target(canvas));
		});
	},
});
