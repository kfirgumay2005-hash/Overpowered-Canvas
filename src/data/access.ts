/**
 * Typed, validated access to "x-opc" data on live canvas objects.
 *
 * IMPORTANT — immutability: history snapshots are shallow copies, so the objects stored under
 * "x-opc" are shared between the live canvas and its undo stack. Never mutate them in place;
 * always write a new object through set(). See docs/INTERNALS.md → "History".
 */
import type { HistoryApi } from "../core/history";
import type { CanvasEdgeLike, CanvasLike, CanvasNodeLike } from "../internals/types";
import { readSchemaVersion } from "./migrations";
import { EDGE_DEFAULTS, NODE_DEFAULTS, ROOT_DEFAULTS, SCHEMA_KEY, SCHEMA_VERSION, type OpcEdge, type OpcNode, type OpcRoot } from "./schema";
import { applyPatch, EDGE_SHAPE, NODE_SHAPE, readEdge, readNode, readRoot, ROOT_SHAPE, type Shape } from "./validate";

export interface ExtraHandle<T> {
	/** Sanitized snapshot. Treat as read-only. */
	get(): Readonly<T>;
	/**
	 * Applies a patch (`undefined` removes a field). Joins the current transaction, or saves on
	 * its own. `history: false` saves without an undo step (view state such as the last slide).
	 */
	set(patch: Partial<T>, options?: { history?: boolean }): void;
}

export type RootExtra = Omit<OpcRoot, "v">;

export interface CanvasDataApi {
	node(node: CanvasNodeLike): ExtraHandle<OpcNode>;
	edge(edge: CanvasEdgeLike): ExtraHandle<OpcEdge>;
	root(canvas: CanvasLike): ExtraHandle<RootExtra>;
	/** False when the file was written by a newer schema version; all writes are refused then. */
	isWritable(canvas: CanvasLike): boolean;
}

export class ReadOnlyExtraDataError extends Error {
	constructor(readonly found: number | string) {
		super(`Canvas extra data is read-only (schema version ${found} is newer than ${SCHEMA_VERSION})`);
		this.name = "ReadOnlyExtraDataError";
	}
}

export type ExtraChange = { node: CanvasNodeLike } | { edge: CanvasEdgeLike } | { root: CanvasLike };

export function createCanvasDataApi(
	history: HistoryApi,
	onReadOnly: (canvas: CanvasLike, found: number | string) => void,
	onChange: (change: ExtraChange) => void = () => {},
): CanvasDataApi {
	const isWritable = (canvas: CanvasLike): boolean => {
		const v = readSchemaVersion(canvas.data);
		return typeof v === "number" && v <= SCHEMA_VERSION;
	};

	const guardWrite = (canvas: CanvasLike): void => {
		if (isWritable(canvas)) return;
		const v = readSchemaVersion(canvas.data);
		const found = typeof v === "number" ? v : v.invalid;
		onReadOnly(canvas, found);
		throw new ReadOnlyExtraDataError(found);
	};

	const afterWrite = (canvas: CanvasLike, options?: { history?: boolean }): void => {
		if (!history.isInTransaction(canvas)) canvas.requestSave(options?.history !== false);
	};

	function itemHandle<T extends object>(
		item: CanvasNodeLike | CanvasEdgeLike,
		read: (raw: unknown) => T,
		shape: Shape<T>,
		defaults: Readonly<Partial<T>>,
		change: ExtraChange,
	): ExtraHandle<T> {
		return {
			get: () => read(item.unknownData[SCHEMA_KEY]),
			set(patch, options) {
				guardWrite(item.canvas);
				const next = applyPatch(item.unknownData[SCHEMA_KEY], patch, shape, defaults);
				const { [SCHEMA_KEY]: _old, ...rest } = item.unknownData;
				item.unknownData = next ? { ...rest, [SCHEMA_KEY]: next } : rest;
				afterWrite(item.canvas, options);
				onChange(change);
			},
		};
	}

	return {
		isWritable,
		node: (node) => itemHandle(node, readNode, NODE_SHAPE, NODE_DEFAULTS, { node }),
		edge: (edge) => itemHandle(edge, readEdge, EDGE_SHAPE, EDGE_DEFAULTS, { edge }),
		root: (canvas) => ({
			get: () => {
				const { v: _v, ...rest } = readRoot(canvas.data[SCHEMA_KEY]) ?? { v: SCHEMA_VERSION };
				return rest;
			},
			set(patch, options) {
				guardWrite(canvas);
				const { v: _v, ...rootShape } = ROOT_SHAPE;
				const next = applyPatch<RootExtra>(canvas.data[SCHEMA_KEY], patch, rootShape as Shape<RootExtra>, ROOT_DEFAULTS);
				const { [SCHEMA_KEY]: _old, ...rest } = canvas.data;
				const { v: _ignored, ...content } = next ?? {};
				canvas.data = Object.keys(content).length > 0 ? { ...rest, [SCHEMA_KEY]: { ...content, v: SCHEMA_VERSION } } : rest;
				afterWrite(canvas, options);
				onChange({ root: canvas });
			},
		}),
	};
}
