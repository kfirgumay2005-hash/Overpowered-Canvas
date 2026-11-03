/**
 * What other modules may ask the Pages module (set while it is enabled, else null): the page a
 * card is on, showing a page, and the links between a break-point card and its page.
 */
import type { CanvasFileData } from "../../data/json-canvas";
import type { PageInfo } from "../../data/schema";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";

export interface PageLink {
	/** The card left in the map, which leads to the page. */
	anchor: string;
	/** The page's root card, which leads back. */
	root: string;
}

export interface PagesApi {
	/** "" for the main page. */
	pageOf(node: CanvasNodeLike): string;
	/** The page shown in this view. */
	current(canvas: CanvasLike): string;
	/** Shows the page `node` is on (if another one) before something reveals it. */
	reveal(canvas: CanvasLike, node: CanvasNodeLike): void;
	links(canvas: CanvasLike): PageLink[];
	/** The page a canvas shows when it is next opened. */
	remember(path: string, page: string): void;
	openIndex(): Promise<void>;
	/** Tells the pages index that what it shows changed. */
	refreshIndex(): void;
	/** Runs `fn` (an import that set each card's page itself): new cards keep the page they have. */
	keepingPages<T>(fn: () => T): T;
	/** Shows `page` in this view (as the index does). */
	show(canvas: CanvasLike, page: string): void;
	/**
	 * Adds a copy of a canvas that has pages (a template, ids already fresh): its main page lands
	 * on the page shown, centered on `center`; each of its pages becomes a page under it, in a free
	 * region. One undo step. Null when it could not be added.
	 */
	insertWithPages(canvas: CanvasLike, data: CanvasFileData, center: { x: number; y: number }): CanvasNodeLike[] | null;
}

/** What the index and the bar show: the pages of a canvas on the board or in another view. */
export interface PagesSource {
	/** Identifies what is shown: the index draws again when it changes. */
	key: object;
	alive(): boolean;
	pages(): PageInfo[];
	/** "" for the main page. */
	current(): string;
	title(page: string): string;
	count(page: string): number;
	show(page: string): void;
	merge?(page: string): void;
}

export const pagesHost: { api: PagesApi | null } = { api: null };

/** Views other than canvases that show pages (notes with pages): the index asks them too. */
export const pageSources = new Set<(view: unknown) => PagesSource | null>();
