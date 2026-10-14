// Pure overlap detection (no Obsidian imports, unit-tested).
import type { OverlappingPlugin } from "./module";

export const OVERLAPPING_PLUGINS: Readonly<Record<OverlappingPlugin, string>> = {
	"advanced-canvas": "Advanced Canvas",
	"canvas-mindmap": "Canvas Mindmap",
};

export interface Overlap {
	plugin: OverlappingPlugin;
	/** Ids of our enabled modules that overlap with it. */
	modules: string[];
}

/** Overlaps worth telling the user about: plugin enabled, not yet acknowledged, and at least one of our overlapping modules on. */
export function findOverlaps(
	enabledPlugins: ReadonlySet<string>,
	modules: readonly { id: string; overlapsWith?: readonly OverlappingPlugin[] }[],
	activeModules: ReadonlySet<string>,
	acknowledged: readonly string[],
): Overlap[] {
	const result: Overlap[] = [];
	for (const plugin of Object.keys(OVERLAPPING_PLUGINS) as OverlappingPlugin[]) {
		if (!enabledPlugins.has(plugin) || acknowledged.includes(plugin)) continue;
		const ids = modules.filter((m) => activeModules.has(m.id) && m.overlapsWith?.includes(plugin)).map((m) => m.id);
		if (ids.length > 0) result.push({ plugin, modules: ids });
	}
	return result;
}
