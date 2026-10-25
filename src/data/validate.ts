/**
 * Pure sanitizers for "x-opc" data. Reading never throws: invalid fields are dropped so modules
 * only ever see well-formed values. Writing (applyPatch) throws on invalid values, so a bug can
 * never put bad data into a canvas file.
 */
import {
	ARROW_STYLES,
	BORDER_STYLES,
	DIRECTIONS,
	EDGE_PATH_STYLES,
	EDGE_ROUTES,
	EDGE_SIDES,
	NODE_KINDS,
	SHAPES,
	STROKE_TOOLS,
	TEXT_ALIGNS,
	VERTICAL_ALIGNS,
	type Attach,
	type CropRect,
	type GuideData,
	type LayerInfo,
	type LineData,
	type OpcEdge,
	type OpcNode,
	type OpcRoot,
	type Point,
	type QuerySpec,
	type StickyData,
	type Stroke,
} from "./schema";

/** Returns the cleaned value, or undefined when the input is unusable. */
export type Sanitizer<T> = (raw: unknown) => T | undefined;
export type Shape<T> = { readonly [K in keyof T]-?: Sanitizer<NonNullable<T[K]>> };

export function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const proto = Object.getPrototypeOf(value) as unknown;
	return proto === Object.prototype || proto === null;
}

// ---------- primitives ----------

export const oneOf =
	<T extends string>(values: readonly T[]): Sanitizer<T> =>
	(raw) =>
		typeof raw === "string" && (values as readonly string[]).includes(raw) ? (raw as T) : undefined;

export const finite: Sanitizer<number> = (raw) => (typeof raw === "number" && Number.isFinite(raw) ? raw : undefined);

export const inRange =
	(min: number, max: number): Sanitizer<number> =>
	(raw) => {
		const n = finite(raw);
		return n !== undefined && n >= min && n <= max ? n : undefined;
	};

export const bool: Sanitizer<boolean> = (raw) => (typeof raw === "boolean" ? raw : undefined);
export const str: Sanitizer<string> = (raw) => (typeof raw === "string" ? raw : undefined);
export const nonEmptyStr: Sanitizer<string> = (raw) => (typeof raw === "string" && raw.length > 0 ? raw : undefined);

export const arrayOf =
	<T>(item: Sanitizer<T>, { min = 0, dropInvalid = true } = {}): Sanitizer<T[]> =>
	(raw) => {
		if (!Array.isArray(raw)) return undefined;
		const out: T[] = [];
		for (const entry of raw) {
			const clean = item(entry);
			if (clean === undefined) {
				if (!dropInvalid) return undefined;
				continue;
			}
			out.push(clean);
		}
		return out.length >= min ? out : undefined;
	};

