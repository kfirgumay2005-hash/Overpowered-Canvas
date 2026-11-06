/**
 * Reading view of packed plain notes (see packed.ts): a block whose plain lines Markdown would
 * merge into the bullet or line above is drawn again from a copy with each plain line in a
 * paragraph of its own, without margins (class opc-md-packed). Only notes made from a canvas
 * whose data says they were written packed; any other note is drawn as Markdown says.
 */
import { MarkdownRenderChild, MarkdownRenderer, TFile, type App, type MarkdownPostProcessorContext } from "obsidian";
import { logError } from "../../core/log";
import type { ModuleContext } from "../../core/module";
import type { NoteData } from "./note";
import { isBlockSection, packedSection } from "./packed";

const PACKED = "opc-md-packed";

export function enablePackedReading(app: App, ctx: ModuleContext<object>, loadData: (file: TFile, text: string) => Promise<NoteData | null>): void {
	/** Whether a note is packed, by path, while its file is unchanged. */
	const known = new Map<string, { mtime: number; packed: boolean }>();
	const isPacked = async (path: string): Promise<boolean> => {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || file.extension !== "md") return false;
		const hit = known.get(path);
		if (hit && hit.mtime === file.stat.mtime) return hit.packed;
		const data = await loadData(file, await app.vault.cachedRead(file));
		const packed = !!(data?.plain && data.packed);
		known.set(path, { mtime: file.stat.mtime, packed });
		return packed;
	};

	ctx.registerMarkdownPostProcessor(async (el: HTMLElement, info: MarkdownPostProcessorContext) => {
		// Drawn by us below (its own sections hold no line numbers).
		if (el.parentElement?.closest(`.${PACKED}`)) return;
		const at = info.getSectionInfo(el);
		if (!at) return;
		const lines = at.text.split("\n").slice(at.lineStart, at.lineEnd + 1);
		if (!isBlockSection(lines)) return;
		try {
			if (!(await isPacked(info.sourcePath))) return;
			// Every section of the block loses its margins (a plain line and its bullets can be two).
			el.addClass(PACKED);
			const source = packedSection(lines);
			if (!source) return;
			const child = new MarkdownRenderChild(el);
			info.addChild(child);
			el.empty();
			await MarkdownRenderer.render(app, source, el, info.sourcePath, child);
		} catch (error) {
			logError("[overpowered-canvas] could not draw a packed note block", error);
		}
	});
}
