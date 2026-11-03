import { describe, expect, it } from "vitest";
import { parseFontSize, propertyKey, stepFontSize } from "./logic";

describe("font size property values", () => {
	it("reads pixels, points and shares of the vault size", () => {
		expect(parseFontSize(18, 16)).toBe(18);
		expect(parseFontSize("18", 16)).toBe(18);
		expect(parseFontSize("18px", 16)).toBe(18);
		expect(parseFontSize(" 12PT ", 16)).toBe(16);
		expect(parseFontSize("125%", 16)).toBe(20);
		expect(parseFontSize("1.5em", 16)).toBe(24);
		expect(parseFontSize("1.5rem", 16)).toBe(24);
		expect(parseFontSize("17.5", 16)).toBe(17.5);
	});
	it("ignores what isn't a size and keeps sizes readable", () => {
		for (const v of ["big", "", "-3", "0", null, undefined, true, [18], {}, Number.NaN]) expect(parseFontSize(v, 16)).toBeNull();
		expect(parseFontSize(2, 16)).toBe(6);
		expect(parseFontSize(500, 16)).toBe(96);
	});
});

describe("increase / decrease", () => {
	it("moves to the next whole step", () => {
		expect(stepFontSize(16, 1, 1)).toBe(17);
		expect(stepFontSize(16, 1, -1)).toBe(15);
		expect(stepFontSize(17, 2, 1)).toBe(18);
		expect(stepFontSize(17, 2, -1)).toBe(16);
		expect(stepFontSize(17.5, 1, 1)).toBe(18);
		expect(stepFontSize(6, 1, -1)).toBe(6);
		expect(stepFontSize(96, 1, 1)).toBe(96);
	});
	it("uses the default property when the setting is blank", () => {
		expect(propertyKey("  ", "font-size")).toBe("font-size");
		expect(propertyKey(" size ", "font-size")).toBe("size");
	});
});
