import { Modal, Notice, Setting, type App } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { Translate } from "../../i18n";
import type { CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { mutate, selectedNodes } from "../shared";

const VAR = "--variable-breakpoint";

interface BreakpointSettings {
	/** Cards without their own breakpoint: Obsidian's threshold, always full content, or a custom zoom. */
	mode: "default" | "always" | "custom";
	/** Custom threshold as a zoom percentage (100 = actual size). */
	percent: number;
}

const MODES: BreakpointSettings["mode"][] = ["default", "always", "custom"];

/**
 * Per-node zoom level below which the node's content is replaced by a placeholder.
 * Set with the CSS variable --variable-breakpoint (from a snippet or style attribute) or per
 * node from the context menu (stored as x-opc.breakpoint and applied as the same variable).
 * Values use the canvas zoom scale: 0 = 100%, -1 = 50%, -2 = 25%… (Obsidian's default is -1.7).
 */
export const variableBreakpointsModule = defineModule<BreakpointSettings>({
	id: "variable-breakpoints",
	name: "variableBreakpoints.name",
	description: "variableBreakpoints.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: { mode: "default", percent: 15 },
	overlapsWith: ["advanced-canvas"],
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			mode: MODES.includes(s.mode) ? s.mode : defaults.mode,
			percent: typeof s.percent === "number" && s.percent >= 1 && s.percent <= 100 ? s.percent : defaults.percent,
		};
	},

	enable(ctx) {
		/** Parsed variable per node; null = not set. Cleared whenever the node's data changes. */
		const cache = new WeakMap<CanvasNodeLike, number | null>();

		/** Whether any loaded stylesheet mentions the variable (else only stored breakpoints count). */
		const scanCss = () => {
			for (const sheet of Array.from(activeDocument.styleSheets)) {
				try {
					for (const rule of Array.from(sheet.cssRules)) if (rule.cssText.includes(VAR)) return true;
				} catch {
					// Cross-origin sheets can't be read; they can't be user snippets either.
				}
			}
			return false;
		};
		let cssUsesVar = scanCss();

		const breakpointOf = (node: CanvasNodeLike): number | null => {
			if (cache.has(node)) return cache.get(node)!;
			// Reading a computed style forces a style pass over the canvas: skip it when nothing sets the variable.
			if (!cssUsesVar && !node.nodeEl.style.getPropertyValue(VAR)) return null;
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
		ctx.registerEvent(
			ctx.app.workspace.on("css-change", () => {
				cssUsesVar = scanCss();
				ctx.canvases().forEach((c) => c.nodes.forEach((n) => cache.delete(n)));
			}),
		);

		ctx.intercept("node-breakpoint", (node) => {
			// A card's own breakpoint wins; then the setting for all cards.
			const own = breakpointOf(node);
			const mode = ctx.settings.mode;
			const bp = own ?? (mode === "custom" ? Math.log2(ctx.settings.percent / 100) : null);
			if (bp === null) return mode === "always" ? true : undefined;
			return node.canvas.zoom > bp || node.isEditing;
		});
		ctx.onSettingsChange(() => ctx.canvases().forEach((c) => c.rerenderViewport()));
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

	renderSettings(el, ctx: ModuleContext<BreakpointSettings>) {
		let percent: Setting | null = null;
		new Setting(el)
			.setName(ctx.t("variableBreakpoints.mode.name"))
			.setDesc(ctx.t("variableBreakpoints.mode.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ default: ctx.t("variableBreakpoints.mode.default"), always: ctx.t("variableBreakpoints.mode.always"), custom: ctx.t("variableBreakpoints.mode.custom") })
					.setValue(ctx.settings.mode)
					.onChange(async (v) => {
						await ctx.updateSettings({ mode: v as BreakpointSettings["mode"] });
						percent?.settingEl.toggle(v === "custom");
					}),
			);
		percent = new Setting(el)
			.setName(ctx.t("variableBreakpoints.percent.name"))
			.setDesc(ctx.t("variableBreakpoints.percent.desc"))
			.addSlider((s) => s.setLimits(1, 100, 1).setValue(ctx.settings.percent).setDynamicTooltip().onChange((v) => ctx.updateSettings({ percent: v })));
		percent.settingEl.toggle(ctx.settings.mode === "custom");
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
			window.setTimeout(() => text.inputEl.focus());
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
