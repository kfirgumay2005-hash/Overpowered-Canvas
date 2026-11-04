import { EditorSelection, Prec, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { Setting, type Editor } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { mergeWithDefaults } from "../../settings/settings";
import { applyIndent, applyOutdent, FLAT_CLASS, inInlineMath, MAX_WIDTH, MIN_WIDTH, startsWithIndent, tabKeepsDefault, type LineEdit, type Lines } from "./logic";

export interface ParagraphIndentSettings {
	/** Em spaces per indent. */
	width: number;
}

type Ctx = ModuleContext<ParagraphIndentSettings>;

const linesOf = (view: EditorView): Lines => ({ count: view.state.doc.lines, line: (n) => view.state.doc.line(n + 1).text });

/** A suggestion popup (links, tags, other plugins' completions) takes Tab for itself. */
function popupOpen(view: EditorView): boolean {
	for (const doc of new Set([view.dom.ownerDocument, activeDocument]))
		for (const el of doc.querySelectorAll<HTMLElement>(".suggestion-container, .cm-tooltip-autocomplete")) if (el.isShown()) return true;
	return false;
}

/** Vim normal mode keeps its own keys. */
const vimNormal = (view: EditorView) => !!view.dom.querySelector(".cm-fat-cursor");

/**
 * Live Preview edits table cells (and some embeds) in editors of their own, nested in the note's
 * editor: Tab there moves between cells and stays the app's.
 */
const nestedEditor = (view: EditorView) => !!view.dom.parentElement?.closest(".cm-editor, .table-cell-wrapper, table");

/** The cursor is somewhere Tab should write a paragraph indent (one cursor, one line). */
function proseCursor(view: EditorView): boolean {
	if (view.composing || view.state.readOnly || nestedEditor(view) || popupOpen(view) || vimNormal(view)) return false;
	const { ranges } = view.state.selection;
	if (ranges.length !== 1) return false;
	const range = ranges[0]!;
	const doc = view.state.doc;
	const line = doc.lineAt(range.from);
	if (doc.lineAt(range.to).number !== line.number) return false;
	return !tabKeepsDefault(linesOf(view), line.number - 1) && !inInlineMath(line.text, range.from - line.from);
}

/** Replaces the cursor's line with `edit` (one undoable change). */
function replaceLine(view: EditorView, lineFrom: number, oldText: string, edit: LineEdit, userEvent: string): void {
	// Only the part that changed, so other cursors, marks and folds nearby stay put.
	let a = 0;
	while (a < oldText.length && a < edit.text.length && oldText[a] === edit.text[a]) a++;
	let b = 0;
	while (b < oldText.length - a && b < edit.text.length - a && oldText[oldText.length - 1 - b] === edit.text[edit.text.length - 1 - b]) b++;
	view.dispatch({
		changes: { from: lineFrom + a, to: lineFrom + oldText.length - b, insert: edit.text.slice(a, edit.text.length - b) },
		selection: EditorSelection.cursor(lineFrom + edit.cursor),
		scrollIntoView: true,
		userEvent,
	});
}

function insertIndent(view: EditorView, width: number): boolean {
	if (!proseCursor(view)) return false;
	const range = view.state.selection.main;
	const line = view.state.doc.lineAt(range.from);
	replaceLine(view, line.from, line.text, applyIndent(line.text, range.from - line.from, range.to - line.from, width), "input.indent");
	return true;
}

/** Shift+Tab's edit at the cursor, if there is an indent to take away. */
function outdentEdit(view: EditorView, width: number): { line: { from: number; text: string }; edit: LineEdit } | null {
	const range = view.state.selection.main;
	if (!range.empty) return null;
	const line = view.state.doc.lineAt(range.head);
	const edit = applyOutdent(line.text, range.head - line.from, width);
	return edit ? { line, edit } : null;
}

function removeIndent(view: EditorView, width: number): boolean {
	if (!proseCursor(view)) return false;
	const found = outdentEdit(view, width);
	if (!found) return false;
	replaceLine(view, found.line.from, found.line.text, found.edit, "delete.dedent");
	return true;
}

const flatLine = Decoration.line({ class: FLAT_CLASS });

function flatLines(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	const doc = view.state.doc;
	for (const { from, to } of view.visibleRanges) {
		for (let pos = from; pos <= to; ) {
			const line = doc.lineAt(pos);
			if (startsWithIndent(line.text)) builder.add(line.from, line.from, flatLine);
			pos = line.to + 1;
		}
	}
	return builder.finish();
}

/**
 * The editor gives a line that starts with whitespace a hanging indent (every wrapped row lines
 * up under the first word), and it counts em spaces as whitespace. Reading mode indents only
 * the first row. Lines that start with a paragraph indent are marked so the stylesheet cancels
 * the hanging indent: the paragraph wraps the same way in every mode.
 */
const flatIndentLines = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = flatLines(view);
		}
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged) this.decorations = flatLines(u.view);
		}
	},
	{ decorations: (v) => v.decorations },
);

