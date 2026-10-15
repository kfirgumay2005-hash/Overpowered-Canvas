import { Modal, Notice, Setting, type App } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { EdgeSide } from "../../data/json-canvas";
import type { I18nKey, Translate } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { descendants, directionBetween, logical, type Dir, type TEdge, type TNode } from "../mindmap/tree";
import { canvasDirection, mutate, nodeType, selectedNodes } from "../shared";
import { disposeElk, getElk } from "./engine";
import { computeLayout, interpolate, type Algorithm, type LayoutDirection, type Positions } from "./layout";

interface LayoutSettings {
	algorithm: Algorithm;
	direction: LayoutDirection;
	scope: "auto" | "canvas";
	spacing: number;
	levelSpacing: number;
	animate: boolean;
}

const OPPOSITE: Record<Dir, EdgeSide> = { right: "left", left: "right", down: "top", up: "bottom" };
const SIDE: Record<Dir, EdgeSide> = { right: "right", left: "left", down: "bottom", up: "top" };
const ALGORITHMS: Algorithm[] = ["mindmap", "layered", "grid"];
const DIRECTIONS: LayoutDirection[] = ["right", "left", "down", "up", "balanced", "radial"];

/** Which nodes a layout applies to: the selection (plus subtrees of a single root) or the whole canvas. */
export function layoutTargets(canvas: CanvasLike, scope: LayoutSettings["scope"]): CanvasNodeLike[] {
	const usable = (n: CanvasNodeLike) => nodeType(n) !== "group" && !n.id.includes("~") && !n.nodeEl.hasClass("opc-hidden-by-collapse") && !n.nodeEl.hasClass("opc-hidden-by-branch");
	const all = [...canvas.nodes.values()].filter(usable);
	const selected = selectedNodes(canvas).filter(usable);
	if (scope === "canvas" || selected.length === 0) return all;
	if (selected.length === 1) {
		// One card selected: its whole subtree.
		const edges = [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id }));
		const ids = new Set([selected[0]!.id, ...descendants(edges, selected[0]!.id)]);
		return [selected[0]!, ...all.filter((n) => ids.has(n.id) && n !== selected[0])];
	}
	return selected;
}

class LayoutModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly choice: LayoutSettings,
		private readonly onRun: (choice: LayoutSettings) => void,
	) {
		super(app);
	}
	override onOpen(): void {
		const { t, choice } = this;
		this.setTitle(t("autoLayout.title"));
		new Setting(this.contentEl).setName(t("autoLayout.algorithm")).addDropdown((d) => {
			for (const a of ALGORITHMS) d.addOption(a, t(`autoLayout.algorithm.${a}` as I18nKey));
			d.setValue(choice.algorithm).onChange((v) => (choice.algorithm = v as Algorithm));
		});
		new Setting(this.contentEl).setName(t("autoLayout.direction")).addDropdown((d) => {
			for (const dir of DIRECTIONS) d.addOption(dir, t(`autoLayout.direction.${dir}` as I18nKey));
			d.setValue(choice.direction).onChange((v) => (choice.direction = v as LayoutDirection));
		});
		new Setting(this.contentEl).setName(t("autoLayout.scope")).addDropdown((d) =>
			d
				.addOptions({ auto: t("autoLayout.scope.auto"), canvas: t("autoLayout.scope.canvas") })
				.setValue(choice.scope)
				.onChange((v) => (choice.scope = v as LayoutSettings["scope"])),
		);
		new Setting(this.contentEl).addButton((b) =>
			b
				.setButtonText(t("autoLayout.run"))
				.setCta()
				.onClick(() => {
					this.close();
					this.onRun(choice);
				}),
		);
	}
	override onClose(): void {
		this.contentEl.empty();
	}
}

async function runLayout(ctx: ModuleContext<LayoutSettings>, canvas: CanvasLike, choice: LayoutSettings): Promise<void> {
	const targets = layoutTargets(canvas, choice.scope);
	if (targets.length < 2) {
		new Notice(ctx.t("autoLayout.nothing"));
		return;
	}
	const rtl = canvasDirection(canvas) === "rtl";
	// "right" means "forward": mirrored in right-to-left canvases.
	const direction: LayoutDirection = choice.direction === "right" || choice.direction === "left" ? logical(choice.direction, rtl) : choice.direction;
	const ids = new Set(targets.map((n) => n.id));
	const tnodes: TNode[] = targets.map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));
	const tedges: TEdge[] = [...canvas.edges.values()].filter((e) => ids.has(e.from.node.id) && ids.has(e.to.node.id)).map((e) => ({ from: e.from.node.id, to: e.to.node.id }));
	let positions: Positions;
	try {
		positions = await computeLayout(getElk(), tnodes, tedges, { algorithm: choice.algorithm, direction, spacing: choice.spacing, levelSpacing: choice.levelSpacing });
	} catch (error) {
		console.error("[overpowered-canvas] layout failed", error);
		new Notice(ctx.t("autoLayout.failed"));
		return;
	}
	const start: Positions = new Map(targets.map((n) => [n.id, { x: n.x, y: n.y }]));
	const ok = mutate(ctx, canvas, () => {
		for (const n of targets) {
			const p = positions.get(n.id);
			if (p) n.moveTo(p);
		}
		// Attach edges to the facing sides (floating ends pick their own side).
		if (choice.algorithm !== "grid")
			for (const e of canvas.edges.values()) {
				if (!ids.has(e.from.node.id) || !ids.has(e.to.node.id)) continue;
				const floating = ctx.data.edge(e).get().floating;
				const dir = directionBetween(e.from.node, e.to.node);
				e.update({ ...e.from, side: floating?.from ? e.from.side : SIDE[dir] }, { ...e.to, side: floating?.to ? e.to.side : OPPOSITE[dir] });
			}
	});
	if (!ok) return;
	ctx.events.emit("layout-applied", canvas, targets, `${choice.algorithm}/${direction}`);
	if (!ctx.settings.animate) return;
	// Animate from the old positions to the saved ones (purely visual).
	const end: Positions = new Map(targets.map((n) => [n.id, { x: n.x, y: n.y }]));
	const t0 = performance.now();
	const frame = (now: number) => {
		const t = Math.min(1, (now - t0) / 350);
		const pos = interpolate(start, end, t);
		for (const n of targets) {
			const p = pos.get(n.id);
			if (p) n.moveTo(p);
		}
		if (t < 1) window.requestAnimationFrame(frame);
	};
	window.requestAnimationFrame(frame);
}

