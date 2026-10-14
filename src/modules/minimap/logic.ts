/** Pure minimap math (unit-tested). */

export interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export interface MapTransform {
	scale: number;
	/** Screen position of world (0, 0). */
	ox: number;
	oy: number;
}

export function unionBox(boxes: Iterable<Box>): Box | null {
	let out: Box | null = null;
	for (const b of boxes) {
		if (!out) out = { ...b };
		else {
			out.minX = Math.min(out.minX, b.minX);
			out.minY = Math.min(out.minY, b.minY);
			out.maxX = Math.max(out.maxX, b.maxX);
			out.maxY = Math.max(out.maxY, b.maxY);
		}
	}
	return out;
}

/** Fits `world` into a `width`×`height` map with `pad` pixels of margin, centered. */
export function fitTransform(world: Box, width: number, height: number, pad: number): MapTransform {
	const ww = Math.max(1, world.maxX - world.minX);
	const wh = Math.max(1, world.maxY - world.minY);
	const scale = Math.min((width - 2 * pad) / ww, (height - 2 * pad) / wh);
	return {
		scale,
		ox: (width - ww * scale) / 2 - world.minX * scale,
		oy: (height - wh * scale) / 2 - world.minY * scale,
	};
}

export function toMap(t: MapTransform, x: number, y: number): { x: number; y: number } {
	return { x: x * t.scale + t.ox, y: y * t.scale + t.oy };
}

export function toWorld(t: MapTransform, x: number, y: number): { x: number; y: number } {
	return { x: (x - t.ox) / t.scale, y: (y - t.oy) / t.scale };
}

/** A canvas color ("1"–"6" preset or hex) as a CSS color, given the preset values. */
export function cssColor(color: string | undefined, presets: Record<string, string>): string | null {
	if (!color) return null;
	if (/^[1-6]$/.test(color)) {
		const v = presets[color]?.trim();
		if (!v) return null;
		return /^\d/.test(v) ? `rgb(${v})` : v;
	}
	return color;
}
