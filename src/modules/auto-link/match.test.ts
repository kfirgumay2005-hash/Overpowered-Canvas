import { describe, expect, it } from "vitest";
import { buildTrie, findTitles, linkPaths, linkText, protectedRanges, tableRanges, unlinkText, type Found, type LinkPlan, type Title } from "./match";

const titles = (...names: string[]): Title[] => names.map((n) => ({ phrase: n, target: `${n}.md` }));
const plan = (over: Partial<LinkPlan> = {}): LinkPlan => ({
	pick: (f: Found) => f.targets[0]!,
	render: (target, original, table) => {
		const name = target.replace(/\.md$/, "");
		return name === original ? `[[${name}]]` : `[[${name}${table ? "\\|" : "|"}${original}]]`;
	},
	firstOnly: false,
	linked: new Set(),
	note: false,
	...over,
});
const link = (text: string, names: string[], over?: Partial<LinkPlan>) => linkText(text, buildTrie(titles(...names)), plan(over)).text;

describe("matching", () => {
	it("links a phrase and keeps its visible text", () => {
		expect(link("causes of Left Ventricular Hypertrophy here", ["left ventricular hypertrophy"])).toBe("causes of [[left ventricular hypertrophy|Left Ventricular Hypertrophy]] here");
		expect(link("see Heart now", ["Heart"])).toBe("see [[Heart]] now");
	});

	it("needs whole words", () => {
		expect(link("hearty heartbeat sweetheart heart_rate heart2", ["heart"])).toBe("hearty heartbeat sweetheart heart_rate heart2");
		expect(link("(heart), heart. heart's", ["heart"])).toBe("([[heart]]), [[heart]]. [[heart]]'s");
	});

	it("handles right-to-left text and marks", () => {
		expect(link("על יתר לחץ דם כאן", ["לחץ דם"])).toBe("על יתר [[לחץ דם]] כאן");
		expect(link("בלחץ דם", ["לחץ דם"])).toBe("בלחץ דם");
	});

	it("handles Cyrillic words, and only their exact form", () => {
		expect(link("про Сердце тут", ["сердце"])).toBe("про [[сердце|Сердце]] тут");
		expect(link("сердцем и сердечный", ["сердце"])).toBe("сердцем и сердечный");
	});

	it("finds titles inside text written without spaces", () => {
		expect(link("这是高血压的原因", ["高血压"])).toBe("这是[[高血压]]的原因");
		expect(link("高血圧とは", ["高血圧"])).toBe("[[高血圧]]とは");
	});

	it("prefers the longest match, wherever it starts", () => {
		expect(link("left ventricular hypertrophy", ["hypertrophy", "left ventricular hypertrophy"])).toBe("[[left ventricular hypertrophy]]");
		expect(link("a b c d", ["a b", "b c d"])).toBe("a [[b c d]]");
	});

	it("falls back to a shorter title when the longer one ends inside a word", () => {
		expect(link("heart failures", ["heart", "heart failure"])).toBe("[[heart]] failures");
	});

	it("links only the first mention when asked, and not what is linked already", () => {
		expect(link("heart and heart", ["heart"], { firstOnly: true })).toBe("[[heart]] and heart");
		expect(link("heart again", ["heart"], { firstOnly: true, linked: new Set(["heart.md"]) })).toBe("heart again");
	});

	it("leaves a phrase alone when the plan refuses it (a self-link)", () => {
		expect(link("heart", ["heart"], { pick: () => null })).toBe("heart");
	});
});

