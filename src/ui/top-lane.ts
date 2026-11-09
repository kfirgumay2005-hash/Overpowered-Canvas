/**
 * Bars that float along the top edge of a board — the pages bar (where you are), the search bar,
 * the minimap in a top corner and the tool palettes (drawing, highlighter, text color) — never
 * overlap, on any screen size or orientation.
 *
 * Each bar joins the lane of its board with a rank. The lane belongs to the board's canvas
 * wrapper even when a bar floats in a view on top of the board (the column view): the pages bar
 * lives in the wrapper and the column view's palettes in the column view, and they must still
 * make room for each other, so every mode shares this one layout. Lower ranks keep their place; a bar that would cover a bar of a lower
 * rank moves down, just below it (`--opc-lane-offset`, added to the bar's own `top` in CSS). One
 * controller per host re-places the bars whenever one of them or the host changes size, or a bar
 * comes or goes. The host also gets `--opc-lane-side`: the width the side controls take, so a
 * centered palette can be kept clear of them (`max-width: calc(100% - 2 * var(--opc-lane-side))`).
 */

/** Order of placement: the pages bar first, then search, the tool palettes, the minimap last. */
export const LANE_RANK = { pages: 0, search: 1, palette: 2, minimap: 3 } as const;

const MEMBER = "opc-top-lane";
const GAP = 6;

class Lane {
	private readonly members = new Map<HTMLElement, number>();
	private readonly resize: ResizeObserver;
	private readonly mutations: MutationObserver;
	private frame = 0;

	constructor(
		private readonly host: HTMLElement,
		private readonly onEmpty: () => void,
	) {
		this.resize = new ResizeObserver(() => this.schedule());
		this.resize.observe(host);
		// A bar removed by its owner (or a reload) leaves the lane; one shown or hidden is caught by
		// the ResizeObserver (its size goes to and from zero). Bars may sit in a view inside the
		// host (the column view), so each bar's own parent is watched too, and the host's children
		// (a whole view going away takes its bars with it).
		this.mutations = new MutationObserver(() => {
			for (const [el] of [...this.members]) if (!el.isConnected || !this.host.contains(el)) this.drop(el);
			this.schedule();
		});
		this.mutations.observe(host, { childList: true });
	}

	private readonly watched = new Set<Node>([]);

	add(el: HTMLElement, rank: number): void {
		const parent = el.parentElement;
		if (parent && parent !== this.host && !this.watched.has(parent)) {
			this.watched.add(parent);
			this.mutations.observe(parent, { childList: true });
		}
		this.members.set(el, rank);
		el.addClass(MEMBER);
		this.resize.observe(el);
		this.schedule();
	}

	drop(el: HTMLElement): void {
		if (!this.members.delete(el)) return;
		this.resize.unobserve(el);
		el.removeClass(MEMBER);
		el.style.removeProperty("--opc-lane-offset");
		if (this.members.size === 0) this.dispose();
		else this.schedule();
	}

	private dispose(): void {
		this.resize.disconnect();
		this.mutations.disconnect();
		this.host.win.cancelAnimationFrame(this.frame);
		this.host.style.removeProperty("--opc-lane-side");
		this.onEmpty();
	}

	private schedule(): void {
		if (this.frame) return;
		this.frame = this.host.win.requestAnimationFrame(() => {
			this.frame = 0;
			this.layout();
		});
	}

	/** Places every bar; exported through `layoutTopLane` for tests and immediate updates. */
	layout(): void {
		const host = this.host.getBoundingClientRect();
		if (host.width === 0) return;
		this.host.style.setProperty("--opc-lane-side", `${Math.round(sideReserve(this.host, host))}px`);
		const placed: DOMRect[] = [];
		const order = [...this.members].sort((a, b) => a[1] - b[1]);
		for (const [el] of order) el.style.removeProperty("--opc-lane-offset");
		for (const [el] of order) {
			const rect = el.getBoundingClientRect();
			// Hidden, or floating at the bottom (a minimap in a bottom corner): not in the lane.
			if (rect.width === 0 || rect.height === 0 || rect.top - host.top > host.height / 2) continue;
			let shift = 0;
			for (let round = 0; round < placed.length + 1; round++) {
				const top = rect.top + shift;
				const bottom = rect.bottom + shift;
				const hit = placed.find((p) => p.left < rect.right + GAP && p.right > rect.left - GAP && p.top < bottom + GAP && p.bottom > top - GAP);
				if (!hit) break;
				shift = hit.bottom + GAP - rect.top;
			}
			if (shift > 0) el.style.setProperty("--opc-lane-offset", `${Math.round(shift)}px`);
			placed.push(new DOMRect(rect.left, rect.top + shift, rect.width, rect.height));
		}
	}
}

const lanes = new WeakMap<HTMLElement, Lane>();

/** The element whose lane a bar floating in `host` joins: the board's wrapper, if it is in one. */
function laneRoot(host: HTMLElement): HTMLElement {
	return host.closest<HTMLElement>(".canvas-wrapper") ?? host;
}

/**
 * Adds `el` (a child of `host`) to the top lane of the board `host` is part of. Returns a
 * function that takes it out; removing the element from the page takes it out too.
 */
export function joinTopLane(host: HTMLElement, el: HTMLElement, rank: number): () => void {
	host = laneRoot(host);
	let lane = lanes.get(host);
	if (!lane) {
		lane = new Lane(host, () => lanes.delete(host));
		lanes.set(host, lane);
	}
	lane.add(el, rank);
	const root = host;
	return () => lanes.get(root)?.drop(el);
}

/** Places the bars of a host right away (they are otherwise placed on the next frame). */
export function layoutTopLane(host: HTMLElement): void {
	lanes.get(laneRoot(host))?.layout();
}

/**
 * Room the core side controls (zoom, undo, help…) take on either edge of the host, plus a gap:
 * a centered palette narrower than the host minus twice this never reaches them.
 */
function sideReserve(hostEl: HTMLElement, host: DOMRect): number {
	let side = 0;
	for (const el of hostEl.querySelectorAll<HTMLElement>(":scope > .canvas-controls")) {
		const r = el.getBoundingClientRect();
		if (r.width === 0) continue;
		side = Math.max(side, Math.min(r.right - host.left, host.right - r.left));
	}
	return side > 0 ? side + GAP : 12;
}
