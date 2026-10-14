/**
 * Structural checks for a whole canvas file, run before we let a save go through.
 * Pure — no Obsidian imports — so it is unit-tested directly.
 */
import { STANDARD_NODE_TYPES, type CanvasFileData } from "./json-canvas";
import { SCHEMA_KEY } from "./schema";
import { finite, isJsonSafe, isPlainObject } from "./validate";

export interface FileProblem {
	/** "error" = saving would lose or corrupt data; "warning" = unusual but loadable. */
	level: "error" | "warning";
	path: string;
	message: string;
}

export function checkCanvasFile(data: unknown): FileProblem[] {
	const problems: FileProblem[] = [];
	const error = (path: string, message: string) => problems.push({ level: "error", path, message });
	const warn = (path: string, message: string) => problems.push({ level: "warning", path, message });

	if (!isPlainObject(data)) {
		error("$", "file data is not an object");
		return problems;
	}
	const file = data as CanvasFileData;
	const nodeIds = new Set<string>();

	if (file.nodes !== undefined && !Array.isArray(file.nodes)) error("nodes", "not an array");
	if (file.edges !== undefined && !Array.isArray(file.edges)) error("edges", "not an array");

	(Array.isArray(file.nodes) ? file.nodes : []).forEach((node: unknown, i) => {
		const path = `nodes[${i}]`;
		if (!isPlainObject(node)) return error(path, "not an object");
		const id = node.id;
		if (typeof id !== "string" || id.length === 0) error(`${path}.id`, "missing id");
		else if (nodeIds.has(id)) error(`${path}.id`, `duplicate node id "${id}"`);
		else nodeIds.add(id);
		if (typeof node.type !== "string" || !STANDARD_NODE_TYPES.has(node.type))
			warn(`${path}.type`, `non-standard type "${String(node.type)}" (vanilla Obsidian drops it)`);
		for (const key of ["x", "y", "width", "height"] as const)
			if (finite(node[key]) === undefined) error(`${path}.${key}`, "not a finite number");
		checkExtra(node[SCHEMA_KEY], `${path}.${SCHEMA_KEY}`, error);
	});

	const edgeIds = new Set<string>();
	(Array.isArray(file.edges) ? file.edges : []).forEach((edge: unknown, i) => {
		const path = `edges[${i}]`;
		if (!isPlainObject(edge)) return error(path, "not an object");
		const id = edge.id;
		if (typeof id !== "string" || id.length === 0) error(`${path}.id`, "missing id");
		else if (edgeIds.has(id)) error(`${path}.id`, `duplicate edge id "${id}"`);
		else edgeIds.add(id);
		for (const end of ["fromNode", "toNode"] as const) {
			const ref = edge[end];
			if (typeof ref !== "string" || !nodeIds.has(ref)) warn(`${path}.${end}`, `points to missing node "${String(ref)}" (vanilla Obsidian drops the edge)`);
		}
		checkExtra(edge[SCHEMA_KEY], `${path}.${SCHEMA_KEY}`, error);
	});

	checkExtra(file[SCHEMA_KEY], SCHEMA_KEY, error);
	return problems;
}

function checkExtra(value: unknown, path: string, error: (path: string, message: string) => void): void {
	if (value === undefined) return;
	if (!isPlainObject(value)) error(path, "not an object");
	else if (!isJsonSafe(value)) error(path, "contains values that cannot be saved as JSON");
}

export function hasErrors(problems: readonly FileProblem[]): boolean {
	return problems.some((p) => p.level === "error");
}
