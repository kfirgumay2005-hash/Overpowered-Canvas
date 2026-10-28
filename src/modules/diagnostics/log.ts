/**
 * The debug log: console output, uncaught errors and plugin events kept in memory, so they can
 * be copied or saved to a note on devices without developer tools (tablets, phones).
 */

export interface LogEntry {
	/** Milliseconds since the epoch. */
	at: number;
	level: string;
	text: string;
}

/** Longest a single entry gets (characters). */
const MAX_TEXT = 2000;

/** A fixed-size ring of the latest entries. */
export class LogBuffer {
	private entries: LogEntry[] = [];

	constructor(private readonly size: number) {}

	add(level: string, text: string, at = Date.now()): void {
		this.entries.push({ at, level, text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text });
		if (this.entries.length > this.size) this.entries.splice(0, this.entries.length - this.size);
	}

	all(): readonly LogEntry[] {
		return this.entries;
	}

	clear(): void {
		this.entries = [];
	}
}

/** One value of a console call or event payload as short text (cards and canvases by id). */
export function describe(value: unknown, depth = 0): string {
	if (value === null || value === undefined) return String(value);
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
	if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
	if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack.split("\n").slice(1, 8).join("\n")}` : ""}`;
	if (typeof Event !== "undefined" && value instanceof Event) {
		const p = value as Partial<PointerEvent>;
		return `[${value.type}${p.pointerType ? ` ${p.pointerType}#${p.pointerId}` : ""}]`;
	}
	if (typeof Node !== "undefined" && value instanceof Node) return `[${value.nodeName.toLowerCase()}${value.instanceOf(Element) && value.className ? `.${String(value.className).split(" ").join(".")}` : ""}]`;
	const o = value as Record<string, unknown>;
	// Canvas internals: name them instead of walking them.
	if ("nodes" in o && "edges" in o && "wrapperEl" in o) {
		const file = (o.view as { file?: { path?: string } } | undefined)?.file?.path;
		return `[canvas ${file ?? "?"}]`;
	}
	if ("nodeEl" in o && typeof o.id === "string") return `[card ${o.id}]`;
	if ("from" in o && "to" in o && "lineGroupEl" in o && typeof o.id === "string") return `[edge ${o.id}]`;
	if (depth >= 2) return Array.isArray(value) ? `[${value.length} items]` : "{…}";
	if (Array.isArray(value)) return `[${value.slice(0, 20).map((v) => describe(v, depth + 1)).join(", ")}${value.length > 20 ? ", …" : ""}]`;
	if (value instanceof Set || value instanceof Map) return `${value.constructor.name}(${value.size})`;
	try {
		const keys = Object.keys(o).slice(0, 20);
		return `{${keys.map((k) => `${k}: ${describe(o[k], depth + 1)}`).join(", ")}${Object.keys(o).length > 20 ? ", …" : ""}}`;
	} catch {
		return "{?}";
	}
}

/** The log as Markdown: a header about the device, then the entries in a code block. */
export function formatLog(entries: readonly LogEntry[], header: Record<string, string>): string {
	const time = (at: number) => {
		const d = new Date(at);
		const pad = (n: number, l = 2) => String(n).padStart(l, "0");
		return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
	};
	const lines = Object.entries(header).map(([k, v]) => `- ${k}: ${v}`);
	// A fence longer than any backtick run inside keeps the block closed.
	const longest = Math.max(2, ...entries.map((e) => Math.max(0, ...(e.text.match(/`+/g) ?? []).map((m) => m.length))));
	const fence = "`".repeat(longest + 1);
	const body = entries.map((e) => `${time(e.at)} ${e.level.toUpperCase().padEnd(5)} ${e.text}`).join("\n");
	return `${lines.join("\n")}\n\n${fence}\n${body}\n${fence}\n`;
}
