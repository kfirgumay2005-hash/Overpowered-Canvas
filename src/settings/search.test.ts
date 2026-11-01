import { describe, expect, it } from "vitest";
import { matches, normalize, queryWords } from "./search";

describe("settings search", () => {
	it("ignores case and accents", () => {
		expect(normalize("Café HOLD")).toBe("cafe hold");
		expect(queryWords("  Hold   TIME ")).toEqual(["hold", "time"]);
	});

	it("needs every word, in any of the texts", () => {
		expect(matches(["hold", "time"], "hold time")).toBe(true);
		expect(matches(["pages", "link"], "pages", "text of the link")).toBe(true);
		expect(matches(["hold", "time"], "hold")).toBe(false);
	});

	it("does not match text that is not there", () => {
		expect(matches(["hold"], "drag handle", "a handle appears beside the line")).toBe(false);
	});

	it("an empty query matches everything", () => {
		expect(matches(queryWords("   "), "")).toBe(true);
	});
});