export const recordOf =
	<T>(value: Sanitizer<T>): Sanitizer<Record<string, T>> =>
	(raw) => {
		if (!isPlainObject(raw)) return undefined;
		const out: Record<string, T> = {};
		for (const [k, v] of Object.entries(raw)) {
			const clean = value(v);
			if (clean !== undefined) out[k] = clean;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	};

/** Keeps only known, valid fields. Returns undefined when nothing valid remains. */
export const objectOf =
	<T extends object>(shape: Shape<T>, { required = [] as (keyof T)[] } = {}): Sanitizer<T> =>
	(raw) => {
		if (!isPlainObject(raw)) return undefined;
		const out: Record<string, unknown> = {};
		for (const key of Object.keys(shape) as (keyof T & string)[]) {
			if (!(key in raw)) continue;
			const clean = shape[key](raw[key]);
			if (clean !== undefined) out[key] = clean;
		}
		for (const key of required) if (!(key in out)) return undefined;
		return Object.keys(out).length > 0 ? (out as T) : undefined;
	};

/** Any JSON value (no NaN/Infinity, functions, cycles or class instances), up to a depth limit. */
export function isJsonSafe(value: unknown, depth = 32, seen = new Set<object>()): boolean {
	if (value === null) return true;
	switch (typeof value) {
		case "string":
		case "boolean":
			return true;
		case "number":
			return Number.isFinite(value);
		case "object": {
			if (depth <= 0 || seen.has(value)) return false;
			seen.add(value);
			const ok = Array.isArray(value)
				? value.every((v) => isJsonSafe(v, depth - 1, seen))
				: isPlainObject(value) && Object.values(value).every((v) => v === undefined || isJsonSafe(v, depth - 1, seen));
			seen.delete(value);
			return ok;
		}
		default:
			return false;
	}
}

export const jsonRecord: Sanitizer<Record<string, unknown>> = (raw) =>
	isPlainObject(raw) && isJsonSafe(raw) ? raw : undefined;

// ---------- schema pieces ----------

const point: Sanitizer<Point> = (raw) => {
	if (!Array.isArray(raw) || raw.length !== 2) return undefined;
	const x = finite(raw[0]);
	const y = finite(raw[1]);
	return x !== undefined && y !== undefined ? [x, y] : undefined;
};
export const points = arrayOf(point, { dropInvalid: false });

const attach = objectOf<Attach>({ node: nonEmptyStr, side: oneOf(EDGE_SIDES) }, { required: ["node"] });
const arrow = oneOf(ARROW_STYLES);

const line = objectOf<LineData>(
	{ points: arrayOf(point, { min: 2, dropInvalid: false }), from: attach, to: attach, startArrow: arrow, endArrow: arrow },
	{ required: ["points"] },
);

const sticky = objectOf<StickyData>({ author: str, created: finite, footer: bool });

const unit = inRange(0, 1);
const crop: Sanitizer<CropRect> = (raw) => {
	const c = objectOf<CropRect>({ x: unit, y: unit, w: unit, h: unit }, { required: ["x", "y", "w", "h"] })(raw);
	return c && c.w > 0 && c.h > 0 && c.x + c.w <= 1 + 1e-9 && c.y + c.h <= 1 + 1e-9 ? c : undefined;
};

const query = objectOf<QuerySpec>({
	tags: arrayOf(nonEmptyStr),
	folder: str,
	properties: arrayOf(objectOf<{ key: string; value?: string }>({ key: nonEmptyStr, value: str }, { required: ["key"] })),
	linksTo: arrayOf(nonEmptyStr),
	auto: bool,
});

/** Flat number arrays must hold whole tuples. */
const flatTuples =
	(tuple: number): Sanitizer<number[]> =>
	(raw) => {
		const arr = arrayOf(finite, { dropInvalid: false })(raw);
		return arr && arr.length % tuple === 0 ? arr : undefined;
	};

const stroke: Sanitizer<Stroke> = (raw) => {
	const s = objectOf<Stroke>(
		{
			id: nonEmptyStr,
			tool: oneOf(STROKE_TOOLS),
			color: nonEmptyStr,
			size: inRange(0.01, 10_000),
			opacity: unit,
			smoothing: unit,
			locked: bool,
			pts: flatTuples(3),
			tilt: flatTuples(2),
		},
		{ required: ["id", "tool", "color", "size", "pts"] },
	)(raw);
	if (!s) return undefined;
	if (s.tilt && s.tilt.length / 2 !== s.pts.length / 3) delete s.tilt;
	return s;
};

export const ROOT_SHAPE: Shape<OpcRoot> = {
	v: (raw) => {
		const n = finite(raw);
		return n !== undefined && Number.isInteger(n) && n >= 1 ? n : undefined;
	},
	frontmatter: jsonRecord,
	dir: oneOf(DIRECTIONS),
	presentation: objectOf<{ start?: string; last?: string }>({ start: nonEmptyStr, last: nonEmptyStr }),
	frameOrder: arrayOf(nonEmptyStr),
	layers: arrayOf(objectOf<LayerInfo>({ id: nonEmptyStr, name: str, hidden: bool, locked: bool }, { required: ["id", "name"] }), { min: 1 }),
	activeLayer: nonEmptyStr,
};

export const NODE_SHAPE: Shape<OpcNode> = {
	kind: oneOf(NODE_KINDS),
	shape: oneOf(SHAPES),
	border: oneOf(BORDER_STYLES),
	align: oneOf(TEXT_ALIGNS),
	valign: oneOf(VERTICAL_ALIGNS),
	dir: oneOf(DIRECTIONS),
	autoResize: bool,
	autoWidth: bool,
	locked: bool,
	breakpoint: finite,
	collapsed: bool,
	styles: recordOf(str),
	fill: nonEmptyStr,
	stroke: nonEmptyStr,
	strokeWidth: inRange(0, 1000),
	opacity: unit,
	rotation: inRange(-360, 360),
	line,
	sticky,
	crop,
	pdf: objectOf<{ pinned: boolean }>({ pinned: bool }, { required: ["pinned"] }),
	portal: objectOf<{ open: boolean }>({ open: bool }, { required: ["open"] }),
	kanban: objectOf<{ key: string; value: string }>({ key: nonEmptyStr, value: str }, { required: ["key", "value"] }),
	query,
	queryOwner: nonEmptyStr,
	strokes: arrayOf(stroke),
	guide: objectOf<GuideData>({ axis: oneOf(["h", "v"] as const), angle: inRange(0, 180), width: inRange(0.5, 200) }, { required: ["axis", "width"] }),
	layer: nonEmptyStr,
	slide: bool,
};

export const EDGE_SHAPE: Shape<OpcEdge> = {
	path: oneOf(EDGE_PATH_STYLES),
	arrows: objectOf<{ from?: (typeof ARROW_STYLES)[number]; to?: (typeof ARROW_STYLES)[number] }>({ from: arrow, to: arrow }),
	route: oneOf(EDGE_ROUTES),
	waypoints: arrayOf(point, { min: 1, dropInvalid: false }),
	labelT: unit,
	floating: objectOf<{ from?: boolean; to?: boolean }>({ from: bool, to: bool }),
	order: finite,
	portalTarget: objectOf<{ end: "from" | "to"; nodeId: string }>(
		{ end: oneOf(["from", "to"] as const), nodeId: nonEmptyStr },
		{ required: ["end", "nodeId"] },
	),
	styles: recordOf(str),
	auto: bool,
};

export const readRoot: Sanitizer<OpcRoot> = objectOf(ROOT_SHAPE, { required: ["v"] });
export const readNode = (raw: unknown): OpcNode => objectOf(NODE_SHAPE)(raw) ?? {};
export const readEdge = (raw: unknown): OpcEdge => objectOf(EDGE_SHAPE)(raw) ?? {};

export class InvalidExtraDataError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidExtraDataError";
	}
}

