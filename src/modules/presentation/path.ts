// Presentation traversal over edges (pure, unit-tested).

export interface SlideEdge {
	from: string;
	to: string;
	/** x-opc.order, or a numeric edge label. */
	order?: number;
	label?: string;
}

/** Outgoing targets of `id` in presentation order: explicit order, then numeric label, then file order. */
export function outgoing(edges: SlideEdge[], id: string): string[] {
	const rank = (e: SlideEdge) => {
		if (typeof e.order === "number") return e.order;
		const n = e.label !== undefined ? Number.parseFloat(e.label.trim()) : Number.NaN;
		return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
	};
	return edges
		.map((e, i) => ({ e, i }))
		.filter(({ e }) => e.from === id)
		.sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
		.map(({ e }) => e.to);
}

/**
 * The next slide after the visited `history` (last = current): the first unvisited target of the
 * current slide; otherwise backtrack through history to the nearest slide with one left.
 */
export function nextSlide(edges: SlideEdge[], history: string[]): string | null {
	const visited = new Set(history);
	for (let i = history.length - 1; i >= 0; i--) {
		const target = outgoing(edges, history[i]!).find((t) => !visited.has(t));
		if (target) return target;
	}
	return null;
}

/** Ids reachable from start in presentation order (used for "slide n of m"). */
export function slideOrder(edges: SlideEdge[], start: string): string[] {
	const history = [start];
	for (;;) {
		const next = nextSlide(edges, history);
		if (!next) return history;
		history.push(next);
	}
}
