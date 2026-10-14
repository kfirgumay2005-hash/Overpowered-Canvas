/**
 * Pretty-prints canvas JSON compactly, close to how Obsidian saves canvases: objects and arrays
 * whose values are all primitives stay on one line, everything else is tab-indented.
 */
const isPrimitive = (v) => v === null || typeof v !== "object";

export function formatCanvasJson(value, indent = "") {
	const inner = `${indent}\t`;
	if (Array.isArray(value)) {
		if (value.every(isPrimitive)) return JSON.stringify(value);
		return `[\n${value.map((v) => inner + formatCanvasJson(v, inner)).join(",\n")}\n${indent}]`;
	}
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value).filter(([, v]) => v !== undefined);
		if (entries.every(([, v]) => isPrimitive(v))) return JSON.stringify(Object.fromEntries(entries));
		return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}:${formatCanvasJson(v, inner)}`).join(",\n")}\n${indent}}`;
	}
	return JSON.stringify(value);
}
