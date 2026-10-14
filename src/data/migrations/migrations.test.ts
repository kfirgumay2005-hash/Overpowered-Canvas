import { describe, expect, it } from "vitest";
import type { CanvasFileData } from "../json-canvas";
import { MIGRATIONS, migrateFile, readSchemaVersion, type Migration } from "./index";

/** A pretend v1 → v2 → v3 history, to exercise the runner before real migrations exist. */
const fakeMigrations: Migration[] = [
	{
		from: 1,
		migrate: (file) => ({
			...file,
			nodes: file.nodes?.map((n) => {
				const extra = n["x-opc"] as Record<string, unknown> | undefined;
				if (!extra || !("align" in extra)) return n;
				const { align, ...rest } = extra;
				return { ...n, "x-opc": { ...rest, textAlign: align } };
			}),
		}),
	},
	{ from: 2, migrate: (file) => ({ ...file, migratedTwice: true }) },
];

describe("readSchemaVersion", () => {
	it("treats a missing root as current", () => {
		expect(readSchemaVersion({})).toBe(1);
	});
	it("reads the version", () => {
		expect(readSchemaVersion({ "x-opc": { v: 4 } })).toBe(4);
	});
	it("flags unusable roots", () => {
		expect(readSchemaVersion({ "x-opc": "x" })).toEqual({ invalid: "root is not an object" });
		expect(readSchemaVersion({ "x-opc": { v: "1" } })).toHaveProperty("invalid");
	});
});

describe("migrateFile", () => {
	it("has no real migrations at schema v1", () => {
		expect(MIGRATIONS).toEqual([]);
		const file = { nodes: [], "x-opc": { v: 1 } };
		expect(migrateFile(file)).toEqual({ file, status: { kind: "current", version: 1 } });
	});

	it("runs every step in order and stamps the version", () => {
		const file: CanvasFileData = {
			nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, "x-opc": { align: "center" } }],
			"x-opc": { v: 1, dir: "rtl" },
		};
		const snapshot = structuredClone(file);
		const result = migrateFile(file, fakeMigrations, 3);
		expect(result.status).toEqual({ kind: "migrated", from: 1, to: 3 });
		expect(result.file.nodes?.[0]?.["x-opc"]).toEqual({ textAlign: "center" });
		expect(result.file["x-opc"]).toEqual({ v: 3, dir: "rtl" });
		expect(result.file.migratedTwice).toBe(true);
		expect(file).toEqual(snapshot); // input untouched
	});

	it("refuses files from a newer version", () => {
		const file = { "x-opc": { v: 9 } };
		expect(migrateFile(file, fakeMigrations, 3)).toEqual({ file, status: { kind: "newer", found: 9, supported: 3 } });
	});

	it("reports an invalid root without touching the file", () => {
		const file = { "x-opc": 42 };
		expect(migrateFile(file).status.kind).toBe("invalid-root");
	});

	it("throws when a step is missing", () => {
		expect(() => migrateFile({ "x-opc": { v: 1 } }, [], 2)).toThrow(/No migration/);
	});
});
