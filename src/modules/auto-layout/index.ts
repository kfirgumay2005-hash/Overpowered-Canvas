import { Modal, Notice, Setting, type App } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { I18nKey, Translate } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import type { MapLayout } from "../../data/schema";
import { descendants, logical, type TEdge } from "../mindmap/tree";
import { canvasDirection, mutate, nodeType, selectedNodes } from "../shared";
import { disposeElk, getElk } from "./engine";
import { collapseGroups, expandPositions, fitGroups, groupsAround } from "./blocks";
import { applyEdgeSides, arrangeState, isDrawingNode, isOutOfView, type SideMode } from "./arrange";
import { computeLayout, interpolate, type Algorithm, type LayoutDirection, type Positions } from "./layout";
import { logError } from "../../core/log";

interface LayoutSettings {
	algorithm: Algorithm;
	direction: LayoutDirection;
	scope: "auto" | "canvas";
	spacing: number;
	levelSpacing: number;
	animate: boolean;
	/** How edges pick their sides after a layout. */
	sides: SideMode;
	/** Route an edge around the cards when no pair of sides gives it a clear path. */
	bend: boolean;
}

const ALGORITHMS: Algorithm[] = ["mindmap", "layered", "grid"];
const DIRECTIONS: LayoutDirection[] = ["right", "left", "down", "up", "balanced", "radial"];