/**
 * Applies a patch to stored extra data without mutating it.
 * - `undefined` in the patch removes a field; values equal to `defaults` are removed too.
 * - Fields not in the patch (including ones this version doesn't know) are kept as-is.
 * - Throws InvalidExtraDataError on unknown fields or invalid values.
 * Returns undefined when nothing is left to store.
 */
export function applyPatch<T extends object>(
	existing: unknown,
	patch: Partial<T>,
	shape: Shape<T>,
	defaults: Readonly<Partial<T>> = {} as Readonly<Partial<T>>,
): Record<string, unknown> | undefined {
	const next: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};
	for (const [key, value] of Object.entries(patch)) {
		const sanitize = (shape as Record<string, Sanitizer<unknown> | undefined>)[key];
		if (!sanitize) throw new InvalidExtraDataError(`Unknown field "${key}"`);
		if (value === undefined) {
			delete next[key];
			continue;
		}
		const clean = sanitize(value);
		if (clean === undefined || !isJsonSafe(clean)) throw new InvalidExtraDataError(`Invalid value for "${key}": ${safeStringify(value)}`);
		if (Object.is(clean, (defaults as Record<string, unknown>)[key])) delete next[key];
		else next[key] = clean;
	}
	return Object.keys(next).length > 0 ? next : undefined;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value)?.slice(0, 200) ?? String(value);
	} catch {
		return String(value);
	}
}
