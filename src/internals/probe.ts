/**
 * Runtime probe of Obsidian's canvas internals. Produces a JSON-friendly report that tells us
 * whether every internal member we rely on exists with the expected type, and whether unknown
 * properties survive Obsidian's get/set paths.
 *
 * Self-contained on purpose (no imports at runtime): it is also bundled as a paste-into-console
 * script (scripts/console/probe-internals.js) that works without this plugin.
 * The round-trip checks change in-memory state synchronously and restore it before returning;
 * nothing is saved to disk.
 */

type AnyRecord = Record<string, unknown>;

export interface ProbeReport {
	probeVersion: number;
	obsidianVersion: string | null;
	isMobile: boolean | null;
	enabledPlugins: string[];
	canvasFound: boolean;
	problems: string[];
	view?: AnyRecord;
	canvas?: AnyRecord;
	nodes?: Record<string, AnyRecord>;
	edge?: AnyRecord | null;
	roundTrip?: AnyRecord;
	patchedMethods?: string[];
}

const PROBE_KEY = "x-opc-probe";

const CANVAS_MEMBERS = [
	"app", "view", "nodes", "edges", "selection", "data", "history", "requestPushHistory", "readonly",
	"x", "y", "zoom", "tx", "ty", "tZoom", "scale", "wrapperEl", "canvasEl", "cardMenuEl", "menu",
	"nodeIndex", "edgeIndex", "edgeFrom", "edgeTo", "moved", "dirty", "config", "options",
	"getData", "setData", "importData", "requestSave", "pushHistory", "applyHistory", "undo", "redo",
	"markDirty", "markMoved", "requestFrame", "setViewport", "panTo", "panBy", "zoomBy", "zoomToFit",
	"zoomToSelection", "zoomToBbox", "getViewportBBox", "getViewportNodes", "createTextNode",
	"createFileNode", "createLinkNode", "createGroupNode", "addNode", "removeNode", "addEdge",
	"removeEdge", "getEdgesForNode", "selectOnly", "deselectAll", "updateSelection", "setReadonly",
	"render", "rerenderViewport", "virtualize", "getSelectionData", "handlePaste", "handleCopy",
	"onContextMenu", "onSelectionContextMenu", "posFromEvt", "posFromClient", "domFromPos",
];
const NODE_MEMBERS = [
	"id", "canvas", "x", "y", "width", "height", "color", "unknownData", "nodeEl", "contentEl",
	"zIndex", "isEditing", "getData", "setData", "render", "getBBox", "moveTo", "resize",
	"moveAndResize", "setColor", "updateBreakpoint", "startEditing", "showMenu", "child",
];
const EDGE_MEMBERS = [
	"id", "canvas", "from", "to", "color", "label", "unknownData", "lineGroupEl", "lineEndGroupEl",
	"path", "labelElement", "getData", "setData", "render", "updatePath", "getBBox", "setColor",
	"setLabel", "showMenu",
];
const VIEW_MEMBERS = ["canvas", "file", "getViewData", "setViewData", "requestSave", "getViewType"];

function typeOf(value: unknown): string {
	if (value === null) return "null";
	if (value instanceof Map) return "Map";
	if (value instanceof Set) return "Set";
	if (Array.isArray(value)) return "array";
	if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) return "HTMLElement";
	if (typeof SVGElement !== "undefined" && value instanceof SVGElement) return "SVGElement";
	return typeof value;
}

function members(obj: unknown, names: readonly string[]): Record<string, string> {
	const out: Record<string, string> = {};
	const rec = obj as AnyRecord;
	for (const name of names) out[name] = typeOf(rec[name]);
	return out;
}

function protoMethods(obj: unknown): string[][] {
	const levels: string[][] = [];
	let proto = Object.getPrototypeOf(obj) as object | null;
	while (proto && proto !== Object.prototype) {
		levels.push(
			Object.getOwnPropertyNames(proto)
				.filter((n) => n !== "constructor" && typeof Object.getOwnPropertyDescriptor(proto!, n)?.value === "function")
				.sort(),
		);
		proto = Object.getPrototypeOf(proto) as object | null;
	}
	return levels;
}

/** monkey-around wrappers have a function (not Function.prototype) as their prototype. */
function patchedMethods(obj: unknown, prefix: string): string[] {
	const out: string[] = [];
	let proto = Object.getPrototypeOf(obj) as object | null;
	while (proto && proto !== Object.prototype) {
		for (const n of Object.getOwnPropertyNames(proto)) {
			if (n === "constructor") continue; // subclass constructors inherit from their parent class
			const fn = Object.getOwnPropertyDescriptor(proto, n)?.value;
			if (typeof fn === "function" && Object.getPrototypeOf(fn) !== Function.prototype) out.push(`${prefix}.${n}`);
		}
		proto = Object.getPrototypeOf(proto) as object | null;
	}
	return out;
}

function attempt<T>(fn: () => T): T | string {
	try {
		return fn();
	} catch (error) {
		return `threw: ${String(error)}`;
	}
}

