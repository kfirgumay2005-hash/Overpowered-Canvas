/** Query-group filters (pure, unit-tested). */
import type { QuerySpec } from "../../data/schema";
import { propertyMatches } from "../kanban/logic";

export interface NoteMeta {
	path: string;
	/** Tags without "#", as written (nested tags keep their slashes). */
	tags: string[];
	frontmatter: Record<string, unknown>;
	/** Resolved paths this note links to. */
	links: string[];
}

const normTag = (t: string) => t.trim().replace(/^#/, "").toLocaleLowerCase();
const stripExt = (p: string) => p.replace(/\.md$/i, "");
const base = (p: string) => stripExt(p.split("/").pop() ?? p).toLocaleLowerCase();

export function isEmptyQuery(q: QuerySpec): boolean {
	return !q.tags?.length && !q.folder?.trim() && !q.properties?.length && !q.linksTo?.length;
}

/** Every given criterion must match. An empty query matches nothing. */
export function matchesQuery(note: NoteMeta, q: QuerySpec): boolean {
	if (isEmptyQuery(q)) return false;
	if (q.tags?.length) {
		const have = note.tags.map(normTag);
		// "project" also matches "project/alpha".
		if (!q.tags.every((t) => have.some((h) => h === normTag(t) || h.startsWith(normTag(t) + "/")))) return false;
	}
	const folder = q.folder?.trim().replace(/^\/+|\/+$/g, "");
	if (folder && !note.path.toLocaleLowerCase().startsWith(folder.toLocaleLowerCase() + "/")) return false;
	for (const p of q.properties ?? []) {
		const v = note.frontmatter[p.key];
		if (p.value === undefined || p.value === "") {
			if (v === undefined || v === null || v === "") return false;
		} else if (!propertyMatches(v, p.value)) return false;
	}
	for (const target of q.linksTo ?? []) {
		const t = target.trim();
		const byPath = stripExt(t).toLocaleLowerCase();
		if (!note.links.some((l) => stripExt(l).toLocaleLowerCase() === byPath || base(l) === base(t))) return false;
	}
	return true;
}

/** "a, #b , c" → ["a", "b", "c"] */
export function parseList(text: string): string[] {
	return text
		.split(",")
		.map((s) => s.trim().replace(/^#/, "").replace(/^\[\[|\]\]$/g, ""))
		.filter(Boolean);
}

/** One per line: "key" (present) or "key: value". */
export function parseProperties(text: string): { key: string; value?: string }[] {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const i = line.indexOf(":");
			if (i < 0) return { key: line };
			const key = line.slice(0, i).trim();
			const value = line.slice(i + 1).trim();
			return value ? { key, value } : { key };
		})
		.filter((p) => p.key);
}

export function formatProperties(props: readonly { key: string; value?: string }[] | undefined): string {
	return (props ?? []).map((p) => (p.value ? `${p.key}: ${p.value}` : p.key)).join("\n");
}

/** Paths to add and owned paths to remove. */
export function diffMembers(owned: readonly string[], matching: readonly string[], presentInGroup: ReadonlySet<string>): { add: string[]; remove: string[] } {
	const want = new Set(matching);
	return {
		add: matching.filter((p) => !presentInGroup.has(p)),
		remove: owned.filter((p) => !want.has(p)),
	};
}
