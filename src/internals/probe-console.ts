/**
 * Entry point bundled into scripts/console/probe-internals.js — paste that file into Obsidian's
 * developer console (Ctrl+Shift+I) with a canvas open. Works without this plugin installed.
 */
import { probeCanvasInternals } from "./probe";

declare const copy: ((text: string) => void) | undefined;

const report = probeCanvasInternals((globalThis as { app?: unknown }).app);
const json = JSON.stringify(report, null, 1);
console.log(json);
if (typeof copy === "function") {
	copy(json);
	console.log("%c[overpowered-canvas] Report copied to the clipboard — paste it back to Claude.", "font-weight:bold");
}