/** Which nodes a layout applies to: the selection (plus subtrees of a single root) or the whole canvas. */
export function layoutTargets(canvas: CanvasLike, scope: LayoutSettings["scope"]): CanvasNodeLike[] {
	// Drawings (ink, lines, guides) are not cards to arrange: lines follow the cards they connect.
	const usable = (n: CanvasNodeLike) => nodeType(n) !== "group" && !isDrawingNode(n) && !n.id.includes("~") && !isOutOfView(n);
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

/** The stored name of a layout choice (logical direction, as chosen). */
export function mapLayoutOf(choice: Pick<LayoutSettings, "algorithm" | "direction">): MapLayout {
	if (choice.algorithm === "grid") return "grid";
	if (choice.algorithm === "layered") return `layered-${choice.direction === "radial" || choice.direction === "balanced" ? "right" : choice.direction}`;
	return choice.direction;
}

async function runLayout(ctx: ModuleContext<LayoutSettings>, canvas: CanvasLike, choice: LayoutSettings): Promise<void> {
	const targets = layoutTargets(canvas, choice.scope);
	// Groups move as rigid blocks: the chosen ones, and the outermost group around any target.
	const whole = choice.scope === "canvas" || selectedNodes(canvas).length === 0;
	const allNodes = [...canvas.nodes.values()].filter((n) => !n.id.includes("~") && !isOutOfView(n));
	const chosenGroups = new Set((whole ? allNodes : selectedNodes(canvas)).filter((n) => nodeType(n) === "group").map((n) => n.id));
	const box = (n: CanvasNodeLike) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height });
	const shownIds = new Set(allNodes.map((n) => n.id));
	const allEdges: TEdge[] = [...canvas.edges.values()].map((e) => ({ from: e.from.node.id, to: e.to.node.id })).filter((e) => shownIds.has(e.from) && shownIds.has(e.to));
	const boxes = allNodes.map((n) => ({ ...box(n), group: nodeType(n) === "group" }));
	// A group holding every card being arranged is the map's frame, not a block: it grows instead.
	const open = whole ? new Set<string>() : groupsAround(boxes, targets.map((n) => n.id));
	const blocks = collapseGroups(boxes, new Set(targets.map((n) => n.id)), chosenGroups, allEdges, open);
	if (blocks.nodes.length < 2) {
		new Notice(ctx.t("autoLayout.nothing"));
		return;
	}
	const rtl = canvasDirection(canvas) === "rtl";
	// "right" means "forward": mirrored in right-to-left canvases.
	const direction: LayoutDirection = choice.direction === "right" || choice.direction === "left" ? logical(choice.direction, rtl) : choice.direction;
	let laid: Positions;
	try {
		laid = await computeLayout(getElk(), blocks.nodes, blocks.edges, { algorithm: choice.algorithm, direction, spacing: choice.spacing, levelSpacing: choice.levelSpacing });
	} catch (error) {
		logError("[overpowered-canvas] layout failed", error);
		new Notice(ctx.t("autoLayout.failed"));
		return;
	}
	const byId = new Map(allNodes.map((n) => [n.id, n]));
	const positions = expandPositions(blocks, laid, new Map(allNodes.map((n) => [n.id, box(n)])));
	const grown = fitGroups(boxes, open, positions);
	const moved = [...positions.keys()].map((id) => byId.get(id)).filter((n): n is CanvasNodeLike => !!n);
	const start: Positions = new Map(moved.map((n) => [n.id, { x: n.x, y: n.y }]));
	const ok = mutate(ctx, canvas, () => {
		for (const n of moved) n.moveTo(positions.get(n.id)!);
		for (const [id, r] of grown) byId.get(id)?.moveAndResize(r);
		// Edges that moved get the sides of a clear path (floating ends keep theirs).
		applyEdgeSides(ctx, canvas, new Set(positions.keys()), (a, b) => blocks.blockOf.get(a) !== undefined && blocks.blockOf.get(a) === blocks.blockOf.get(b));
		// Each map arranged here remembers its layout: cards dropped into it later re-arrange it.
		const hasParent = new Set(allEdges.filter((e) => e.from !== e.to).map((e) => e.to));
		const hasChild = new Set(allEdges.filter((e) => e.from !== e.to).map((e) => e.from));
		const roots = targets.filter((n) => !hasParent.has(n.id) && hasChild.has(n.id)).map((n) => n.id);
		if (roots.length) {
			const layouts = { ...(ctx.data.root(canvas).get().mapLayouts ?? {}) };
			for (const id of roots) layouts[id] = mapLayoutOf(choice);
			ctx.data.root(canvas).set({ mapLayouts: layouts });
		}
	});
	if (!ok) return;
	ctx.events.emit("layout-applied", canvas, moved, `${choice.algorithm}/${direction}`);
	if (!ctx.settings.animate) return;
	// Animate from the old positions to the saved ones (purely visual).
	const end: Positions = new Map(moved.map((n) => [n.id, { x: n.x, y: n.y }]));
	const t0 = performance.now();
	const frame = (now: number) => {
		const t = Math.min(1, (now - t0) / 350);
		const pos = interpolate(start, end, t);
		for (const n of moved) {
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
	defaultSettings: { algorithm: "mindmap", direction: "right", scope: "auto", spacing: 30, levelSpacing: 80, animate: true, sides: "clear", bend: true },
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
			sides: r.sides === "facing" ? "facing" : "clear",
			bend: typeof r.bend === "boolean" ? r.bend : defaults.bend,
		};
	},

	enable(ctx) {
		ctx.register(disposeElk);
		const share = () => {
			arrangeState.sides = ctx.settings.sides;
			arrangeState.bend = ctx.settings.bend;
		};
		share();
		ctx.onSettingsChange(share);
		ctx.register(() => {
			arrangeState.sides = "clear";
			arrangeState.bend = true;
		});
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
		new Setting(el)
			.setName(ctx.t("autoLayout.sides.name"))
			.setDesc(ctx.t("autoLayout.sides.desc"))
			.addDropdown((d) =>
				d
					.addOptions({ clear: ctx.t("autoLayout.sides.clear"), facing: ctx.t("autoLayout.sides.facing") })
					.setValue(ctx.settings.sides)
					.onChange((v) => ctx.updateSettings({ sides: v as SideMode })),
			);
		new Setting(el)
			.setName(ctx.t("autoLayout.bend.name"))
			.setDesc(ctx.t("autoLayout.bend.desc"))
			.addToggle((t) => t.setValue(ctx.settings.bend).onChange((v) => ctx.updateSettings({ bend: v })));
	},
});
