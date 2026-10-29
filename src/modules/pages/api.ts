/**
 * What other modules may ask the Pages module (set while it is enabled, else null): the page a
 * card is on, showing a page, and the links between a break-point card and its page.
 */
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
}

export const pagesHost: { api: PagesApi | null } = { api: null };
