import { describe, expect, it } from "vitest";
import { chooseSides, type SideBox, type SideEdge } from "./sides";

const card = (id: string, x: number, y: number, width = 200, height = 60): SideBox => ({ id, x, y, width, height });
const edge = (id: string, from: string, to: string, extra: Partial<SideEdge> = {}): SideEdge => ({ id, from, to, fromSide: "bottom", toSide: "top", change: true, ...extra });

describe("choosing edge sides", () => {
	it("joins cards side by side on the sides facing each other", () => {
		const out = chooseSides([card("a", 0, 0), card("b", 400, 0)], [edge("e", "a", "b")]);
		expect(out.get("e")).toEqual({ fromSide: "right", toSide: "left", blocked: false });
	});

	it("leaves from the side, not the bottom, when a sibling sits below the parent", () => {
		// Root on the left; its far-down child would be reached through the bottom, which passes
		// under the card right below the root.
		const cards = [card("root", 0, 0), card("below", 0, 120), card("kid", 400, 400)];
		const out = chooseSides(cards, [edge("e", "root", "kid")]);
		expect(out.get("e")?.fromSide).not.toBe("bottom");
		expect(out.get("e")?.blocked).toBe(false);
	});

	it("avoids a card lying on the straight way between two cards", () => {
		const cards = [card("a", 0, 0), card("wall", 300, -10, 100, 80), card("b", 600, 0)];
		const out = chooseSides(cards, [edge("e", "a", "b", { fromSide: "right", toSide: "left" })]);
		const choice = out.get("e")!;
		expect(choice.blocked).toBe(false);
		expect([choice.fromSide, choice.toSide]).not.toEqual(["right", "left"]);
	});

	it("reports an edge that can't avoid the cards", () => {
		// b is boxed in by cards on all four sides.
		const cards = [card("a", -800, 0), card("b", 0, 0), card("l", -260, -100, 200, 260), card("r", 260, -100, 200, 260), card("t", -60, -200, 320, 140), card("d", -60, 120, 320, 140)];
		const out = chooseSides(cards, [edge("e", "a", "b")]);
		expect(out.get("e")?.blocked).toBe(true);
	});

	it("keeps sides that must not change and edges that are not re-arranged", () => {
		const cards = [card("a", 0, 0), card("b", 400, 0), card("c", 0, 300)];
		const out = chooseSides(cards, [edge("e", "a", "b", { keepFrom: true, fromSide: "top" }), edge("f", "a", "c", { change: false })]);
		expect(out.get("e")?.fromSide).toBe("top");
		expect(out.has("f")).toBe(false);
	});

	it("prefers the given sides when they cost the same", () => {
		const cards = [card("a", 0, 0, 100, 100), card("b", 300, 300, 100, 100)];
		const right = chooseSides(cards, [edge("e", "a", "b", { preferFrom: "right", preferTo: "left" })]).get("e")!;
		expect(right.blocked).toBe(false);
	});
});
