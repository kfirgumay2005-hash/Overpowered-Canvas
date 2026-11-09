import { describe, expect, it } from "vitest";
import type { Stroke } from "../../data/schema";
import { canRecognize, drawingSvg, recognize, strokesForReading } from "./ink-tools";

const stroke = (id: string, pts: number[], extra: Partial<Stroke> = {}): Stroke => ({ id, tool: "pen", color: "#1e1e1e", size: 3, pts, ...extra });

describe("drawing embeds", () => {
	it("writes the strokes at their board places, in one SVG with its source", () => {
		const svg = drawingSvg(
			[
				{ id: "a", x: 100, y: 50, width: 40, height: 20, strokes: [stroke("s1", [0, 0, 0.5, 30, 10, 0.5])] },
				{ id: "b", x: 200, y: 90, width: 40, height: 20, strokes: [stroke("s2", [0, 0, 0.5, 20, 5, 0.5], { tool: "highlighter", color: "#ffd43b" })] },
			],
			"Maps/Bio.canvas",
		);
		expect(svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="156" height="76"/);
		expect(svg).toContain('<g transform="translate(8 8)">');
		expect(svg).toContain('<g transform="translate(108 48)">');
		expect(svg).toContain('fill="#ffd43b" fill-opacity="0.35"');
		expect(svg).toContain("Maps/Bio.canvas");
		expect(svg).toContain("prefers-color-scheme: dark");
	});
});

describe("reading handwriting", () => {
	it("orders strokes by line, then along the line (mirrored right to left)", () => {
		const d = [
			{ x: 0, y: 100, strokes: [stroke("second-line", [0, 0, 0.5])] },
			{ x: 300, y: 0, strokes: [stroke("right", [0, 0, 0.5])] },
			{ x: 0, y: 5, strokes: [stroke("left", [0, 0, 0.5])] },
		];
		expect(strokesForReading(d, false).map((s) => s[0]!.x + "," + s[0]!.y)).toEqual(["0,5", "300,0", "0,100"]);
		expect(strokesForReading(d, true).map((s) => s[0]!.x + "," + s[0]!.y)).toEqual(["300,0", "0,5", "0,100"]);
	});
	it("feeds the strokes to the browser's recognizer and returns its best guess", async () => {
		const added: { x: number; y: number }[][] = [];
		class FakeStroke {
			pts: { x: number; y: number }[] = [];
			addPoint(p: { x: number; y: number }) {
				this.pts.push(p);
			}
		}
		const win = {
			HandwritingStroke: FakeStroke,
			navigator: {
				createHandwritingRecognizer: async () => ({
					startDrawing: () => ({ addStroke: (s: FakeStroke) => added.push(s.pts), getPrediction: async () => [{ text: "hello" }, { text: "hallo" }] }),
					finish: () => undefined,
				}),
			},
		} as unknown as Window;
		expect(canRecognize(win)).toBe(true);
		expect(await recognize(win, [[{ x: 1, y: 2 }], [{ x: 3, y: 4 }]], "en")).toBe("hello");
		expect(added).toHaveLength(2);
		expect(canRecognize({ navigator: {} } as unknown as Window)).toBe(false);
	});
});
