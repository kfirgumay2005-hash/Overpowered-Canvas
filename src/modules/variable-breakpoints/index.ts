import { Modal, Notice, Setting, type App } from "obsidian";
import { defineModule } from "../../core/module";
import type { Translate } from "../../i18n";
import type { CanvasNodeLike } from "../../internals/types";
import { mutate, selectedNodes } from "../shared";

const VAR = "--variable-breakpoint";

/**
 * Per-node zoom level below which the node's content is replaced by a placeholder.
 * Set with the CSS variable --variable-breakpoint (from a snippet or style attribute) or per
 * node from the context menu (stored as x-opc.breakpoint and applied as the same variable).
 * Values use the canvas zoom scale: 0 = 100%, -1 = 50%, -2 = 25%… (Obsidian's default is -1.7).
 */
export const variableBreakpointsModule = defineModule({
	id: "variable-breakpoints",
	name: "variableBreakpoints.name",
	description: "variableBreakpoints.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		/** Parsed variable per node; null = not set. Cleared whenever the node's data changes. */
		const cache = new WeakMap<CanvasNodeLike, number | null>();

		const breakpointOf = (node: CanvasNodeLike): number | null => {
			if (cache.has(node)) return cache.get(node)!;
			let value: number | null = null;
			if (node.nodeEl.isConnected) {
				const raw = getComputedStyle(node.nodeEl).getPropertyValue(VAR).trim();
				const n = raw === "" ? NaN : Number(raw);
				value = Number.isFinite(n) ? n : null;
				cache.set(node, value);
			}
			return value;
		};

		ctx.decorateNodes({
			apply: (node, extra) => {
				if (typeof extra.breakpoint === "number") node.nodeEl.style.setProperty(VAR, String(extra.breakpoint));
				else node.nodeEl.style.removeProperty(VAR);
				cache.delete(node);
			},
			clear: (node) => {
				node.nodeEl.style.removeProperty(VAR);
				cache.delete(node);
			},
		});
		// CSS snippets or style attributes may change the variable at any time.
		ctx.registerEvent(ctx.app.workspace.on("css-change", () => ctx.canvases().forEach((c) => c.nodes.forEach((n) => cache.delete(n)))));

		ctx.intercept("node-breakpoint", (node) => {
			const bp = breakpointOf(node);
			if (bp === null) return undefined;
			return node.canvas.zoom > bp || node.isEditing;
		});
		// Re-evaluate visible nodes once with the new rule.
		for (const canvas of ctx.canvases()) canvas.rerenderViewport();
		ctx.register(() => ctx.canvases().forEach((c) => c.rerenderViewport()));

		const open = () => {
			const canvas = ctx.activeCanvas();
			const nodes = canvas ? selectedNodes(canvas) : [];
			if (!canvas || nodes.length === 0) {
				new Notice(ctx.t("common.selectNodes"));
				return;
			}
			const first = ctx.data.node(nodes[0]!).get().breakpoint;
			new BreakpointModal(ctx.app, ctx.t, first, (value) => {
				mutate(ctx, canvas, () => {
					for (const node of nodes) ctx.data.node(node).set({ breakpoint: value });
				});
				canvas.rerenderViewport();
			}).open();
		};

		ctx.addCommand({ id: "set-breakpoint", name: ctx.t("variableBreakpoints.command"), callback: open });
		ctx.onNodeMenu((menu) =>
			menu.addItem((item) => item.setSection("canvas").setTitle(ctx.t("variableBreakpoints.command")).setIcon("eye-off").onClick(open)),
		);
	},
});

class BreakpointModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private value: number | undefined,
		private readonly onSubmit: (value: number | undefined) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { t } = this;
		this.setTitle(t("variableBreakpoints.command"));
		this.contentEl.createEl("p", { cls: "setting-item-description", text: t("variableBreakpoints.help") });
		let input = this.value === undefined ? "" : String(this.value);
		new Setting(this.contentEl).setName(t("variableBreakpoints.value")).addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.step = "0.1";
			text.setPlaceholder("-1.7").setValue(input).onChange((v) => (input = v));
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") submit();
			});
			setTimeout(() => text.inputEl.focus());
		});
		const submit = () => {
			const trimmed = input.trim();
			const n = Number(trimmed);
			if (trimmed !== "" && !Number.isFinite(n)) return;
			this.close();
			this.onSubmit(trimmed === "" ? undefined : Math.max(-5, Math.min(2, n)));
		};
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(t("common.reset")).onClick(() => {
				this.close();
				this.onSubmit(undefined);
			}))
			.addButton((b) => b.setButtonText(t("common.apply")).setCta().onClick(submit));
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
