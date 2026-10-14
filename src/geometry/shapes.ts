/**
 * SVG outlines for node shapes, in node-local coordinates (0,0)–(w,h).
 * Pure functions — unit-tested. Used by the node-shapes module (flowchart shapes on regular
 * cards) and by standalone shapes.
 */
import type { ShapeName } from "../data/schema";

/** Fractions of the width/height kept free so text sits inside the outline. */
export interface ShapeInsets {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

export interface ShapeGeometry {
	/** Filled outline. */
	d: string;
	/** Extra strokes drawn on top without fill (cylinder rim, process bars…). */
	decoration?: string;
	insets: ShapeInsets;
}

const r = (n: number) => Math.round(n * 100) / 100;
const pts = (list: [number, number][]) => `M${list.map(([x, y]) => `${r(x)},${r(y)}`).join(" L")} Z`;
const NONE: ShapeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function roundedRect(w: number, h: number, radius: number): string {
	const rad = Math.max(0, Math.min(radius, w / 2, h / 2));
	if (rad === 0) return pts([[0, 0], [w, 0], [w, h], [0, h]]);
	return [
		`M${r(rad)},0 L${r(w - rad)},0`,
		`A${r(rad)},${r(rad)} 0 0 1 ${r(w)},${r(rad)}`,
		`L${r(w)},${r(h - rad)}`,
		`A${r(rad)},${r(rad)} 0 0 1 ${r(w - rad)},${r(h)}`,
		`L${r(rad)},${r(h)}`,
		`A${r(rad)},${r(rad)} 0 0 1 0,${r(h - rad)}`,
		`L0,${r(rad)}`,
		`A${r(rad)},${r(rad)} 0 0 1 ${r(rad)},0 Z`,
	].join(" ");
}

function ellipse(w: number, h: number): string {
	const rx = w / 2;
	const ry = h / 2;
	return `M0,${r(ry)} A${r(rx)},${r(ry)} 0 1 1 ${r(w)},${r(ry)} A${r(rx)},${r(ry)} 0 1 1 0,${r(ry)} Z`;
}

/** Regular polygon with `n` corners, stretched to the box. `rotation` in radians. */
function polygon(w: number, h: number, n: number, rotation: number): string {
	const list: [number, number][] = [];
	for (let i = 0; i < n; i++) {
		const a = rotation + (i * 2 * Math.PI) / n;
		list.push([w / 2 + (Math.cos(a) * w) / 2, h / 2 + (Math.sin(a) * h) / 2]);
	}
	return pts(list);
}

function star(w: number, h: number, points = 5, inner = 0.45): string {
	const list: [number, number][] = [];
	for (let i = 0; i < points * 2; i++) {
		const a = -Math.PI / 2 + (i * Math.PI) / points;
		const k = i % 2 === 0 ? 1 : inner;
		list.push([w / 2 + (Math.cos(a) * w * k) / 2, h / 2 + (Math.sin(a) * h * k) / 2 + h * 0.05 * (1 - k)]);
	}
	// Stretch vertically so the star touches top and bottom.
	const ys = list.map(([, y]) => y);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	return pts(list.map(([x, y]) => [x, ((y - minY) / (maxY - minY || 1)) * h]));
}

function blockArrow(w: number, h: number, dir: "left" | "right" | "up" | "down" | "double"): string {
	if (dir === "double") {
		const head = Math.min(w * 0.3, h);
		return pts([[0, h / 2], [head, 0], [head, h * 0.25], [w - head, h * 0.25], [w - head, 0], [w, h / 2], [w - head, h], [w - head, h * 0.75], [head, h * 0.75], [head, h]]);
	}
	const horizontal = dir === "left" || dir === "right";
	const L = horizontal ? w : h;
	const T = horizontal ? h : w;
	const head = Math.min(L * 0.45, T);
	// Arrow pointing to +x in (L × T) space, then mapped.
	const base: [number, number][] = [[0, T * 0.25], [L - head, T * 0.25], [L - head, 0], [L, T / 2], [L - head, T], [L - head, T * 0.75], [0, T * 0.75]];
	const map = ([a, b]: [number, number]): [number, number] => {
		switch (dir) {
			case "right":
				return [a, b];
			case "left":
				return [L - a, b];
			case "down":
				return [b, a];
			case "up":
				return [b, L - a];
		}
	};
	return pts(base.map(map));
}

function heart(w: number, h: number): string {
	return [
		`M${r(w / 2)},${r(h)}`,
		`C${r(w * 0.1)},${r(h * 0.7)} 0,${r(h * 0.45)} 0,${r(h * 0.28)}`,
		`C0,${r(h * 0.08)} ${r(w * 0.18)},0 ${r(w * 0.3)},0`,
		`C${r(w * 0.4)},0 ${r(w * 0.47)},${r(h * 0.06)} ${r(w / 2)},${r(h * 0.15)}`,
		`C${r(w * 0.53)},${r(h * 0.06)} ${r(w * 0.6)},0 ${r(w * 0.7)},0`,
		`C${r(w * 0.82)},0 ${r(w)},${r(h * 0.08)} ${r(w)},${r(h * 0.28)}`,
		`C${r(w)},${r(h * 0.45)} ${r(w * 0.9)},${r(h * 0.7)} ${r(w / 2)},${r(h)} Z`,
	].join(" ");
}

function cloud(w: number, h: number): string {
	const p = (x: number, y: number) => `${r(x * w)},${r(y * h)}`;
	return [
		`M${p(0.25, 0.85)}`,
		`C${p(0.08, 0.85)} ${p(0, 0.72)} ${p(0.02, 0.6)}`,
		`C${p(0.03, 0.47)} ${p(0.12, 0.4)} ${p(0.2, 0.4)}`,
		`C${p(0.18, 0.22)} ${p(0.32, 0.08)} ${p(0.48, 0.12)}`,
		`C${p(0.56, 0.0)} ${p(0.78, 0.02)} ${p(0.82, 0.22)}`,
		`C${p(0.95, 0.24)} ${p(1, 0.38)} ${p(0.98, 0.5)}`,
		`C${p(1, 0.66)} ${p(0.92, 0.85)} ${p(0.75, 0.85)}`,
		"Z",
	].join(" ");
}

function speechBubble(w: number, h: number): string {
	const bh = h * 0.8;
	const rad = Math.min(w, bh) * 0.15;
	return [
		`M${r(rad)},0 L${r(w - rad)},0`,
		`A${r(rad)},${r(rad)} 0 0 1 ${r(w)},${r(rad)}`,
		`L${r(w)},${r(bh - rad)}`,
		`A${r(rad)},${r(rad)} 0 0 1 ${r(w - rad)},${r(bh)}`,
		`L${r(w * 0.4)},${r(bh)} L${r(w * 0.15)},${r(h)} L${r(w * 0.22)},${r(bh)}`,
		`L${r(rad)},${r(bh)}`,
		`A${r(rad)},${r(rad)} 0 0 1 0,${r(bh - rad)}`,
		`L0,${r(rad)}`,
		`A${r(rad)},${r(rad)} 0 0 1 ${r(rad)},0 Z`,
	].join(" ");
}

function callout(w: number, h: number): string {
	const bh = h * 0.8;
	return pts([[0, 0], [w, 0], [w, bh], [w * 0.6, bh], [w / 2, h], [w * 0.4, bh], [0, bh]]);
}

function documentShape(w: number, h: number): string {
	const wave = h * 0.1;
	return `M0,0 L${r(w)},0 L${r(w)},${r(h - wave)} C${r(w * 0.75)},${r(h - wave * 2.2)} ${r(w * 0.5)},${r(h)} ${r(w * 0.25)},${r(h - wave * 0.4)} C${r(w * 0.12)},${r(h - wave * 0.9)} ${r(w * 0.05)},${r(h - wave)} 0,${r(h - wave)} Z`;
}

function cylinder(w: number, h: number): { d: string; decoration: string; ry: number } {
	const ry = Math.min(h * 0.12, w * 0.25);
	const rx = w / 2;
	const d = `M0,${r(ry)} A${r(rx)},${r(ry)} 0 0 1 ${r(w)},${r(ry)} L${r(w)},${r(h - ry)} A${r(rx)},${r(ry)} 0 0 1 0,${r(h - ry)} Z`;
	const decoration = `M0,${r(ry)} A${r(rx)},${r(ry)} 0 0 0 ${r(w)},${r(ry)}`;
	return { d, decoration, ry };
}

export function shapeGeometry(shape: ShapeName, width: number, height: number): ShapeGeometry {
	const w = Math.max(1, width);
	const h = Math.max(1, height);
	switch (shape) {
		case "rectangle":
		case "process":
			return { d: pts([[0, 0], [w, 0], [w, h], [0, h]]), insets: NONE };
		case "rounded-rectangle":
			return { d: roundedRect(w, h, Math.min(w, h) * 0.15), insets: NONE };
		case "terminal":
			return { d: roundedRect(w, h, h / 2), insets: { top: 0, right: 0.08, bottom: 0, left: 0.08 } };
		case "pill":
			return { d: roundedRect(w, h, Math.min(w, h) / 2), insets: { top: 0.05, right: 0.12, bottom: 0.05, left: 0.12 } };
		case "ellipse":
		case "on-page-reference":
			return { d: ellipse(w, h), insets: { top: 0.15, right: 0.15, bottom: 0.15, left: 0.15 } };
		case "decision":
		case "diamond":
			return { d: pts([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), insets: { top: 0.25, right: 0.25, bottom: 0.25, left: 0.25 } };
		case "triangle":
			return { d: pts([[w / 2, 0], [w, h], [0, h]]), insets: { top: 0.45, right: 0.22, bottom: 0.05, left: 0.22 } };
		case "input-output":
		case "parallelogram": {
			const s = Math.min(w * 0.2, h * 0.6);
			const f = s / w;
			return { d: pts([[s, 0], [w, 0], [w - s, h], [0, h]]), insets: { top: 0, right: f, bottom: 0, left: f } };
		}
		case "trapezoid": {
			const s = Math.min(w * 0.2, h * 0.6);
			return { d: pts([[s, 0], [w - s, 0], [w, h], [0, h]]), insets: { top: 0, right: s / w, bottom: 0, left: s / w } };
		}
		case "predefined-process": {
			const bar = Math.min(w * 0.1, 20);
			return {
				d: pts([[0, 0], [w, 0], [w, h], [0, h]]),
				decoration: `M${r(bar)},0 L${r(bar)},${r(h)} M${r(w - bar)},0 L${r(w - bar)},${r(h)}`,
				insets: { top: 0, right: bar / w, bottom: 0, left: bar / w },
			};
		}
		case "document":
			return { d: documentShape(w, h), insets: { top: 0, right: 0, bottom: 0.12, left: 0 } };
		case "database":
		case "cylinder": {
			const c = cylinder(w, h);
			return { d: c.d, decoration: c.decoration, insets: { top: (c.ry * 2) / h, right: 0, bottom: c.ry / h, left: 0 } };
		}
		case "pentagon":
			return { d: polygon(w, h, 5, -Math.PI / 2), insets: { top: 0.2, right: 0.18, bottom: 0.1, left: 0.18 } };
		case "hexagon":
			return { d: pts([[w * 0.25, 0], [w * 0.75, 0], [w, h / 2], [w * 0.75, h], [w * 0.25, h], [0, h / 2]]), insets: { top: 0.05, right: 0.2, bottom: 0.05, left: 0.2 } };
		case "octagon": {
			const c = Math.min(w, h) * 0.29;
			return { d: pts([[c, 0], [w - c, 0], [w, c], [w, h - c], [w - c, h], [c, h], [0, h - c], [0, c]]), insets: { top: 0.05, right: 0.08, bottom: 0.05, left: 0.08 } };
		}
		case "star":
			return { d: star(w, h), insets: { top: 0.35, right: 0.3, bottom: 0.25, left: 0.3 } };
		case "cross": {
			const tx = w / 3;
			const ty = h / 3;
			return {
				d: pts([[tx, 0], [2 * tx, 0], [2 * tx, ty], [w, ty], [w, 2 * ty], [2 * tx, 2 * ty], [2 * tx, h], [tx, h], [tx, 2 * ty], [0, 2 * ty], [0, ty], [tx, ty]]),
				insets: { top: 0.33, right: 0.05, bottom: 0.33, left: 0.05 },
			};
		}
		case "heart":
			return { d: heart(w, h), insets: { top: 0.2, right: 0.22, bottom: 0.3, left: 0.22 } };
		case "cloud":
			return { d: cloud(w, h), insets: { top: 0.25, right: 0.15, bottom: 0.18, left: 0.15 } };
		case "speech-bubble":
			return { d: speechBubble(w, h), insets: { top: 0, right: 0, bottom: 0.2, left: 0 } };
		case "callout":
			return { d: callout(w, h), insets: { top: 0, right: 0, bottom: 0.2, left: 0 } };
		case "block-arrow-right":
			return { d: blockArrow(w, h, "right"), insets: { top: 0.25, right: 0.3, bottom: 0.25, left: 0.02 } };
		case "block-arrow-left":
			return { d: blockArrow(w, h, "left"), insets: { top: 0.25, right: 0.02, bottom: 0.25, left: 0.3 } };
		case "block-arrow-up":
			return { d: blockArrow(w, h, "up"), insets: { top: 0.3, right: 0.25, bottom: 0.02, left: 0.25 } };
		case "block-arrow-down":
			return { d: blockArrow(w, h, "down"), insets: { top: 0.02, right: 0.25, bottom: 0.3, left: 0.25 } };
		case "block-arrow-double":
			return { d: blockArrow(w, h, "double"), insets: { top: 0.25, right: 0.2, bottom: 0.25, left: 0.2 } };
	}
}

/** All numeric coordinates appearing in a path (for tests and bounds checks). */
export function pathNumbers(d: string): number[] {
	return (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
}
