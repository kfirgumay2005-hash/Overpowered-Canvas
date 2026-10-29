/**
 * Pages: a branch of a map moved to its own part of the same canvas (pure, unit-tested).
 *
 * The board stays one canvas file. Every item of a page carries `page` in its x-opc data, and the
 * root lists the pages with the card each one comes from (`anchor`) and its root card (`root`).
 * A page also sits in its own region of the canvas, so without the plugin the pages simply show
 * side by side, joined by the links in their cards.
 */
import type { PageInfo } from "../../data/schema";

export interface PlanNode {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	group: boolean;
	/** "" for the main page. */
	page: string;
	/** A card this item sticks to (pen marks drawn on a card). */
	stuckTo?: string;
}

export interface PlanEdge {
	from: string;
	to: string;
}

function inside(outer: PlanNode, inner: PlanNode): boolean {
	return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

/**
 * What moves with the branch below `anchor` (the anchor itself stays): the cards reached through
 * its outgoing edges on the same page, everything inside a group that is part of the branch,
 * groups holding nothing but branch cards, and marks stuck to branch cards.
 */
export function branchOf(nodes: PlanNode[], edges: PlanEdge[], anchor: string): string[] {
	const byId = new Map(nodes.map((n) => [n.id, n]));
	const start = byId.get(anchor);
	if (!start) return [];
	const page = start.page;
	const onPage = nodes.filter((n) => n.page === page);
	const set = new Set<string>();
	const queue = [anchor];
	const seen = new Set([anchor]);
	while (queue.length) {
		const cur = queue.shift()!;
		for (const e of edges) {
			if (e.from !== cur || seen.has(e.to)) continue;
			const to = byId.get(e.to);
			if (!to || to.page !== page) continue;
			seen.add(e.to);
			set.add(e.to);
			queue.push(e.to);
		}
	}
	// A group in the branch takes all it holds along.
	for (const id of [...set]) {
		const g = byId.get(id)!;
		if (g.group) for (const n of onPage) if (n.id !== id && n.id !== anchor && inside(g, n)) set.add(n.id);
	}
	const stuck = () => {
		for (const n of onPage) if (n.stuckTo && set.has(n.stuckTo)) set.add(n.id);
	};
	stuck();
	// Groups whose cards all belong to the branch go with it.
	for (const g of onPage) {
		if (!g.group || set.has(g.id) || g.id === anchor) continue;
		const held = onPage.filter((n) => n.id !== g.id && !n.group && inside(g, n));
		if (held.length && held.every((n) => set.has(n.id))) set.add(g.id);
	}
	stuck();
	set.delete(anchor);
	return onPage.filter((n) => set.has(n.id)).map((n) => n.id);
}

export interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function boundsOf(nodes: Pick<PlanNode, "x" | "y" | "width" | "height">[]): Box | null {
	if (nodes.length === 0) return null;
	return {
		minX: Math.min(...nodes.map((n) => n.x)),
		minY: Math.min(...nodes.map((n) => n.y)),
		maxX: Math.max(...nodes.map((n) => n.x + n.width)),
		maxY: Math.max(...nodes.map((n) => n.y + n.height)),
	};
}

/** Room left between a new page's region and everything already on the board. */
export const REGION_GAP = 1000;

/** Top-left corner of a free region for a new page: right of everything on the board. */
export function freeRegion(all: Pick<PlanNode, "x" | "y" | "width" | "height">[]): { x: number; y: number } {
	const b = boundsOf(all);
	return b ? { x: Math.round(b.maxX + REGION_GAP), y: Math.round(b.minY) } : { x: 0, y: 0 };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A link to a card of a canvas, shown as `label`. */
export function cardLink(linktext: string, id: string, label: string): string {
	return label ? `[[${linktext}#${id}|${label}]]` : `[[${linktext}#${id}]]`;
}

/** The card's text with a link on its own line at the end. */
export function withLink(text: string, link: string): string {
	const body = text.replace(/\s+$/, "");
	return body ? `${body}\n\n${link}` : link;
}

/** The card's text without links to card `id` (and without the blank lines they leave). */
export function withoutLink(text: string, id: string): string {
	const link = new RegExp(`[ \\t]*\\[\\[[^\\]|#]*#${escape(id)}(?:\\|[^\\]]*)?\\]\\][ \\t]*`, "g");
	return text
		.replace(link, "")
		.replace(/\n{3,}/g, "\n\n")
		.replace(/\s+$/, "");
}

/** The pages above `id`, from the top one down to `id` itself. */
export function pagePath(pages: PageInfo[], id: string): PageInfo[] {
	const byId = new Map(pages.map((p) => [p.id, p]));
	const out: PageInfo[] = [];
	const seen = new Set<string>();
	for (let p = byId.get(id); p && !seen.has(p.id); p = p.parent ? byId.get(p.parent) : undefined) {
		seen.add(p.id);
		out.unshift(p);
	}
	return out;
}

/** Pages under each page ("" = the main page), in the order they were made. */
export function pageChildren(pages: PageInfo[]): Map<string, PageInfo[]> {
	const ids = new Set(pages.map((p) => p.id));
	const out = new Map<string, PageInfo[]>();
	for (const p of pages) {
		const parent = p.parent && ids.has(p.parent) ? p.parent : "";
		(out.get(parent) ?? out.set(parent, []).get(parent)!).push(p);
	}
	return out;
}

/** How deep a page is: 1 for a page of the main page. */
export function pageDepth(pages: PageInfo[], id: string): number {
	return pagePath(pages, id).length;
}

/** The first line of a card's text as a title: no heading marks, links shown as their text. */
export function titleOf(text: string): string {
	const first = text.split("\n").find((l) => l.trim()) ?? "";
	return first
		.replace(/^#+\s*/, "")
		.replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
		.replace(/!?\[\[([^\]]*)\]\]/g, (_, target: string) => target.split("/").pop()!.replace(/#.*$/, ""))
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_~`=]+/g, "")
		.trim()
		.slice(0, 80);
}

/** Pages after `id` is merged back: its pages now hang from its parent. */
export function withoutPage(pages: PageInfo[], id: string): PageInfo[] {
	const gone = pages.find((p) => p.id === id);
	return pages
		.filter((p) => p.id !== id)
		.map((p) => {
			if (p.parent !== id) return p;
			const next: PageInfo = { ...p };
			if (gone?.parent) next.parent = gone.parent;
			else delete next.parent;
			return next;
		});
}
