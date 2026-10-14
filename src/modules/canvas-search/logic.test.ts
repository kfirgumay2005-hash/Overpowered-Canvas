import { describe, expect, it } from "vitest";
import { normalize, search, type Searchable } from "./logic";

const item = (id: string, text: string, x = 0, y = 0): Searchable => ({ id, kind: "node", text, x, y });

describe("normalize", () => {
	it("folds case, accents and Hebrew niqqud", () => {
		expect(normalize("Café ÉCOLE")).toBe("cafe ecole");
		expect(normalize("שָׁלוֹם")).toBe("שלום");
	});
});

describe("search", () => {
	const items = [item("a", "Project plan for Q3", 300, 0), item("b", "Weekly plan", 0, 10), item("c", "שָׁלוֹם עולם", 0, 200), item("d", "nothing")];

	it("matches all terms in any order", () => {
		expect(search(items, "plan").map((i) => i.id)).toEqual(["b", "a"]);
		expect(search(items, "q3 project").map((i) => i.id)).toEqual(["a"]);
		expect(search(items, "plan missing")).toEqual([]);
	});

	it("matches Hebrew without niqqud and sorts right-to-left in RTL", () => {
		expect(search(items, "שלום").map((i) => i.id)).toEqual(["c"]);
		expect(search(items, "plan", true).map((i) => i.id)).toEqual(["a", "b"]);
	});

	it("returns nothing for an empty query", () => {
		expect(search(items, "   ")).toEqual([]);
	});
});