/** Auto layout (elkjs): mind map in any direction, radial or balanced; layered flowcharts; grid packing. */
export const autoLayoutModule = defineModule<LayoutSettings>({
	id: "auto-layout",
	name: "autoLayout.name",
	description: "autoLayout.desc",
	group: "mindmap",
	defaultEnabled: true,
	defaultSettings: { algorithm: "mindmap", direction: "right", scope: "auto", spacing: 30, levelSpacing: 80, animate: true },
	overlapsWith: ["canvas-mindmap"],
	sanitizeSettings: (raw, defaults) => {
		const r = (raw ?? {}) as Partial<LayoutSettings>;
		const num = (v: unknown, d: number) => (typeof v === "number" && v >= 0 && v <= 1000 ? v : d);
		return {
			algorithm: ALGORITHMS.includes(r.algorithm as Algorithm) ? (r.algorithm as Algorithm) : defaults.algorithm,
			direction: DIRECTIONS.includes(r.direction as LayoutDirection) ? (r.direction as LayoutDirection) : defaults.direction,
			scope: r.scope === "canvas" ? "canvas" : "auto",
			spacing: num(r.spacing, defaults.spacing),
			levelSpacing: num(r.levelSpacing, defaults.levelSpacing),
			animate: typeof r.animate === "boolean" ? r.animate : defaults.animate,
		};
	},

	enable(ctx) {
		ctx.register(disposeElk);
		const run = (canvas: CanvasLike, patch: Partial<LayoutSettings> = {}) => void runLayout(ctx, canvas, { ...ctx.settings, ...patch });
		const command = (id: string, name: string, icon: string, fn: (c: CanvasLike) => void) =>
			ctx.addCommand({
				id,
				name,
				icon,
				checkCallback: (checking) => {
					const canvas = ctx.activeCanvas();
					if (!canvas || canvas.readonly) return false;
					if (!checking) fn(canvas);
					return true;
				},
			});
		const openModal = (canvas: CanvasLike) =>
			new LayoutModal(ctx.app, ctx.t, { ...ctx.settings }, (choice) => {
				void ctx.updateSettings(choice);
				run(canvas, choice);
			}).open();
		command("auto-layout", ctx.t("autoLayout.command"), "layout-dashboard", openModal);
		command("repeat-layout", ctx.t("autoLayout.repeat"), "repeat", (c) => run(c));
		command("layout-mindmap", ctx.t("autoLayout.quick.mindmap"), "network", (c) => run(c, { algorithm: "mindmap", direction: "balanced" }));
		command("layout-flowchart", ctx.t("autoLayout.quick.layered"), "workflow", (c) => run(c, { algorithm: "layered", direction: "down" }));
		command("layout-grid", ctx.t("autoLayout.quick.grid"), "layout-grid", (c) => run(c, { algorithm: "grid" }));
		ctx.onSelectionMenu((menu, canvas) => {
			if (!canvas.readonly) menu.addItem((item) => item.setSection("action").setTitle(ctx.t("autoLayout.command")).setIcon("layout-dashboard").onClick(() => openModal(canvas)));
		});
		ctx.onNodeMenu((menu, node) => {
			if (!node.canvas.readonly) menu.addItem((item) => item.setSection("action").setTitle(ctx.t("autoLayout.command")).setIcon("layout-dashboard").onClick(() => openModal(node.canvas)));
		});
	},

	renderSettings(el, ctx) {
		new Setting(el)
			.setName(ctx.t("autoLayout.spacing.name"))
			.addSlider((s) => s.setLimits(10, 200, 5).setValue(ctx.settings.spacing).onChange((v) => ctx.updateSettings({ spacing: v })));
		new Setting(el)
			.setName(ctx.t("autoLayout.levelSpacing.name"))
			.addSlider((s) => s.setLimits(20, 400, 10).setValue(ctx.settings.levelSpacing).onChange((v) => ctx.updateSettings({ levelSpacing: v })));
		new Setting(el).setName(ctx.t("autoLayout.animate.name")).addToggle((t) => t.setValue(ctx.settings.animate).onChange((v) => ctx.updateSettings({ animate: v })));
	},
});
