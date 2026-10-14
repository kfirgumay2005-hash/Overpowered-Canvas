import { describe, expect, it } from "vitest";
import { freeSlot, GRID_GAP, GROUP_PAD } from "./grid";

describe("grid slots", () => {
	const group = { x: 0, y: 0, width: 2 * GROUP_PAD + 2 * 100 + GRID_GAP, height: 300 };

	it("fills rows in reading order", () => {
		expect(freeSlot(group, [], 100, 50)).toEqual({ x: GROUP_PAD, y: GROUP_PAD, grow: 0 });
		const first = { x: GROUP_PAD, y: GROUP_PAD, width: 100, height: 50 };
		expect(freeSlot(group, [first], 100, 50)).toEqual({ x: GROUP_PAD + 100 + GRID_GAP, y: GROUP_PAD, grow: 0 });
	});

	it("mirrors for RTL", () => {
		expect(freeSlot(group, [], 100, 50, true).x).toBe(group.width - GROUP_PAD - 100);
	});

	it("reports how much the group must grow", () => {
		const small = { x: 0, y: 0, width: 160, height: 100 };
		const taken = { x: GROUP_PAD, y: GROUP_PAD, width: 100, height: 50 };
		const slot = freeSlot(small, [taken], 100, 50);
		expect(slot.y).toBe(GROUP_PAD + 50 + GRID_GAP);
		expect(slot.grow).toBe(slot.y + 50 + GROUP_PAD - 100);
	});
});
