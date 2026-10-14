/**
 * English UI strings — the source of truth for every i18n key.
 * Other locales must define exactly the same keys (enforced by the compiler).
 * Placeholders use {name} syntax.
 */
export const en = {
	"plugin.name": "Overpowered Canvas",

	"settings.language.name": "Interface language",
	"settings.language.desc": "Language of this plugin's menus, commands and settings.",
	"settings.language.auto": "Same as Obsidian",
	"settings.language.en": "English",
	"settings.language.he": "Hebrew (עברית)",
	"settings.language.reload": "Reload the plugin (or Obsidian) to apply the new language to commands.",
	"settings.module.reset": "Reset to defaults",
	"settings.module.reset.done": "{module}: settings reset to defaults.",
	"settings.module.desktopOnly": "Not available on mobile.",
	"settings.module.failed": "Failed to start — see the developer console for details.",
	"settings.module.requires": "Requires: {modules}.",
	"settings.coexistence.name": "Overlap notice",
	"settings.coexistence.desc": "Show the notice about overlapping plugins (Advanced Canvas, Canvas Mindmap) again on next start.",
	"settings.coexistence.button": "Show again",
	"settings.coexistence.reset.done": "The overlap notice will be shown on next start.",

	"group.core": "Core",
	"group.nodes": "Nodes",
	"group.edges": "Edges",
	"group.vault": "Vault integration",
	"group.interaction": "Interaction",
	"group.mindmap": "Mind map",
	"group.drawing": "Drawing & shapes",
	"group.navigation": "Navigation",
	"group.data": "Data features",
	"group.developer": "Developer",

	"module.enable.failed": "Overpowered Canvas: module “{module}” failed to start and was disabled.",
	"module.enable.missingDependency": "Overpowered Canvas: enable “{dependency}” first — “{module}” depends on it.",
	"module.disable.cascade": "Overpowered Canvas: also disabled {modules}, which depend on “{module}”.",

	"coexistence.title": "Overlapping canvas plugins detected",
	"coexistence.intro": "These plugins are enabled and do some of the same things as Overpowered Canvas. Running both may cause conflicts.",
	"coexistence.row": "{plugin} overlaps with: {modules}",
	"coexistence.disableOurs": "Disable our overlapping modules",
	"coexistence.keepBoth": "Keep both",
	"coexistence.disabled": "Overpowered Canvas: disabled {count} overlapping module(s).",

	"data.newerSchema": "Overpowered Canvas: “{file}” was saved by a newer version of this plugin (data version {found}, this version supports {supported}). Its extra data is read-only until you update the plugin.",

	"diagnostics.name": "Diagnostics",
	"diagnostics.desc": "Developer tools: copy a report of the canvas internals, list active patches and run a pan/zoom benchmark.",
	"diagnostics.frames.name": "Benchmark length (frames)",
	"diagnostics.frames.desc": "How many animation frames the pan/zoom benchmark runs for.",
	"diagnostics.cmd.report": "Copy canvas internals report",
	"diagnostics.cmd.benchmark": "Run pan/zoom benchmark",
	"diagnostics.cmd.listPatches": "Copy list of active patches",
	"diagnostics.noCanvas": "Open a canvas first.",
	"diagnostics.report.copied": "Canvas internals report copied to the clipboard.",
	"diagnostics.patches.copied": "{count} active patch(es) — list copied to the clipboard.",
	"diagnostics.benchmark.running": "Benchmark running — don't touch the canvas…",
	"diagnostics.benchmark.done": "Benchmark: {fps} fps average, {p95} ms p95 frame time, {slow} slow frames. Results copied to the clipboard.",
} as const;

export type I18nKey = keyof typeof en;
