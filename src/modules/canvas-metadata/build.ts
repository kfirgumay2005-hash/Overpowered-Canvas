/**
 * Builds an Obsidian-style CachedMetadata for a .canvas file. Pure — unit-tested.
 *
 * Inputs: the parsed file (for the frontmatter stored in x-opc) and the core canvas index entry
 * (per-text-node metadata and the list of embedded files), which Obsidian already maintains.
 */
import { SCHEMA_KEY } from "../../data/schema";
import { isJsonSafe, isPlainObject } from "../../data/validate";

export interface Pos {
	line: number;
	col: number;
	offset: number;
}
export interface Loc {
	start: Pos;
	end: Pos;
}
export interface LinkRef {
	link: string;
	original: string;
	displayText?: string;
	position: Loc;
}
export interface TagRef {
	tag: string;
	position: Loc;
}
export interface FrontmatterLinkRef {
	key: string;
	link: string;
	original: string;
	displayText?: string;
}
export interface CanvasMetadata {
	links?: LinkRef[];
	embeds?: LinkRef[];
	tags?: TagRef[];
	headings?: { heading: string; level: number; position: Loc }[];
	frontmatter?: Record<string, unknown>;
	frontmatterPosition?: Loc;
	frontmatterLinks?: FrontmatterLinkRef[];
}

/** Shape of `app.internalPlugins.plugins.canvas.instance.index.getForPath()` (see INTERNALS.md). */
export interface CoreCanvasIndexEntry {
	embeds?: { file: string; subpath?: string }[];
	caches?: Record<string, { links?: LinkRef[]; embeds?: LinkRef[]; tags?: TagRef[]; headings?: { heading: string; level: number; position: Loc }[] }>;
}

const ZERO: Loc = { start: { line: 0, col: 0, offset: 0 }, end: { line: 0, col: 0, offset: 0 } };
const WIKILINK = /\[\[([^\]|#^]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/** Canvas frontmatter: the root x-opc.frontmatter object, if valid. */
export function readFrontmatter(file: unknown): Record<string, unknown> | undefined {
	if (!isPlainObject(file)) return undefined;
	const root = file[SCHEMA_KEY];
	if (!isPlainObject(root) || !isPlainObject(root.frontmatter) || !isJsonSafe(root.frontmatter)) return undefined;
	return Object.keys(root.frontmatter).length ? root.frontmatter : undefined;
}

function frontmatterLinks(fm: Record<string, unknown>): FrontmatterLinkRef[] {
	const out: FrontmatterLinkRef[] = [];
	const visit = (key: string, value: unknown) => {
		if (typeof value === "string") {
			for (const m of value.matchAll(WIKILINK)) out.push({ key, link: (m[1] ?? "").trim() + (m[2] ?? ""), original: m[0], displayText: m[3] ?? m[1] });
		} else if (Array.isArray(value)) value.forEach((v, i) => visit(`${key}.${i}`, v));
	};
	for (const [k, v] of Object.entries(fm)) visit(k, v);
	return out;
}

export function buildCanvasMetadata(file: unknown, core: CoreCanvasIndexEntry | null): CanvasMetadata {
	const meta: CanvasMetadata = {};
	const links: LinkRef[] = [];
	const embeds: LinkRef[] = [];
	const tags: TagRef[] = [];
	const headings: NonNullable<CanvasMetadata["headings"]> = [];

	for (const cache of Object.values(core?.caches ?? {})) {
		if (!cache) continue;
		if (cache.links) links.push(...cache.links);
		if (cache.embeds) embeds.push(...cache.embeds);
		if (cache.tags) tags.push(...cache.tags);
		if (cache.headings) headings.push(...cache.headings);
	}
	for (const e of core?.embeds ?? []) {
		if (!e.file) continue;
		const link = e.file + (e.subpath ?? "");
		embeds.push({ link, original: `![[${link}]]`, displayText: e.file, position: ZERO });
	}
	if (links.length) meta.links = links;
	if (embeds.length) meta.embeds = embeds;
	if (tags.length) meta.tags = tags;
	if (headings.length) meta.headings = headings;

	const fm = readFrontmatter(file);
	if (fm) {
		meta.frontmatter = fm;
		meta.frontmatterPosition = ZERO;
		const fl = frontmatterLinks(fm);
		if (fl.length) meta.frontmatterLinks = fl;
	}
	return meta;
}
