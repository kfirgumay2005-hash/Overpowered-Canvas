#!/usr/bin/env node
/**
 * Unknown-property preservation test (docs/TESTING.md → Phase 0).
 *
 *   node scripts/roundtrip.mjs create   → writes "<vault>/OPC Tests/roundtrip.canvas" (+ a note it embeds)
 *   (open it in Obsidian, move a card, undo, redo, move again, close the tab)
 *   node scripts/roundtrip.mjs check    → compares the saved file with the original
 *
 * Expected on vanilla Obsidian: every extra property on the root, nodes and edges survives;
 * the node with a non-standard type (and the edge pointing to it) is dropped — which is why
 * our own node kinds are stored as standard text/group nodes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { formatCanvasJson } from "./format-canvas.mjs";

const vault = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const folder = join(vault, "OPC Tests");
const canvasPath = join(folder, "roundtrip.canvas");
const notePath = join(folder, "roundtrip-note.md");

export const ORIGINAL = {
	nodes: [
		{
			id: "rt-group",
			type: "group",
			label: "Round-trip test",
			x: -40,
			y: -80,
			width: 980,
			height: 620,
			"x-opc": { styles: { pattern: "dots" } },
			"x-other-plugin": { keep: true },
		},
		{
			id: "rt-text",
			type: "text",
			text: "Move me a little, then undo and redo.\n\nהזיזו אותי קצת, ואז בטלו ובצעו שוב.",
			x: 0,
			y: 0,
			width: 320,
			height: 160,
			color: "4",
			"x-opc": { kind: "sticky", border: "dashed", align: "center", dir: "rtl", sticky: { author: "test", created: 1760400000000 }, styles: { pattern: "dots" } },
			"x-other-plugin": [1, 2, { deep: true }],
		},
		{
			id: "rt-shape",
			type: "text",
			text: "Shape",
			x: 440,
			y: 0,
			width: 200,
			height: 120,
			"x-opc": { kind: "shape", shape: "decision", fill: "#ffd43b", rotation: 15, opacity: 0.8 },
		},
		{
			id: "rt-ink",
			type: "text",
			text: "",
			x: 0,
			y: 220,
			width: 320,
			height: 160,
			"x-opc": {
				kind: "ink",
				strokes: [{ id: "s1", tool: "pen", color: "#1e1e1e", size: 4, pts: [10, 10, 0.5, 40, 30, 0.7, 90, 20, 0.6], tilt: [0, 0, 10, 5, 20, 10] }],
			},
		},
		{
			id: "rt-file",
			type: "file",
			file: "OPC Tests/roundtrip-note.md",
			x: 440,
			y: 220,
			width: 300,
			height: 200,
			"x-opc": { locked: true, breakpoint: 0.5 },
		},
		{ id: "rt-custom", type: "x-opc-custom", x: 780, y: 0, width: 120, height: 120, "x-opc": { kind: "shape" } },
	],
	edges: [
		{
			id: "rt-e1",
			fromNode: "rt-text",
			fromSide: "right",
			toNode: "rt-shape",
			toSide: "left",
			label: "label",
			"x-opc": { path: "dotted", arrows: { to: "diamond", from: "circle" }, route: "orthogonal", waypoints: [[380, 80]], labelT: 0.3 },
			"x-other-plugin": "edge-extra",
		},
		{ id: "rt-e2", fromNode: "rt-shape", fromSide: "right", toNode: "rt-custom", toSide: "left" },
	],
	"x-opc": { v: 1, dir: "rtl", frontmatter: { tags: ["test"], aliases: ["rt"] }, presentation: { start: "rt-text" } },
	"x-other-root": { keep: "me" },
};

/** Keys Obsidian is allowed to change during the test. */
const VOLATILE = new Set(["x", "y", "width", "height"]);
const EXPECTED_DROPPED = new Set(["rt-custom", "rt-e2"]);

function compare() {
	if (!existsSync(canvasPath)) throw new Error(`${canvasPath} not found — run "create" first.`);
	const saved = JSON.parse(readFileSync(canvasPath, "utf8"));
	const lines = [];
	let failures = 0;
	const fail = (msg) => {
		failures++;
		lines.push(`  ✗ ${msg}`);
	};
	const ok = (msg) => lines.push(`  ✓ ${msg}`);

	for (const key of Object.keys(ORIGINAL).filter((k) => k !== "nodes" && k !== "edges")) {
		if (isDeepStrictEqual(saved[key], ORIGINAL[key])) ok(`root "${key}" preserved`);
		else fail(`root "${key}" changed: ${JSON.stringify(saved[key])}`);
	}

	for (const kind of ["nodes", "edges"]) {
		const byId = new Map((saved[kind] ?? []).map((item) => [item.id, item]));
		for (const original of ORIGINAL[kind]) {
			const item = byId.get(original.id);
			if (!item) {
				if (EXPECTED_DROPPED.has(original.id)) ok(`${original.id} dropped (expected: non-standard type)`);
				else fail(`${original.id} was dropped`);
				continue;
			}
			if (EXPECTED_DROPPED.has(original.id)) lines.push(`  ! ${original.id} survived (unexpected but harmless)`);
			const moved = [...VOLATILE].filter((k) => item[k] !== original[k]);
			const changed = Object.keys({ ...original, ...item }).filter((k) => !VOLATILE.has(k) && !isDeepStrictEqual(item[k], original[k]));
			if (changed.length === 0) ok(`${original.id} preserved${moved.length ? ` (moved/resized: ${moved.join(", ")})` : ""}`);
			else fail(`${original.id} changed: ${changed.map((k) => `${k}=${JSON.stringify(item[k])}`).join(", ")}`);
		}
	}
	console.log(`Round-trip check of ${canvasPath}\n${lines.join("\n")}\n${failures === 0 ? "PASS" : `FAIL (${failures})`}`);
	process.exitCode = failures === 0 ? 0 : 1;
}

function create() {
	if (!existsSync(join(vault, ".obsidian"))) throw new Error(`Vault not found at ${vault}`);
	mkdirSync(folder, { recursive: true });
	writeFileSync(canvasPath, formatCanvasJson(ORIGINAL));
	writeFileSync(notePath, "# Round-trip note\n\nEmbedded by roundtrip.canvas. Safe to delete together with the OPC Tests folder.\n");
	console.log(`Wrote ${canvasPath}`);
}

const command = process.argv[2];
if (command === "create") create();
else if (command === "check") compare();
else if (command) {
	console.error('Usage: node scripts/roundtrip.mjs create|check');
	process.exitCode = 1;
}
