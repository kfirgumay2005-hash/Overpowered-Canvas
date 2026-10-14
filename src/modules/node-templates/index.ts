import { Menu, Notice } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { STANDARD_NODE_TYPES, type CanvasNodeData } from "../../data/json-canvas";
import { isJsonSafe, isPlainObject } from "../../data/validate";
import type { CanvasLike, Point } from "../../internals/types";
import { IconPickerModal } from "../../ui/icon-picker";
import { mutate, randomId, selectedNodes } from "../shared";

export interface NodeTemplate {
	id: string;
	name: string;
	icon: string;
	/** Node JSON without id, x and y. */
	node: Record<string, unknown>;
}

interface TemplatesSettings {
	templates: NodeTemplate[];
}

export function sanitizeTemplates(raw: unknown): NodeTemplate[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((t): t is NodeTemplate => {
		if (!isPlainObject(t) || typeof t.id !== "string" || typeof t.name !== "string" || typeof t.icon !== "string") return false;
		const node = t.node;
		return (
			isPlainObject(node) &&
			isJsonSafe(node) &&
			typeof node.type === "string" &&
			STANDARD_NODE_TYPES.has(node.type) &&
			typeof node.width === "number" &&
			typeof node.height === "number" &&
			node.width > 0 &&
			node.height > 0
		);
	});
}

/** Node data → template payload (drops identity and position). */
export function toTemplateNode(data: CanvasNodeData): Record<string, unknown> {
	const { id: _id, x: _x, y: _y, ...rest } = data;
	return structuredClone(rest);
}

/** "Save node as template"; templates appear as buttons in the card menu (bottom bar). */
export const nodeTemplatesModule = defineModule<TemplatesSettings>({
	id: "node-templates",
	name: "nodeTemplates.name",
	description: "nodeTemplates.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: { templates: [] },
	overlapsWith: ["advanced-canvas"],
	sanitizeSettings: (raw) => ({ templates: sanitizeTemplates((raw as { templates?: unknown } | undefined)?.templates) }),

	enable(ctx) {
		const buttons = new Map<string, () => void>();

		const create = (canvas: CanvasLike, template: NodeTemplate, pos: Point) =>
			mutate(ctx, canvas, () => {
				const data = { ...structuredClone(template.node), id: randomId(), x: Math.round(pos.x), y: Math.round(pos.y) } as CanvasNodeData;
				const created = canvas.importData({ nodes: [data], edges: [] }, false);
				const node = created ? [...created][0] : undefined;
				canvas.deselectAll();
				if (node) canvas.select(node);
			});

		const sync = () => {
			const wanted = new Map(ctx.settings.templates.map((t) => [t.id, t]));
			for (const [id, off] of buttons) {
				if (!wanted.has(id)) {
					off();
					buttons.delete(id);
				}
			}
			ctx.settings.templates.forEach((template, index) => {
				buttons.get(template.id)?.();
				buttons.set(
					template.id,
					ctx.addCardMenuButton({
						id: `template-${template.id}`,
						icon: template.icon,
						tooltip: ctx.t("nodeTemplates.buttonTooltip", { name: template.name }),
						order: 200 + index,
						onClick: (canvas) => {
							const w = Number(template.node.width);
							const h = Number(template.node.height);
							const c = canvas.posCenter();
							create(canvas, template, { x: c.x - w / 2, y: c.y - h / 2 });
						},
						drag: {
							size: () => ({ width: Number(template.node.width), height: Number(template.node.height) }),
							drop: (canvas, pos) => create(canvas, template, pos),
						},
						onContextMenu: (_canvas, evt) => {
							new Menu()
								.addItem((item) =>
									item.setTitle(ctx.t("nodeTemplates.remove")).setIcon("trash-2").setWarning(true).onClick(() =>
										ctx.updateSettings({ templates: ctx.settings.templates.filter((t) => t.id !== template.id) }),
									),
								)
								.showAtMouseEvent(evt);
						},
					}),
				);
			});
		};
		sync();
		ctx.onSettingsChange(sync);

		const saveSelected = () => {
			const canvas = ctx.activeCanvas();
			const nodes = canvas ? selectedNodes(canvas) : [];
			if (!canvas || nodes.length !== 1) {
				new Notice(ctx.t("nodeTemplates.selectOne"));
				return;
			}
			const data = nodes[0]!.getData();
			promptTemplate(ctx, data, (name, icon) => {
				const template: NodeTemplate = { id: randomId(8), name, icon, node: toTemplateNode(data) };
				void ctx.updateSettings({ templates: [...ctx.settings.templates, template] });
				new Notice(ctx.t("nodeTemplates.saved", { name }));
			});
		};

		ctx.addCommand({
			id: "save-node-as-template",
			name: ctx.t("nodeTemplates.save"),
			icon: "copy-plus",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || selectedNodes(canvas).length !== 1) return false;
				if (!checking) saveSelected();
				return true;
			},
		});
		ctx.onNodeMenu((menu, node) => {
			if (node.canvas.selection.size !== 1) return;
			menu.addItem((item) => item.setSection("canvas").setTitle(ctx.t("nodeTemplates.save")).setIcon("copy-plus").onClick(saveSelected));
		});
	},
});

function promptTemplate(ctx: ModuleContext<TemplatesSettings>, data: CanvasNodeData, done: (name: string, icon: string) => void): void {
	const suggested = (typeof data.text === "string" && data.text.split("\n")[0]?.replace(/^#+\s*/, "").slice(0, 40)) || (typeof data.label === "string" && data.label) || ctx.t("nodeTemplates.defaultName");
	new IconPickerModal(ctx.app, ctx.t, { title: ctx.t("nodeTemplates.save"), name: suggested, icon: data.type === "group" ? "box-select" : "sticky-note" }, (result) => done(result.name, result.icon)).open();
}
