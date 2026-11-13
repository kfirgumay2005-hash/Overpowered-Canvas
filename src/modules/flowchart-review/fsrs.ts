/**
 * FSRS (Free Spaced Repetition Scheduler, version 5) for flowchart reviews. Pure, unit-tested.
 *
 * Memory model: stability S (days until recall falls to 90 %) and difficulty D (1–10).
 * Ratings: 1 again, 2 hard, 3 good, 4 easy. "Again" brings the chart back after 10 minutes;
 * the others schedule whole days at 90 % desired retention.
 */

export type Rating = 1 | 2 | 3 | 4;
export const RATINGS: readonly Rating[] = [1, 2, 3, 4];

export interface MemoryState {
	stability: number;
	difficulty: number;
	/** Reviews done. */
	reps: number;
	/** Times rated "again" after the first review. */
	lapses: number;
	/** Time of the last review (ms). */
	last: number;
	/** When it is due next (ms). */
	due: number;
}

/** Default FSRS-5 parameters. */
export const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621] as const;

const DECAY = -0.5;
const FACTOR = 19 / 81;
const RETENTION = 0.9;
const MAX_INTERVAL = 36500;
const DAY = 86_400_000;
export const AGAIN_DELAY = 10 * 60_000;

const w = (i: number) => W[i]!;
const clampD = (d: number) => Math.min(10, Math.max(1, d));

/** Probability of recall after `days` with stability `s`. */
export function retrievability(days: number, s: number): number {
	return Math.pow(1 + (FACTOR * Math.max(0, days)) / s, DECAY);
}

/** Days until recall falls to the desired retention. */
export function intervalDays(s: number): number {
	const days = (s / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1);
	return Math.min(MAX_INTERVAL, Math.max(1, Math.round(days)));
}

const initStability = (g: Rating) => Math.max(0.1, w(g - 1));
const initDifficulty = (g: Rating) => clampD(w(4) - Math.exp(w(5) * (g - 1)) + 1);

function nextDifficulty(d: number, g: Rating): number {
	const delta = -w(6) * (g - 3);
	const damped = d + (delta * (10 - d)) / 9;
	// Mean reversion toward the difficulty of a first "easy".
	return clampD(w(7) * (w(4) - Math.exp(w(5) * 3) + 1) + (1 - w(7)) * damped);
}

function recallStability(d: number, s: number, r: number, g: Rating): number {
	const hard = g === 2 ? w(15) : 1;
	const easy = g === 4 ? w(16) : 1;
	return s * (Math.exp(w(8)) * (11 - d) * Math.pow(s, -w(9)) * (Math.exp(w(10) * (1 - r)) - 1) * hard * easy + 1);
}

function forgetStability(d: number, s: number, r: number): number {
	const next = w(11) * Math.pow(d, -w(12)) * (Math.pow(s + 1, w(13)) - 1) * Math.exp(w(14) * (1 - r));
	return Math.min(next, s);
}

/** Reviewed again the same day: stability moves a little, by the rating. */
const shortTermStability = (s: number, g: Rating) => s * Math.exp(w(17) * (g - 3 + w(18)));

/** The state after rating a review at `now`; `prev` is null for a chart never reviewed. */
export function review(prev: MemoryState | null, g: Rating, now: number): MemoryState {
	let s: number;
	let d: number;
	if (!prev || prev.reps === 0) {
		s = initStability(g);
		d = initDifficulty(g);
	} else {
		const days = (now - prev.last) / DAY;
		d = nextDifficulty(prev.difficulty, g);
		if (days < 1) s = shortTermStability(prev.stability, g);
		else {
			const r = retrievability(days, prev.stability);
			s = g === 1 ? forgetStability(prev.difficulty, prev.stability, r) : recallStability(prev.difficulty, prev.stability, r, g);
		}
	}
	s = Math.max(0.1, s);
	const lapses = (prev?.lapses ?? 0) + (g === 1 && prev && prev.reps > 0 ? 1 : 0);
	return { stability: s, difficulty: d, reps: (prev?.reps ?? 0) + 1, lapses, last: now, due: now };
}

/**
 * What each rating would do now: the new state and its due time. Intervals keep their order
 * (hard ≤ good < easy, in whole days); "again" comes back after 10 minutes.
 */
export function preview(prev: MemoryState | null, now: number): Record<Rating, MemoryState> {
	const states = Object.fromEntries(RATINGS.map((g) => [g, review(prev, g, now)])) as Record<Rating, MemoryState>;
	let hard = intervalDays(states[2].stability);
	let good = intervalDays(states[3].stability);
	let easy = intervalDays(states[4].stability);
	hard = Math.min(hard, good);
	good = Math.max(good, hard + 1);
	easy = Math.max(easy, good + 1);
	states[1].due = now + AGAIN_DELAY;
	states[2].due = now + hard * DAY;
	states[3].due = now + good * DAY;
	states[4].due = now + easy * DAY;
	return states;
}

export type Span = { unit: "min" | "h" | "d" | "mo" | "y"; n: number };

/** A duration in the largest unit that fits (minutes, hours, days, months, years). */
export function span(ms: number): Span {
	const min = Math.max(1, Math.round(Math.abs(ms) / 60_000));
	if (min < 60) return { unit: "min", n: min };
	const h = Math.round(min / 60);
	if (h < 24) return { unit: "h", n: h };
	const d = Math.round(h / 24);
	if (d < 30) return { unit: "d", n: d };
	if (d < 365) return { unit: "mo", n: Math.round((d / 30) * 10) / 10 };
	return { unit: "y", n: Math.round((d / 365) * 10) / 10 };
}
