/**
 * Compares what was written in a card with the card's text (pure, unit-tested).
 * Case, punctuation, Markdown marks and spacing don't count; a few typos or a few missing words
 * make the answer "close" instead of wrong.
 */
import { plainCardText } from "./find";

export type Grade = "correct" | "close" | "wrong";

/** Lower case, no punctuation or Markdown marks, single spaces. Letters with marks keep them. */
export function normalizeAnswer(text: string): string {
	return plainCardText(text)
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[\p{P}\p{S}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function levenshtein(a: string, b: string): number {
	const x = [...a];
	const y = [...b];
	let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
	for (let i = 1; i <= x.length; i++) {
		const row = [i];
		for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
		prev = row;
	}
	return prev[y.length]!;
}

/** 0–1: how alike two normalized texts are, by letters. */
export function similarity(a: string, b: string): number {
	const len = Math.max([...a].length, [...b].length);
	return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
}

/** 0–1: the share of the expected words that were written (each word may have a typo). */
export function wordCover(answer: string, expected: string): number {
	const want = expected.split(" ").filter(Boolean);
	if (!want.length) return 1;
	const have = answer.split(" ").filter(Boolean);
	let hit = 0;
	for (const word of want) {
		const at = have.findIndex((h) => h === word || (word.length > 3 && similarity(h, word) >= 0.75));
		if (at >= 0) {
			hit++;
			have.splice(at, 1);
		}
	}
	return hit / want.length;
}

export function grade(answer: string, expected: string): Grade {
	const a = normalizeAnswer(answer);
	const e = normalizeAnswer(expected);
	if (a === e) return "correct";
	if (!a) return "wrong";
	if (similarity(a, e) >= 0.85) return "correct";
	if (similarity(a, e) >= 0.6 || wordCover(a, e) >= 0.5) return "close";
	return "wrong";
}
