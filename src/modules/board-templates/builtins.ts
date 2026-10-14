/**
 * Built-in board templates, generated in the UI language. Coordinates are left-to-right;
 * instantiate() mirrors them for RTL boards.
 */
import type { CanvasEdgeData, CanvasFileData, CanvasNodeData } from "../../data/json-canvas";
import type { I18nKey, Translate } from "../../i18n";
import { STICKY_COLORS } from "../sticky-notes/logic";

export const BUILTIN_IDS = ["kanban", "swot", "retro", "weekly", "mindmap", "flowchart"] as const;
export type BuiltinId = (typeof BUILTIN_IDS)[number];

export const BUILTIN_ICONS: Record<BuiltinId, string> = {
	kanban: "columns-3",
	swot: "layout-grid",
	retro: "messages-square",
	weekly: "calendar-days",
	mindmap: "network",
	flowchart: "workflow",
};

let seq = 0;
const id = () => `t${(seq++).toString(36)}`;

function group(label: string, x: number, y: number, width: number, height: number, extra: Partial<CanvasNodeData> = {}): CanvasNodeData {
	return { id: id(), type: "group", label, x, y, width, height, ...extra };
}

function text(t: string, x: number, y: number, width = 240, height = 80, extra: Partial<CanvasNodeData> = {}): CanvasNodeData {
	return { id: id(), type: "text", text: t, x, y, width, height, ...extra };
}

function sticky(t: string, x: number, y: number, color: string = STICKY_COLORS.yellow): CanvasNodeData {
	return text(t, x, y, 200, 200, { color, "x-opc": { kind: "sticky" } });
}

function edge(from: CanvasNodeData, fromSide: CanvasEdgeData["fromSide"], to: CanvasNodeData, toSide: CanvasEdgeData["toSide"], label?: string): CanvasEdgeData {
	return { id: id(), fromNode: from.id, fromSide, toNode: to.id, toSide, toEnd: "arrow", ...(label ? { label } : {}) };
}

function kanban(t: Translate): CanvasFileData {
	const cols: [I18nKey, string][] = [
		["templates.kanban.todo", "todo"],
		["templates.kanban.doing", "doing"],
		["templates.kanban.done", "done"],
	];
	const nodes = cols.map(([label, value], i) => group(t(label), i * 360, 0, 320, 640, { "x-opc": { kanban: { key: "status", value } } }));
	nodes.push(sticky(t("templates.kanban.sample"), 60, 60));
	return { nodes, edges: [] };
}

function swot(t: Translate): CanvasFileData {
	const q: [I18nKey, string][] = [
		["templates.swot.strengths", "4"],
		["templates.swot.weaknesses", "1"],
		["templates.swot.opportunities", "5"],
		["templates.swot.threats", "2"],
	];
	return { nodes: q.map(([label, color], i) => group(t(label), (i % 2) * 460, Math.floor(i / 2) * 360, 420, 320, { color })), edges: [] };
}

function retro(t: Translate): CanvasFileData {
	const cols: [I18nKey, string, string][] = [
		["templates.retro.well", "4", STICKY_COLORS.green],
		["templates.retro.improve", "1", STICKY_COLORS.pink],
		["templates.retro.actions", "6", STICKY_COLORS.purple],
	];
	const nodes: CanvasNodeData[] = [];
	cols.forEach(([label, color, note], i) => {
		nodes.push(group(t(label), i * 400, 0, 360, 600, { color }));
		nodes.push(sticky("", i * 400 + 80, 60, note));
	});
	return { nodes, edges: [] };
}

function weekly(t: Translate, weekStartsSunday: boolean): CanvasFileData {
	const days = [0, 1, 2, 3, 4, 5, 6].map((d) => (weekStartsSunday ? d : (d + 1) % 7));
	const nodes = days.map((d, i) => group(t(`templates.day.${d}` as I18nKey), i * 300, 0, 280, 420));
	nodes.push(group(t("templates.weekly.goals"), 0, 480, 7 * 300 - 20, 260, { color: "3" }));
	return { nodes, edges: [] };
}

function mindmap(t: Translate): CanvasFileData {
	const root = text(t("templates.mindmap.central"), 0, 0, 260, 90, { color: "6" });
	const kids = [
		text(t("templates.mindmap.idea"), 400, -140, 220, 60),
		text(t("templates.mindmap.idea"), 400, 120, 220, 60),
		text(t("templates.mindmap.idea"), -360, -140, 220, 60),
		text(t("templates.mindmap.idea"), -360, 120, 220, 60),
	];
	const edges = kids.map((k, i) => (i < 2 ? edge(root, "right", k, "left") : edge(root, "left", k, "right")));
	for (const e of edges) delete e.toEnd;
	return { nodes: [root, ...kids], edges };
}

function flowchart(t: Translate): CanvasFileData {
	const shape = (s: string) => ({ "x-opc": { shape: s } });
	const start = text(t("templates.flow.start"), 0, 0, 200, 70, shape("terminal"));
	const step = text(t("templates.flow.step"), 0, 140, 200, 80, shape("process"));
	const decide = text(t("templates.flow.decision"), -20, 290, 240, 130, shape("decision"));
	const yes = text(t("templates.flow.step"), -300, 480, 200, 80, shape("process"));
	const no = text(t("templates.flow.step"), 300, 480, 200, 80, shape("process"));
	const end = text(t("templates.flow.end"), 0, 640, 200, 70, shape("terminal"));
	return {
		nodes: [start, step, decide, yes, no, end],
		edges: [
			edge(start, "bottom", step, "top"),
			edge(step, "bottom", decide, "top"),
			edge(decide, "left", yes, "top", t("templates.flow.yes")),
			edge(decide, "right", no, "top", t("templates.flow.no")),
			edge(yes, "bottom", end, "left"),
			edge(no, "bottom", end, "right"),
		],
	};
}

export function builtinTemplate(which: BuiltinId, t: Translate, weekStartsSunday: boolean): CanvasFileData {
	seq = 0;
	switch (which) {
		case "kanban":
			return kanban(t);
		case "swot":
			return swot(t);
		case "retro":
			return retro(t);
		case "weekly":
			return weekly(t, weekStartsSunday);
		case "mindmap":
			return mindmap(t);
		case "flowchart":
			return flowchart(t);
	}
}
