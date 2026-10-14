// Pure z-order arithmetic (unit-tested). Items are drawn in ascending z.

export interface ZItem {
	id: string;
	z: number;
}

export type ZOperation = "front" | "back" | "forward" | "backward";

/**
 * New z values for the moved items. `targets` are moved together; `overlapping(id)` lists the
 * ids whose area overlaps an item (forward/backward only step past items that actually overlap,
 * like most whiteboards). Returns only the items whose z changes.
 */
export function reorder(items: ZItem[], targets: Set<string>, op: ZOperation, overlapping: (id: string) => Set<string>): Map<string, number> {
	const out = new Map<string, number>();
	const sorted = [...items].sort((a, b) => a.z - b.z);
	const maxZ = sorted.length ? sorted[sorted.length - 1]!.z : 0;
	const minZ = sorted.length ? sorted[0]!.z : 0;
	const moving = sorted.filter((i) => targets.has(i.id));
	if (moving.length === 0) return out;

	if (op === "front") {
		moving.forEach((item, k) => out.set(item.id, maxZ + 1 + k));
		return out;
	}
	if (op === "back") {
		moving.forEach((item, k) => out.set(item.id, minZ - moving.length + k));
		return out;
	}

	// forward / backward: swap with the nearest overlapping non-target neighbor in that direction.
	const current = new Map(sorted.map((i) => [i.id, i.z]));
	const order = op === "forward" ? [...moving].reverse() : moving;
	for (const item of order) {
		const z = current.get(item.id)!;
		const near = overlapping(item.id);
		const candidates = sorted.filter((o) => !targets.has(o.id) && near.has(o.id) && (op === "forward" ? current.get(o.id)! > z : current.get(o.id)! < z));
		if (candidates.length === 0) continue;
		const neighbor = candidates.reduce((best, o) =>
			op === "forward" ? (current.get(o.id)! < current.get(best.id)! ? o : best) : current.get(o.id)! > current.get(best.id)! ? o : best,
		);
		const nz = current.get(neighbor.id)!;
		current.set(neighbor.id, z);
		current.set(item.id, nz);
		out.set(neighbor.id, z);
		out.set(item.id, nz);
	}
	return out;
}
