import { describe, expect, it } from "vitest";
import { shuffle } from "./review-modal";

describe("shuffle", () => {
	it("keeps every answer once and leaves the input alone", () => {
		const list = ["a", "b", "c", "d", "a"];
		const out = shuffle(list);
		expect([...out].sort()).toEqual([...list].sort());
		expect(list).toEqual(["a", "b", "c", "d", "a"]);
		expect(shuffle(["x", "y", "z"], () => 0)).toEqual(["y", "z", "x"]);
	});
});