export function probeCanvasInternals(app: unknown): ProbeReport {
	const a = app as AnyRecord & { workspace?: AnyRecord; plugins?: AnyRecord; isMobile?: boolean };
	const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
	const enabled = a.plugins?.enabledPlugins;
	const report: ProbeReport = {
		probeVersion: 1,
		// The window title carries the app package version; the user agent only has the installer's.
		obsidianVersion: /Obsidian v?(\d+\.\d+\.\d+)/.exec(typeof document !== "undefined" ? document.title : "")?.[1] ?? /obsidian\/([\d.]+)/i.exec(ua)?.[1] ?? null,
		isMobile: typeof a.isMobile === "boolean" ? a.isMobile : null,
		enabledPlugins: enabled instanceof Set ? [...(enabled as Set<string>)].sort() : [],
		canvasFound: false,
		problems: [],
	};

	const ws = a.workspace as { getMostRecentLeaf?: () => AnyRecord | null; getLeavesOfType?: (t: string) => AnyRecord[] } | undefined;
	const leaves = [ws?.getMostRecentLeaf?.(), ...(ws?.getLeavesOfType?.("canvas") ?? [])];
	const view = leaves.map((l) => l?.view as AnyRecord | undefined).find((v) => {
		const getType = v?.getViewType as (() => string) | undefined;
		return typeof getType === "function" && getType.call(v) === "canvas" && !!v?.canvas;
	});
	if (!view) {
		report.problems.push("No open canvas found. Open a canvas (and click into it) first.");
		return report;
	}
	report.canvasFound = true;
	const canvas = view.canvas as AnyRecord & {
		nodes: Map<string, AnyRecord>;
		edges: Map<string, AnyRecord>;
		data: AnyRecord;
		history?: { data?: unknown[]; current?: number; max?: number };
		requestPushHistory?: { run?: unknown; cancel?: unknown };
		getData: () => AnyRecord;
	};

	report.view = { members: members(view, VIEW_MEMBERS), protoMethods: protoMethods(view) };
	report.canvas = {
		members: members(canvas, CANVAS_MEMBERS),
		protoMethods: protoMethods(canvas),
		nodeCount: canvas.nodes instanceof Map ? canvas.nodes.size : null,
		edgeCount: canvas.edges instanceof Map ? canvas.edges.size : null,
		zoom: canvas.zoom,
		history: {
			length: canvas.history?.data?.length ?? null,
			current: canvas.history?.current ?? null,
			max: canvas.history?.max ?? null,
			methods: protoMethods(canvas.history ?? {})[0] ?? [],
		},
		requestPushHistory: {
			type: typeOf(canvas.requestPushHistory),
			run: typeOf(canvas.requestPushHistory?.run),
			cancel: typeOf(canvas.requestPushHistory?.cancel),
		},
		dataKeys: Object.keys(canvas.data ?? {}),
	};

	const nodeList = canvas.nodes instanceof Map ? [...canvas.nodes.values()] : [];
	report.nodes = {};
	for (const node of nodeList) {
		const data = attempt(() => (node.getData as () => AnyRecord)());
		const type = typeof data === "object" ? String(data.type) : "unknown";
		if (report.nodes[type]) continue;
		report.nodes[type] = {
			members: members(node, NODE_MEMBERS),
			protoMethods: protoMethods(node),
			unknownDataKeys: Object.keys((node.unknownData as AnyRecord) ?? {}),
			getDataKeys: typeof data === "object" ? Object.keys(data) : data,
		};
	}
	if (nodeList.length === 0) report.problems.push("Canvas has no nodes; add a text card and a group, connect two cards, then run again.");

	const edge = canvas.edges instanceof Map ? [...canvas.edges.values()][0] : undefined;
	report.edge = edge
		? {
				members: members(edge, EDGE_MEMBERS),
				fromMembers: members(edge.from, ["node", "side", "end"]),
				protoMethods: protoMethods(edge),
				unknownDataKeys: Object.keys((edge.unknownData as AnyRecord) ?? {}),
				getDataKeys: Object.keys((edge.getData as () => AnyRecord)()),
			}
		: null;

	report.roundTrip = {
		node: nodeList[0] ? roundTripItem(nodeList[0]) : "no nodes",
		edge: edge ? roundTripItem(edge) : "no edges",
		root: attempt(() => {
			const saved = canvas.data;
			try {
				canvas.data = { ...saved, [PROBE_KEY]: { ok: 1 } };
				const out = canvas.getData();
				return (out[PROBE_KEY] as AnyRecord | undefined)?.ok === 1;
			} finally {
				canvas.data = saved;
			}
		}),
		historyIsShallow: attempt(() => {
			const snap = canvas.getData() as { nodes?: AnyRecord[] };
			const first = snap.nodes?.[0];
			const live = nodeList.find((n) => n.id === first?.id);
			if (!first || !live) return "no nodes";
			// A nested object in unknownData is shared by reference with the snapshot.
			const saved = live.unknownData as AnyRecord;
			try {
				const marker = { ok: 1 };
				live.unknownData = { ...saved, [PROBE_KEY]: marker };
				const again = (live.getData as () => AnyRecord)();
				return again[PROBE_KEY] === marker;
			} finally {
				live.unknownData = saved;
			}
		}),
	};

	report.patchedMethods = [
		...patchedMethods(canvas, "canvas"),
		...patchedMethods(view, "view"),
		...(nodeList[0] ? patchedMethods(nodeList[0], "node") : []),
		...(edge ? patchedMethods(edge, "edge") : []),
	];
	if (report.patchedMethods.length > 0)
		report.problems.push("Some canvas methods are patched by a plugin — run this with other canvas plugins disabled for a clean baseline.");
	return report;
}

/** setData(getData() + probe key) then getData(): does the unknown key survive? State is restored. */
function roundTripItem(item: AnyRecord): boolean | string {
	return attempt(() => {
		const getData = item.getData as () => AnyRecord;
		const setData = item.setData as (d: AnyRecord) => void;
		const savedUnknown = item.unknownData;
		const original = getData.call(item);
		try {
			setData.call(item, { ...original, [PROBE_KEY]: { ok: 1 } });
			return (getData.call(item)[PROBE_KEY] as AnyRecord | undefined)?.ok === 1;
		} finally {
			setData.call(item, original);
			item.unknownData = savedUnknown;
		}
	});
}
