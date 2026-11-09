/**
 * Integration with the canvas's own undo/redo stack.
 *
 * Obsidian's canvas history stores full snapshots (canvas.getData()). A snapshot is pushed by
 * canvas.requestSave() through a 250 ms debounce (requestPushHistory). A transaction flushes
 * any pending snapshot first (so earlier edits stay their own step), runs the mutation, then
 * pushes exactly one snapshot. See docs/INTERNALS.md → "History".
 */
import type { CanvasFileData } from "../data/json-canvas";
import type { CanvasLike } from "../internals/types";

export interface HistoryApi {
	/**
	 * Runs `fn` as exactly one undo step. Synchronous only: compute final state first, animate
	 * afterwards. Nested transactions join the outer one. If `fn` throws, the canvas is rolled
	 * back to its state before the transaction and the error is rethrown.
	 */
	transaction<T>(canvas: CanvasLike, fn: () => T): T;
	isInTransaction(canvas: CanvasLike): boolean;
}

export function createHistoryApi(): HistoryApi {
	const depth = new WeakMap<CanvasLike, number>();

	return {
		isInTransaction: (canvas) => (depth.get(canvas) ?? 0) > 0,

		transaction(canvas, fn) {
			const outer = depth.get(canvas) ?? 0;
			if (outer > 0) {
				depth.set(canvas, outer + 1);
				try {
					return fn();
				} finally {
					depth.set(canvas, outer);
				}
			}

			canvas.requestPushHistory.run();
			const before = canvas.getData();
			depth.set(canvas, 1);
			let result: ReturnType<typeof fn>;
			try {
				result = fn();
			} catch (error) {
				depth.delete(canvas);
				rollback(canvas, before);
				throw error;
			}
			depth.delete(canvas);
			commit(canvas);
			return result;
		},
	};
}

function commit(canvas: CanvasLike): void {
	// Anything Obsidian queued while fn ran belongs to this step.
	canvas.requestPushHistory.cancel();
	const data = canvas.getData();
	canvas.data = data;
	const { history } = canvas;
	const top = history.data[history.current];
	if (!top || !sameSnapshot(top, data)) canvas.pushHistory(data);
	canvas.view.requestSave();
}

function rollback(canvas: CanvasLike, before: CanvasFileData): void {
	canvas.requestPushHistory.cancel();
	canvas.importData(before, true);
	canvas.data = before;
	canvas.requestFrame();
}

/**
 * Whether two snapshots hold the same board. Card by card, field by field: a snapshot shares the
 * live items' unchanged values (our `x-opc` objects are replaced, never changed in place), so
 * equal references settle almost everything and only objects that differ are compared as text.
 * Comparing the whole board as text cost two serializations of it per undo step (tens of
 * milliseconds on every pen stroke with thousands of strokes on the board).
 */
export function sameSnapshot(a: CanvasFileData, b: CanvasFileData): boolean {
	if (a === b) return true;
	try {
		const an = a.nodes ?? [];
		const bn = b.nodes ?? [];
		const ae = a.edges ?? [];
		const be = b.edges ?? [];
		if (an.length !== bn.length || ae.length !== be.length) return false;
		for (let i = 0; i < an.length; i++) if (!sameRecord(an[i], bn[i])) return false;
		for (let i = 0; i < ae.length; i++) if (!sameRecord(ae[i], be[i])) return false;
		return sameRecord({ ...a, nodes: undefined, edges: undefined }, { ...b, nodes: undefined, edges: undefined });
	} catch {
		return false;
	}
}

function sameRecord(x: unknown, y: unknown): boolean {
	if (x === y) return true;
	if (!x || !y || typeof x !== "object" || typeof y !== "object") return false;
	const ox = x as Record<string, unknown>;
	const oy = y as Record<string, unknown>;
	const keys = Object.keys(ox).filter((k) => ox[k] !== undefined);
	if (keys.length !== Object.keys(oy).filter((k) => oy[k] !== undefined).length) return false;
	for (const k of keys) {
		const vx = ox[k];
		const vy = oy[k];
		if (vx === vy) continue;
		if (!vx || !vy || typeof vx !== "object" || typeof vy !== "object") return false;
		if (JSON.stringify(vx) !== JSON.stringify(vy)) return false;
	}
	return true;
}