describe("protected text", () => {
	const untouched = (text: string, note = false) => expect(link(text, ["heart"], { note })).toBe(text);

	it("skips links, embeds and Markdown links", () => {
		untouched("[[heart]] and [[other|heart]] and ![[heart.png]] and [heart](url) and ![heart](a.png) and [heart][ref]");
	});
	it("skips code", () => {
		untouched("`heart` and ``a ` heart``");
		untouched("```\nheart\n```");
		untouched("~~~js\nheart\n~~~");
		untouched("```\nheart never closed");
		untouched("> ```\n> heart\n> ```");
	});
	it("skips math, URLs, tags, comments and HTML", () => {
		untouched("$heart$ and $$\nheart\n$$");
		untouched("https://heart.org/heart and www.heart.org and me@heart.org");
		untouched("#heart and #a/heart");
		untouched("%%heart%% and <!-- heart --> and <div heart>");
		untouched("text ^heart");
	});
	it("skips front matter and headings in notes, not in cards", () => {
		untouched("---\ntitle: heart\n---\n", true);
		untouched("# heart\n## the heart", true);
		expect(link("# heart", ["heart"])).toBe("# [[heart]]");
	});
	it("still links beside protected text", () => {
		expect(link("`code` heart [[x]] heart", ["heart"])).toBe("`code` [[heart]] [[x]] [[heart]]");
	});
	it("does not treat dollar amounts as math", () => {
		expect(link("costs $5 for heart and $6", ["heart"])).toBe("costs $5 for [[heart]] and $6");
	});
	it("merges ranges", () => {
		expect(protectedRanges("`a` `b`", { note: false })).toEqual([[0, 3], [4, 7]]);
	});
	it("guards exactly the code, math and tags, wherever they start", () => {
		const guarded = (text: string) => protectedRanges(text, { note: false }).map((r) => text.slice(...r));
		expect(guarded("x `a` y")).toEqual(["`a`"]);
		expect(guarded("first\n`a`")).toEqual(["`a`"]);
		expect(guarded("x `` a`b `` y")).toEqual(["`` a`b ``"]);
		expect(guarded("x $a+b$ y")).toEqual(["$a+b$"]);
		expect(guarded("$a$\n$b$")).toEqual(["$a$", "$b$"]);
		expect(guarded("x \\$a$ y")).toEqual([]);
		expect(guarded("#one (#two)\n#three c#sharp")).toEqual(["#one", "#two", "#three"]);
	});
});

describe("the tutorial's practice card, in each language", () => {
	it.each([
		["Still to do: find a hotel, then book flights.", "Find a hotel", "Book flights", "Still to do: [[Find a hotel|find a hotel]], then [[Book flights|book flights]]."],
		["अभी बाकी: होटल ढूँढें, फिर उड़ान बुक करें।", "होटल ढूँढें", "उड़ान बुक करें", "अभी बाकी: [[होटल ढूँढें]], फिर [[उड़ान बुक करें]]।"],
		["まだやること: ホテルを探す、それから 航空券を予約。", "ホテルを探す", "航空券を予約", "まだやること: [[ホテルを探す]]、それから [[航空券を予約]]。"],
		["还要做: 找酒店,然后 订机票。", "找酒店", "订机票", "还要做: [[找酒店]],然后 [[订机票]]。"],
		["Ещё нужно: найти отель, затем забронировать рейсы.", "Найти отель", "Забронировать рейсы", "Ещё нужно: [[Найти отель|найти отель]], затем [[Забронировать рейсы|забронировать рейсы]]."],
	])("links both notes in %s", (text, hotel, tickets, linked) => {
		expect(link(text, [hotel, tickets])).toBe(linked);
	});
});

describe("tables", () => {
	it("escapes the pipe of a link in a table", () => {
		expect(link("| a |\n|---|\n| Heart |\n\nHeart", ["heart"])).toBe("| a |\n|---|\n| [[heart\\|Heart]] |\n\n[[heart|Heart]]");
	});
	it("finds the table's lines", () => {
		const text = "x\na | b\n--|--\n1 | 2\n\ny";
		const [range] = tableRanges(text);
		expect(text.slice(...range!)).toBe("a | b\n--|--\n1 | 2");
	});
});

describe("undo", () => {
	it("restores exactly what was linked", () => {
		const r = linkText("Heart and lung", buildTrie(titles("heart", "lung")), plan());
		expect(r.text).toBe("[[heart|Heart]] and [[lung]]");
		expect(unlinkText(r.text, r.created)).toEqual({ text: "Heart and lung", undone: 2 });
	});
	it("keeps later edits, and reports links that are gone", () => {
		expect(unlinkText("new text [[a|b]] more", [{ link: "[[a|b]]", text: "b" }, { link: "[[c]]", text: "c" }])).toEqual({ text: "new text b more", undone: 1 });
	});
});

describe("linkPaths", () => {
	it("lists link paths, not embeds", () => {
		expect(linkPaths("[[a]] [[b|c]] [[d#e]] [[f#^g|h]] ![[i]]")).toEqual(["a", "b", "d", "f"]);
	});
	it("finds links right after one another and at the start of a line", () => {
		expect(linkPaths("[[a]][[b]]\n[[c]]![[d]][[e]]")).toEqual(["a", "b", "c", "e"]);
	});
});

describe("findTitles", () => {
	it("returns the words as written", () => {
		const found = findTitles("the HEART", buildTrie(titles("heart")), []);
		expect(found).toMatchObject([{ start: 4, end: 9, text: "HEART", targets: ["heart.md"] }]);
	});
	it("keeps every file that has the same title", () => {
		const trie = buildTrie([{ phrase: "heart", target: "a/heart.md" }, { phrase: "Heart", target: "b/heart.md" }]);
		expect(findTitles("heart", trie, [])[0]!.targets).toEqual(["a/heart.md", "b/heart.md"]);
	});
});
