// Pure helpers for module dependency handling (no Obsidian imports, unit-tested).

/** Dependencies first; throws on unknown dependencies or cycles (programming errors). */
export function sortByDependencies<T extends { id: string; dependsOn?: readonly string[] }>(modules: readonly T[]): T[] {
	const byId = new Map(modules.map((m) => [m.id, m]));
	const out: T[] = [];
	const state = new Map<string, "visiting" | "done">();
	const visit = (m: T, path: string[]) => {
		const s = state.get(m.id);
		if (s === "done") return;
		if (s === "visiting") throw new Error(`Module dependency cycle: ${[...path, m.id].join(" → ")}`);
		state.set(m.id, "visiting");
		for (const depId of m.dependsOn ?? []) {
			const dep = byId.get(depId);
			if (!dep) throw new Error(`Module "${m.id}" depends on unknown module "${depId}"`);
			visit(dep, [...path, m.id]);
		}
		state.set(m.id, "done");
		out.push(m);
	};
	for (const m of modules) visit(m, []);
	return out;
}
