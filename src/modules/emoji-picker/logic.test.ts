import { describe, expect, it } from "vitest";
import data from "emoji-data";
import { addNames, appendEmoji, offsetOf, parseEmoji, pushRecent, searchEmoji, withTone } from "./logic";

const list = () => parseEmoji(data.core, data.en);

describe("parseEmoji", () => {
	it("reads emoji, groups, tones and names", () => {
		const l = list();
		expect(l.map((e) => e.char)).toEqual(["😀", "👍", "🐶", "🍕", "🇯🇵"]);
		expect(l[1]!.group).toBe(1);
		expect(l[1]!.tones).toHaveLength(5);
		expect(l[0]!.tones).toBeNull();
		expect(l[0]!.label).toBe("grinning face");
	});
});

describe("searchEmoji", () => {
	it("finds by name and keyword, best first", () => {
		const l = list();
		expect(searchEmoji(l, "pizza").map((e) => e.char)).toEqual(["🍕"]);
		expect(searchEmoji(l, "happy").map((e) => e.char)).toEqual(["😀"]);
		expect(searchEmoji(l, "face").map((e) => e.char)).toEqual(["😀", "🐶"]);
		expect(searchEmoji(l, "dog pet").map((e) => e.char)).toEqual(["🐶"]);
		expect(searchEmoji(l, "dog cheese")).toEqual([]);
		expect(searchEmoji(l, "")).toEqual([]);
	});
	it("finds by the emoji itself and in the UI language", () => {
		const l = list();
		expect(searchEmoji(l, "👍🏽").map((e) => e.char)).toEqual(["👍"]);
		addNames(l, ["笑顔\tにこにこ", "いいね\t", "犬\tペット", "ピザ\t", "日本\t旗"].join("\n"));
		expect(searchEmoji(l, "ピザ").map((e) => e.char)).toEqual(["🍕"]);
		expect(searchEmoji(l, "pizza").map((e) => e.char)).toEqual(["🍕"]);
	});
});

describe("tones, recent, insertion", () => {
	it("applies a skin tone only where there are tones", () => {
		const [smile, thumb] = list();
		expect(withTone(thumb!, 3)).toBe("👍🏽");
		expect(withTone(thumb!, 0)).toBe("👍");
		expect(withTone(smile!, 3)).toBe("😀");
	});
	it("keeps the recent list short and without duplicates", () => {
		expect(pushRecent(["😀", "🍕"], "🍕")).toEqual(["🍕", "😀"]);
		expect(pushRecent(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
	});
	it("adds an emoji at the end of a card's text with a space", () => {
		expect(appendEmoji("", "🍕")).toBe("🍕");
		expect(appendEmoji("Lunch", "🍕")).toBe("Lunch 🍕");
		expect(appendEmoji("Lunch\n", "🍕")).toBe("Lunch\n🍕");
	});
	it("turns an editor position into an offset", () => {
		expect(offsetOf("ab\ncde", { line: 1, ch: 2 })).toBe(5);
		expect(offsetOf("ab\ncde", { line: 0, ch: 9 })).toBe(2);
		expect(offsetOf("ab", { line: 5, ch: 1 })).toBe(1);
	});
});
