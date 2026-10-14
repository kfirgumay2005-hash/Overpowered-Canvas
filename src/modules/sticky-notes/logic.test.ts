import { describe, expect, it } from "vitest";
import { fontBucket, nextStickyPos, STICKY_GAP } from "./logic";

describe("sticky notes", () => {
	it("shrinks the font as text grows", () => {
		expect(fontBucket("Hi", 200, 200)).toBe("xl");
		expect(fontBucket("A short idea for the board", 200, 200)).toBe("l");
		expect(fontBucket("x".repeat(80), 200, 200)).toBe("s");
		expect(fontBucket("x".repeat(400), 200, 200)).toBe("xs");
		expect(fontBucket("", 200, 200)).toBe("l");
	});

	it("places the next sticky beside the current one, skipping occupied spots", () => {
		const from = { x: 0, y: 0, width: 200, height: 200 };
		expect(nextStickyPos(from, "right", () => false)).toEqual({ x: 200 + STICKY_GAP, y: 0 });
		expect(nextStickyPos(from, "up", () => false)).toEqual({ x: 0, y: -(200 + STICKY_GAP) });
		let first = true;
		const once = () => {
			const hit = first;
			first = false;
			return hit;
		};
		expect(nextStickyPos(from, "left", once)).toEqual({ x: -2 * (200 + STICKY_GAP), y: 0 });
	});
});
