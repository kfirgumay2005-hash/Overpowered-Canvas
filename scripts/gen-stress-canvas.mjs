#!/usr/bin/env node
/**
 * Writes a stress-test canvas into the vault.
 *
 *   npm run stress                       → "<vault>/OPC Tests/stress-1000.canvas"
 *   npm run stress -- --nodes 3000 --strokes 5000 --edges 4000 --groups 40 --seed 7
 *   npm run stress -- --out "C:/path/file.canvas"
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatCanvasJson } from "./format-canvas.mjs";
import { generateStressCanvas } from "./stress-canvas.mjs";

const args = Object.fromEntries(
	process.argv
		.slice(2)
		.join(" ")
		.split("--")
		.filter(Boolean)
		.map((part) => {
			const [key, ...value] = part.trim().split(/\s+/);
			return [key, value.join(" ")];
		}),
);
const num = (key, fallback) => (args[key] ? Number(args[key]) : fallback);

const options = {
	nodes: num("nodes", 1000),
	edges: num("edges", 1500),
	strokes: num("strokes", 2000),
	groups: num("groups", 20),
	seed: num("seed", 1),
};

// <vault>/.obsidian/plugins/<plugin>/scripts → <vault>
const vault = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const out = args.out ? resolve(args.out) : join(vault, "OPC Tests", `stress-${options.nodes}.canvas`);
if (!args.out && !existsSync(join(vault, ".obsidian"))) {
	console.error(`Vault not found at ${vault}; pass --out <file.canvas>.`);
	process.exit(1);
}

const canvas = generateStressCanvas(options);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, formatCanvasJson(canvas));
const strokeCount = canvas.nodes.reduce((sum, n) => sum + (n["x-opc"]?.strokes?.length ?? 0), 0);
console.log(`Wrote ${out}\n  ${canvas.nodes.length} nodes (incl. groups and ink carriers), ${canvas.edges.length} edges, ${strokeCount} strokes`);
