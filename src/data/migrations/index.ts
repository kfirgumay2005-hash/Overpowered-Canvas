/**
 * Schema migrations for "x-opc" data.
 *
 * A migration upgrades a whole canvas file from version `from` to `from + 1`. It may touch the
 * root, nodes and edges, must be pure (never mutate its input) and must have unit tests.
 * Files without a root "x-opc" object are treated as the current version: we only add the root
 * object once a module has something to store there.
 */
import type { CanvasFileData } from "../json-canvas";
import { SCHEMA_KEY, SCHEMA_VERSION } from "../schema";
import { isPlainObject } from "../validate";

export interface Migration {
	from: number;
	/** Returns a new file object at version `from + 1`. */
	migrate(file: CanvasFileData): CanvasFileData;
}

/** Ordered list. Empty while we're at version 1. */
export const MIGRATIONS: readonly Migration[] = [];

export type MigrationStatus =
	| { kind: "current"; version: number }
	| { kind: "migrated"; from: number; to: number }
	/** Written by a newer plugin version: leave the extra data untouched and don't write any. */
	| { kind: "newer"; found: number; supported: number }
	/** Root "x-opc" exists but is unusable; treated as current, the bad root is left for the user to inspect. */
	| { kind: "invalid-root"; reason: string };

export interface MigrationResult {
	file: CanvasFileData;
	status: MigrationStatus;
}

export function readSchemaVersion(file: CanvasFileData): number | { invalid: string } {
	const root = file[SCHEMA_KEY];
	if (root === undefined) return SCHEMA_VERSION;
	if (!isPlainObject(root)) return { invalid: "root is not an object" };
	const v = root.v;
	if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return { invalid: `bad version ${JSON.stringify(v)}` };
	return v;
}

export function migrateFile(
	file: CanvasFileData,
	migrations: readonly Migration[] = MIGRATIONS,
	target: number = SCHEMA_VERSION,
): MigrationResult {
	const version = readSchemaVersion(file);
	if (typeof version !== "number") return { file, status: { kind: "invalid-root", reason: version.invalid } };
	if (version > target) return { file, status: { kind: "newer", found: version, supported: target } };
	if (version === target) return { file, status: { kind: "current", version } };

	let current = file;
	for (let v = version; v < target; v++) {
		const step = migrations.find((m) => m.from === v);
		if (!step) throw new Error(`No migration from x-opc v${v}`);
		current = step.migrate(current);
		const root = current[SCHEMA_KEY];
		current = { ...current, [SCHEMA_KEY]: { ...(isPlainObject(root) ? root : {}), v: v + 1 } };
	}
	return { file: current, status: { kind: "migrated", from: version, to: target } };
}
