import { Notice, type EditorPosition } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { showPopover } from "../../ui/picker";
import { mutate, nodeType, selectedNodes } from "../shared";
import { loadEmoji } from "./data";
import { appendEmoji, offsetOf, pushRecent, TONES, type Tone } from "./logic";
import { EmojiPanel } from "./panel";

interface EmojiSettings {
	/** Recently picked emoji, newest first (with the tone they were picked with). */
	recent: string[];
	/** Skin tone: 0 default, 1–5 light → dark. */
	tone: number;
}

type Ctx = ModuleContext<EmojiSettings>;

interface EditorLike {
	getCursor(which?: "from" | "to"): EditorPosition;
	replaceRange(text: string, from: EditorPosition, to?: EditorPosition): void;
	setCursor(pos: EditorPosition): void;
	focus(): void;
}

/** Where picked emoji go, worked out when the button is pressed (before anything loses focus). */
type Target = { kind: "editing"; node: CanvasNodeLike; from: EditorPosition; to: EditorPosition; text: string } | { kind: "cards"; nodes: CanvasNodeLike[] } | { kind: "new" };

const CARD_SIZE = { width: 120, height: 80 };

function editorOf(node: CanvasNodeLike): EditorLike | null {
	const child = node.child as { editor?: EditorLike; editMode?: { editor?: EditorLike } } | undefined;
	const editor = child?.editor ?? child?.editMode?.editor;
	return editor && typeof editor.replaceRange === "function" ? editor : null;
}

function targetOf(canvas: CanvasLike): Target {
	const editing = [...canvas.nodes.values()].find((n) => n.isEditing && nodeType(n) === "text");
	const editor = editing ? editorOf(editing) : null;
	if (editing && editor) return { kind: "editing", node: editing, from: editor.getCursor("from"), to: editor.getCursor("to"), text: editing.text ?? "" };
	const cards = selectedNodes(canvas).filter((n) => nodeType(n) === "text");
	return cards.length ? { kind: "cards", nodes: cards } : { kind: "new" };
}

/**
 * Emoji picker: a bottom-bar button (and a command) with every emoji, search in the UI language
 * and English, categories, recently used and skin tones, offline. A picked emoji goes:
 * - into the card being edited, at the cursor;
 * - else at the end of the selected text card(s) — the words already there stay untouched and the
 *   emoji lands where typing would go on (after a space);
 * - else into a new card in the middle of the view, which stays selected, so the next emoji join it.
 */
export const emojiPickerModule = defineModule<EmojiSettings>({
	id: "emoji-picker",
	name: "emojiPicker.name",
	description: "emojiPicker.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: { recent: [], tone: 0 },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return { recent: s.recent.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 32).slice(0, 36), tone: (TONES as readonly number[]).includes(s.tone) ? s.tone : 0 };
	},

	enable(ctx: Ctx) {
		const pending = new WeakMap<CanvasLike, Target>();

		const insert = (canvas: CanvasLike, target: Target, emoji: string): Target => {
			if (target.kind === "editing") {
				const { node } = target;
				const editor = node.isEditing ? editorOf(node) : null;
				if (canvas.nodes.get(node.id) === node && editor) {
					editor.replaceRange(emoji, target.from, target.to);
					const at = { line: target.from.line, ch: target.from.ch + emoji.length };
					editor.setCursor(at);
					return { ...target, from: at, to: at };
				}
				// Editing ended meanwhile: the same place in the card's text.
				if (canvas.nodes.get(node.id) !== node) return insert(canvas, { kind: "new" }, emoji);
				const text = node.text ?? "";
				const base = text === target.text ? text : target.text;
				const start = offsetOf(base, target.from);
				const end = offsetOf(base, target.to);
				const next = base.slice(0, start) + emoji + base.slice(end);
				mutate(ctx, canvas, () => node.setData({ ...node.getData(), text: next }));
				const at = { line: target.from.line, ch: target.from.ch + emoji.length };
				return { ...target, from: at, to: at, text: next };
			}
			if (target.kind === "cards") {
				const alive = target.nodes.filter((n) => canvas.nodes.get(n.id) === n);
				if (alive.length) {
					mutate(ctx, canvas, () => {
						for (const n of alive) n.setData({ ...n.getData(), text: appendEmoji(n.text ?? "", emoji) });
					});
					return { kind: "cards", nodes: alive };
				}
			}
			const v = canvas.getViewportBBox();
			let created: CanvasNodeLike | null = null;
			mutate(ctx, canvas, () => {
				created = canvas.createTextNode({ pos: { x: (v.minX + v.maxX) / 2, y: (v.minY + v.maxY) / 2 }, position: "center", size: { ...CARD_SIZE }, text: emoji, focus: false });
			});
			if (!created) return { kind: "new" };
			canvas.selectOnly(created);
			// The next emoji go into this card.
			return { kind: "cards", nodes: [created] };
		};

		const open = async (canvas: CanvasLike, anchor: HTMLElement) => {
			if (canvas.readonly) {
				new Notice(ctx.t("emojiPicker.readOnly"));
				return;
			}
			let target = pending.get(canvas) ?? targetOf(canvas);
			pending.delete(canvas);
			// Kept here too: settings are applied only once saved, the picker shows changes at once.
			let recent = [...ctx.settings.recent];
			let tone = ctx.settings.tone as Tone;
			const lang = ctx.t("emojiPicker.dataLang");
			const emoji = await loadEmoji(lang);
			showPopover(
				anchor,
				(el) => {
					el.addClass("opc-emoji-popover");
					new EmojiPanel(el, {
						t: ctx.t,
						emoji,
						recent: () => recent,
						tone: () => tone,
						setTone: (next) => {
							tone = next;
							void ctx.updateSettings({ tone: next });
						},
						pick: (text) => {
							target = insert(canvas, target, text);
							recent = pushRecent(recent, text);
							void ctx.updateSettings({ recent });
						},
					});
				},
				() => {
					// Back to typing where the emoji went.
					if (target.kind !== "editing" || !target.node.isEditing) return;
					const editor = editorOf(target.node);
					editor?.focus();
					editor?.setCursor(target.to);
				},
			);
		};

		ctx.addCardMenuButton({
			id: "emoji",
			icon: "smile-plus",
			tooltip: () => ctx.t("emojiPicker.button"),
			order: 140,
			onClick: (canvas, evt) => void open(canvas, (evt.currentTarget as HTMLElement | null) ?? canvas.cardMenuEl),
		});

		// Pressing the button must not end editing: keep the focus where it is, and note the target.
		ctx.onCanvas((canvas) => {
			const onDown = (evt: PointerEvent | MouseEvent) => {
				if (!(evt.target as HTMLElement | null)?.closest?.(".opc-card-emoji")) return;
				evt.preventDefault();
				if (evt.type === "pointerdown") pending.set(canvas, targetOf(canvas));
			};
			const bar = canvas.cardMenuEl;
			bar.addEventListener("pointerdown", onDown, true);
			bar.addEventListener("mousedown", onDown, true);
			return () => {
				bar.removeEventListener("pointerdown", onDown, true);
				bar.removeEventListener("mousedown", onDown, true);
			};
		});

		ctx.addCommand({
			id: "insert",
			name: ctx.t("emojiPicker.button"),
			icon: "smile-plus",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) {
					const button = canvas.cardMenuEl.querySelector<HTMLElement>(".opc-card-emoji");
					void open(canvas, button && button.isShown() ? button : canvas.cardMenuEl);
				}
				return true;
			},
		});
	},
});
