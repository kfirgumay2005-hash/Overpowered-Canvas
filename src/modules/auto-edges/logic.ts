// Pure helpers for auto edges (unit-tested).

/** "[[Note|alias]]", "[[Note#Heading]]" or a plain "Note" → the link path. */
export function linkPath(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const m = /\[\[([^\]|#^]+)/.exec(value);
	const path = (m?.[1] ?? value).trim();
	return path ? path : null;
}

/** Wanted auto edges as "fromId->toId" → [from, to]. Pure apart from the resolver passed in. */
export function desiredAutoEdges(
	fileNodes: { id: string; path: string; property: unknown }[],
	resolve: (link: string, sourcePath: string) => string | null,
): Map<string, [string, string]> {
	const byPath = new Map<string, string[]>();
	for (const n of fileNodes) byPath.set(n.path, [...(byPath.get(n.path) ?? []), n.id]);
	const out = new Map<string, [string, string]>();
	for (const n of fileNodes) {
		const values = Array.isArray(n.property) ? n.property : n.property == null ? [] : [n.property];
		for (const v of values) {
			const link = linkPath(v);
			const dest = link ? resolve(link, n.path) : null;
			if (!dest) continue;
			for (const target of byPath.get(dest) ?? []) if (target !== n.id) out.set(`${n.id}->${target}`, [n.id, target]);
		}
	}
	return out;
}
