/**
 * The review data, kept in a Markdown note in the plugin's files folder so that sync plugins
 * (which sync notes) carry it between devices. Pure, unit-tested; the module reads and writes
 * the note with `vault.process`, so each change is applied to the note as it is on disk.
 */
import { isPlainObject } from "../../data/validate";
import type { MemoryState } from "./fsrs";

export const NOTE_NAME = "Flowchart reviews.md";

export interface ChartEntry {
	/** A name given by the user (else the first words of the first card). */
	name?: string;
	/** The chart's hash when the entry was last written; a different one means it changed. */
	hash: string;
	/** Absent: never reviewed (or reset because the chart changed). */
	state?: MemoryState;
}

export interface ReviewData {
	v: 1;
	charts: Record<string, ChartEntry>;
}

export const emptyData = (): ReviewData => ({ v: 1, charts: {} });

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function sanitizeState(raw: unknown): MemoryState | undefined {
	if (!isPlainObject(raw)) return undefined;
	const s = num(raw.stability);
	const d = num(raw.difficulty);
	const reps = num(raw.reps);
	const last = num(raw.last);
	const due = num(raw.due);
	if (s === null || d === null || reps === null || last === null || due === null || reps < 1) return undefined;
	return { stability: s, difficulty: d, reps: Math.round(reps), lapses: Math.max(0, Math.round(num(raw.lapses) ?? 0)), last, due };
}

export function sanitizeData(raw: unknown): ReviewData {
	const out = emptyData();
	if (!isPlainObject(raw) || !isPlainObject(raw.charts)) return out;
	for (const [key, value] of Object.entries(raw.charts)) {
		if (!isPlainObject(value) || typeof value.hash !== "string") continue;
		const entry: ChartEntry = { hash: value.hash };
		if (typeof value.name === "string" && value.name.trim()) entry.name = value.name.trim();
		const state = sanitizeState(value.state);
		if (state) entry.state = state;
		out.charts[key] = entry;
	}
	return out;
}

const FENCE = /```json\s*\n([\s\S]*?)\n```/;

/** The data in a note's text (its first ```json block); empty when there is none or it is broken. */
export function parseNote(text: string): ReviewData {
	const m = FENCE.exec(text);
	if (!m) return emptyData();
	try {
		return sanitizeData(JSON.parse(m[1]!));
	} catch {
		return emptyData();
	}
}

/** The note's text: a line about what it is, then the data. Keeps any text before the block. */
export function writeNote(previous: string, data: ReviewData, intro: string): string {
	const block = "```json\n" + JSON.stringify(data, null, "\t") + "\n```";
	if (FENCE.test(previous)) return previous.replace(FENCE, () => block);
	return `${intro}\n\n${block}\n`;
}

/** The entry as it applies to a chart with `hash`: a changed chart starts over (its name stays). */
export function entryFor(data: ReviewData, key: string, hash: string): ChartEntry {
	const entry = data.charts[key];
	if (!entry) return { hash };
	if (entry.hash === hash) return entry;
	return entry.name ? { hash, name: entry.name } : { hash };
}

/** Entries whose chart changed are reset; returns null when nothing changed. */
export function resetChanged(data: ReviewData, charts: readonly { key: string; hash: string }[]): ReviewData | null {
	let changed = false;
	const next: ReviewData = { v: 1, charts: { ...data.charts } };
	for (const c of charts) {
		const entry = data.charts[c.key];
		if (entry && entry.hash !== c.hash) {
			next.charts[c.key] = entryFor(data, c.key, c.hash);
			changed = true;
		}
	}
	return changed ? next : null;
}

export function setEntry(data: ReviewData, key: string, entry: ChartEntry): ReviewData {
	const charts = { ...data.charts };
	if (!entry.name && !entry.state) delete charts[key];
	else charts[key] = entry;
	return { v: 1, charts };
}

/** A canvas was renamed or moved: its charts keep their history. */
export function movePath(data: ReviewData, from: string, to: string): ReviewData | null {
	let changed = false;
	const charts: Record<string, ChartEntry> = {};
	for (const [key, entry] of Object.entries(data.charts)) {
		if (key.startsWith(`${from}::`)) {
			charts[`${to}::${key.slice(from.length + 2)}`] = entry;
			changed = true;
		} else charts[key] = entry;
	}
	return changed ? { v: 1, charts } : null;
}

/** A canvas was deleted: its charts go. */
export function dropPath(data: ReviewData, path: string): ReviewData | null {
	const keys = Object.keys(data.charts).filter((k) => k.startsWith(`${path}::`));
	if (!keys.length) return null;
	const charts = { ...data.charts };
	for (const k of keys) delete charts[k];
	return { v: 1, charts };
}
