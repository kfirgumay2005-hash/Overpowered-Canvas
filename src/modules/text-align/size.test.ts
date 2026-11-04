import { describe, expect, it } from "vitest";
import { stepCardFont } from "./index";

describe("card text size steps", () => {
	it("goes to the next preset up or down", () => {
		expect(stepCardFont(16, 1)).toBe(18);
		expect(stepCardFont(16, -1)).toBe(14);
		expect(stepCardFont(17, 1)).toBe(18);
		expect(stepCardFont(17, -1)).toBe(16);
	});
	it("keeps stepping past the presets, within the limits", () => {
		expect(stepCardFont(48, 1)).toBe(50);
		expect(stepCardFont(12, -1)).toBe(10);
		expect(stepCardFont(6, -1)).toBe(6);
		expect(stepCardFont(200, 1)).toBe(200);
	});
});