/** The CodeMirror view behind an Obsidian editor (Editor.cm in the desktop and mobile apps). */
const cmOf = (editor: Editor) => (editor as Editor & { cm?: EditorView }).cm;

/**
 * Tab in prose writes a paragraph indent at the cursor, as in a word processor, instead of
 * indenting the whole line. Lists, tables, code blocks and frontmatter keep the usual Tab.
 */
export const paragraphIndentModule = defineModule<ParagraphIndentSettings>({
	id: "paragraph-indent",
	name: "paragraphIndent.name",
	description: "paragraphIndent.desc",
	group: "notes",
	defaultEnabled: false,
	defaultSettings: { width: 2 },
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		const width = typeof s.width === "number" && Number.isFinite(s.width) ? Math.round(s.width) : defaults.width;
		return { width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)) };
	},

	enable(ctx: Ctx) {
		ctx.registerEditorExtension(flatIndentLines);
		ctx.registerEditorExtension(
			// Before the app's own Tab (which indents the whole line), after plugins that bind Tab
			// with the highest precedence (snippet tab stops, math tab-out, outliners). Lists and
			// other places return false, so the app and other plugins still get the key there.
			Prec.high(
				keymap.of([
					{ key: "Tab", run: (view) => insertIndent(view, ctx.settings.width) },
					{ key: "Shift-Tab", run: (view) => removeIndent(view, ctx.settings.width) },
				]),
			),
		);

		// The same from the command palette or the mobile toolbar (no Tab key on touch screens).
		ctx.addCommand({
			id: "insert",
			name: ctx.t("paragraphIndent.insert"),
			icon: "indent-increase",
			editorCheckCallback: (checking, editor) => {
				const cm = cmOf(editor);
				if (!cm || !proseCursor(cm)) return false;
				if (!checking) insertIndent(cm, ctx.settings.width);
				return true;
			},
		});
		ctx.addCommand({
			id: "remove",
			name: ctx.t("paragraphIndent.remove"),
			icon: "indent-decrease",
			editorCheckCallback: (checking, editor) => {
				const cm = cmOf(editor);
				if (!cm || !proseCursor(cm)) return false;
				if (checking) return !!outdentEdit(cm, ctx.settings.width);
				removeIndent(cm, ctx.settings.width);
				return true;
			},
		});
	},

	renderSettings(el, ctx: Ctx) {
		new Setting(el)
			.setName(ctx.t("paragraphIndent.width.name"))
			.setDesc(ctx.t("paragraphIndent.width.desc"))
			.addSlider((s) =>
				s
					.setLimits(MIN_WIDTH, MAX_WIDTH, 1)
					.setValue(ctx.settings.width)
					.onChange((v) => ctx.updateSettings({ width: v })),
			);
	},
});
