// Frame-time statistics for the pan/zoom benchmark. Pure, unit-tested.

export interface FrameStats {
	frames: number;
	avgFps: number;
	avgMs: number;
	medianMs: number;
	p95Ms: number;
	maxMs: number;
	/** Frames slower than 60 fps (> 16.7 ms, with 10% tolerance for vsync jitter). */
	slowFrames: number;
	/** Frames slower than 30 fps. */
	verySlowFrames: number;
}

const round = (n: number, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

export function percentile(sorted: readonly number[], p: number): number {
	if (sorted.length === 0) return 0;
	const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
	return sorted[index]!;
}

export function frameStats(frameTimesMs: readonly number[]): FrameStats {
	const times = frameTimesMs.filter((t) => Number.isFinite(t) && t > 0);
	if (times.length === 0) return { frames: 0, avgFps: 0, avgMs: 0, medianMs: 0, p95Ms: 0, maxMs: 0, slowFrames: 0, verySlowFrames: 0 };
	const sorted = [...times].sort((a, b) => a - b);
	const total = times.reduce((s, t) => s + t, 0);
	const avgMs = total / times.length;
	return {
		frames: times.length,
		avgFps: round(1000 / avgMs),
		avgMs: round(avgMs, 2),
		medianMs: round(percentile(sorted, 50), 2),
		p95Ms: round(percentile(sorted, 95), 2),
		maxMs: round(sorted[sorted.length - 1]!, 2),
		slowFrames: times.filter((t) => t > (1000 / 60) * 1.1).length,
		verySlowFrames: times.filter((t) => t > (1000 / 30) * 1.1).length,
	};
}

/**
 * Deterministic viewport path for frame i of n: two loops of a circle around the start point
 * while zoom oscillates, so every run exercises the same pan + zoom workload.
 */
export function benchmarkViewport(
	i: number,
	n: number,
	start: { x: number; y: number; zoom: number },
	radius = 1500,
): { x: number; y: number; zoom: number } {
	const t = n <= 1 ? 0 : i / (n - 1);
	const angle = t * Math.PI * 4;
	return {
		x: start.x + Math.cos(angle) * radius - radius,
		y: start.y + Math.sin(angle) * radius,
		zoom: start.zoom + Math.sin(t * Math.PI * 6) * 0.9 - 0.3,
	};
}
