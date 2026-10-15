/** Draws a free line (kind "line") as SVG inside its card, with arrowheads and end handles. */
import type { ArrowStyle, LineData } from "../../data/schema";
import type { CanvasNodeLike } from "../../internals/types";
import { ARROW_GEOMETRY } from "../edge-styles/geometry";

const ARROW_LENGTH = 10.4;

export interface LineHandlers {
	/** Pointerdown on the line itself (select / drag the card). */
	line(evt: PointerEvent): void;
	/** Pointerdown on an end handle. */
	end(evt: PointerEvent, end: "from" | "to"): void;
}

function child<K extends keyof SVGElementTagNameMap>(svg: SVGSVGElement, tag: K, cls: string): SVGElementTagNameMap[K] {
	let el = svg.querySelector<SVGElementTagNameMap[K]>(`:scope > .${cls}`);
	if (!el) {
		el = createSvg(tag);
		el.classList.add(cls);
		svg.appendChild(el);
	}
	return el;
}

/** Transform that puts an arrowhead (tip at origin, body along +y) at `tip`, pointing away from `prev`. */
function arrowTransform(tip: [number, number], prev: [number, number], scale: number): string {
	const dx = tip[0] - prev[0];
	const dy = tip[1] - prev[1];
	const angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
	return `translate(${tip[0]} ${tip[1]}) rotate(${angle}) scale(${scale})`;
}

/** Shortens the polyline end so a filled arrowhead covers it instead of poking through. */
function trim(points: [number, number][], atEnd: boolean, by: number): [number, number][] {
	if (by <= 0 || points.length < 2) return points;
	const out = points.slice();
	const i = atEnd ? out.length - 1 : 0;
	const j = atEnd ? out.length - 2 : 1;
	const [x, y] = out[i]!;
	const [px, py] = out[j]!;
	const len = Math.hypot(x - px, y - py);
	if (len <= by) return out;
	out[i] = [x + ((px - x) * by) / len, y + ((py - y) * by) / len];
	return out;
}

function renderArrow(svg: SVGSVGElement, cls: string, style: ArrowStyle | undefined, tip: [number, number], prev: [number, number], scale: number): void {
	const el = child(svg, "path", cls);
	if (!style || style === "none") {
		el.removeAttribute("d");
		return;
	}
	const g = ARROW_GEOMETRY[style];
	el.setAttribute("d", g.d);
	el.setAttribute("transform", arrowTransform(tip, prev, scale));
	el.classList.toggle("is-outline", !g.filled);
}

export function renderLine(node: CanvasNodeLike, line: LineData | null, strokeWidth: number, handlers: LineHandlers): void {
	let svg = node.nodeEl.querySelector<SVGSVGElement>(":scope > svg.opc-line");
	if (!line) {
		svg?.remove();
		if (node.nodeEl.getAttribute("data-opc-kind") === "line") node.nodeEl.removeAttribute("data-opc-kind");
		return;
	}
	node.nodeEl.setAttribute("data-opc-kind", "line");
	if (!svg) {
		svg = createSvg("svg");
		svg.classList.add("opc-line");
		node.nodeEl.insertBefore(svg, node.nodeEl.firstChild);
		const hit = child(svg, "path", "opc-line-hit");
		hit.addEventListener("pointerdown", (evt) => handlers.line(evt));
		child(svg, "path", "opc-line-path");
		child(svg, "path", "opc-line-arrow-start");
		child(svg, "path", "opc-line-arrow-end");
		for (const end of ["from", "to"] as const) {
			const h = child(svg, "circle", `opc-line-handle-${end}`);
			h.classList.add("opc-line-handle");
			h.addEventListener("pointerdown", (evt) => handlers.end(evt, end));
		}
	}
	svg.setAttribute("width", String(node.width));
	svg.setAttribute("height", String(node.height));
	svg.style.setProperty("--opc-line-width", `${strokeWidth}px`);

	let pts = line.points;
	const scale = Math.max(0.8, strokeWidth / 2);
	const filled = (s?: ArrowStyle) => !!s && s !== "none" && s !== "blunted" && s !== "thin-triangle";
	const drawn = trim(trim(pts, false, filled(line.startArrow) ? ARROW_LENGTH * scale * 0.6 : 0), true, filled(line.endArrow) ? ARROW_LENGTH * scale * 0.6 : 0);
	const d = "M" + drawn.map(([x, y]) => `${x} ${y}`).join(" L");
	child(svg, "path", "opc-line-path").setAttribute("d", d);
	child(svg, "path", "opc-line-hit").setAttribute("d", "M" + pts.map(([x, y]) => `${x} ${y}`).join(" L"));
	pts = line.points;
	const n = pts.length;
	renderArrow(svg, "opc-line-arrow-start", line.startArrow, pts[0]!, pts[1]!, scale);
	renderArrow(svg, "opc-line-arrow-end", line.endArrow, pts[n - 1]!, pts[n - 2]!, scale);
	for (const [end, p] of [["from", pts[0]!], ["to", pts[n - 1]!]] as const) {
		const h = child(svg, "circle", `opc-line-handle-${end}`);
		h.setAttribute("cx", String(p[0]));
		h.setAttribute("cy", String(p[1]));
		h.classList.toggle("is-attached", !!line[end]);
	}
}
