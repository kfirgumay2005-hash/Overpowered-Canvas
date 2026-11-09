/**
 * A canvas as a paginated text (pure, unit-tested): one text page per canvas page, each laid out
 * like Canvas → Markdown (see buildStructure): a map's root is a heading, the rest nested bullets.
 * Unlike that export, items keep their canvas ids, so text and cards stay tied together.
 */
import type { CanvasFileData } from "../../data/json-canvas";
import { nodeText, pageOfNode, pagesOfRoot, buildStructure, type PageRef } from "../canvas-markdown/structure";
import type { OutlineItem } from "../canvas-markdown/outline";
import type { AutoHeaders } from "../canvas-markdown/headers";
import { titleOf, pageChildren, withoutLink } from "../pages/logic";

export interface BookItem {
	/** Canvas id of the card; absent for the list of unconnected cards. */
	id?: string;
	/** Text to show (without the links between a card and its page). */
	text: string;
	/** The card's own text, when it can be edited here. */
	source?: string;
	heading?: number;
	/** The page this card leads to. */
	opens?: string;
	children: BookItem[];
}

export interface BookPage {
	/** "" for the main page. */
	id: string;
	title: string;
	parent?: string;
	/** The card of the parent page this page comes from. */
	anchor?: string;
	items: BookItem[];
}

export interface Book {
	/** Page by page, parents before their children. */
	pages: BookPage[];
	/** The page each card is on. */
	pageOf: Map<string, string>;
}

export interface BookOptions {
	rtl: boolean;
	/** Title of the main page. */
	mainTitle: string;
	untitled: string;
	/** Heading of the list of unconnected cards. */
	freeLabel: string;
	/** Automatic header rules of Canvas ⇄ Markdown (the same outline, the same headings). */
	autoHeaders?: AutoHeaders | null;
}

function pageOrder(pages: PageRef[]): { id: string; ref?: PageRef }[] {
	const children = pageChildren(pages);
	const out: { id: string; ref?: PageRef }[] = [];
	const visit = (id: string, ref?: PageRef) => {
		out.push({ id, ...(ref ? { ref } : {}) });
		for (const child of children.get(id) ?? []) visit(child.id, child);
	};
	visit("");
	return out;
}

/** A root that lies alone on its page lands in the unconnected cards: it is the page's heading. */
function liftRoot(items: OutlineItem[], root: string): OutlineItem[] {
	const free = items.find((i) => i.kind === "free");
	const own = free?.children.find((c) => c.id === root);
	if (!free || !own) return items;
	free.children.splice(free.children.indexOf(own), 1);
	const rest = free.children.length ? items : items.filter((i) => i !== free);
	return [{ ...own, heading: 1 }, ...rest];
}

export function buildBook(data: CanvasFileData, opts: BookOptions): Book {
	const pages = pagesOfRoot(data);
	const nodes = data.nodes ?? [];
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const pageOf = new Map(nodes.map((n) => [n.id, pageOfNode(n)]));
	const known = new Set(pages.map((p) => p.id));
	const leadsTo = new Map(pages.map((p) => [p.anchor, p]));
	const rootOf = new Map(pages.map((p) => [p.root, p]));
	const titleOfPage = (ref: PageRef) => {
		const root = byId.get(ref.root);
		return (root && titleOf(nodeText(root))) || opts.untitled;
	};

	const toItem = (item: OutlineItem, ids: Map<string, string>): BookItem => {
		const id = item.id ? ids.get(item.id) : undefined;
		const node = id ? byId.get(id) : undefined;
		const opens = id ? leadsTo.get(id) : undefined;
		const back = id ? rootOf.get(id) : undefined;
		let text = item.text;
		if (opens) text = withoutLink(text, opens.root);
		if (back) text = withoutLink(text, back.anchor);
		return {
			text,
			children: item.children.map((c) => toItem(c, ids)),
			...(id ? { id } : {}),
			...(node?.type === "text" && typeof node.text === "string" ? { source: node.text } : {}),
			...(item.heading !== undefined ? { heading: item.heading } : {}),
			...(opens ? { opens: opens.id } : {}),
		};
	};

	const out: BookPage[] = pageOrder(pages).map(({ id, ref }) => {
		// Cards of a page that no longer exists show on the main page, as on the board.
		const scope = new Set(nodes.filter((n) => (known.has(pageOf.get(n.id)!) ? pageOf.get(n.id) : "") === id).map((n) => n.id));
		const s = buildStructure(data, { rtl: opts.rtl, freeLabel: opts.freeLabel, scope, autoHeaders: opts.autoHeaders });
		const ids = new Map([...s.alias].map(([canvasId, alias]) => [alias, canvasId]));
		const rootAlias = ref ? s.alias.get(ref.root) : undefined;
		let items = rootAlias ? liftRoot(s.items, rootAlias) : s.items;
		// The page's own map comes first, under its back link.
		if (rootAlias) items = [...items].sort((a, b) => Number(b.id === rootAlias) - Number(a.id === rootAlias));
		return {
			id,
			title: ref ? titleOfPage(ref) : opts.mainTitle,
			items: items.map((i) => toItem(i, ids)),
			...(ref?.parent && known.has(ref.parent) ? { parent: ref.parent } : ref ? { parent: "" } : {}),
			...(ref ? { anchor: ref.anchor } : {}),
		};
	});
	return { pages: out, pageOf };
}

/** Markdown for a heading item: its first line as a heading, without heading marks of its own. */
export function headingMarkdown(text: string, level: number): string {
	const [first = "", ...rest] = text.split("\n");
	const title = first.replace(/^ {0,3}#{1,6}[ \t]+/, "").trim();
	return [`${"#".repeat(Math.min(6, Math.max(1, level)))} ${title}`, ...rest].join("\n");
}

/** The cards of a canvas's JSON with one card's text replaced; null when it is not a text card. */
export function withCardText(raw: string, id: string, text: string): string | null {
	const doc = JSON.parse(raw) as CanvasFileData;
	const node = doc.nodes?.find((n) => n.id === id);
	if (node?.type !== "text") return null;
	node.text = text;
	return JSON.stringify(doc, null, "\t");
}
