/** Draws the strokes of an ink carrier card as SVG paths under its node element. */
import type { Stroke } from "../../data/schema";
import { strokePath, unpack } from "../../geometry/ink";
import type { CanvasNodeLike } from "../../internals/types";

const pathCache = new WeakMap<Stroke, string>();

export function strokeD(s: Stroke): string {
	let d = pathCache.get(s);
	if (d === undefined) {
		d = strokePath(unpack(s.pts, s.tilt), s.tool, s.size, s.smoothing, s.uniform);
		pathCache.set(s, d);
	}
	return d;
}

export function renderInk(node: CanvasNodeLike, strokes: Stroke[] | undefined, selected: ReadonlySet<string>, onPointerDown: (evt: PointerEvent) => void): void {
	let svg = node.nodeEl.querySelector<SVGSVGElement>(":scope > svg.opc-ink");
	if (!strokes) {
		svg?.remove();
		node.nodeEl.removeAttribute("data-opc-kind");
		return;
	}
	node.nodeEl.setAttribute("data-opc-kind", "ink");
	if (!svg) {
		svg = createSvg("svg");
		svg.classList.add("opc-ink");
		svg.addEventListener("pointerdown", onPointerDown);
		node.nodeEl.insertBefore(svg, node.nodeEl.firstChild);
	}
	svg.setAttribute("width", String(node.width));
	svg.setAttribute("height", String(node.height));
	svg.setAttribute("viewBox", `0 0 ${node.width} ${node.height}`);
	const existing = new Map<string, SVGPathElement>();
	for (const p of Array.from(svg.children) as SVGPathElement[]) existing.set(p.dataset.id ?? "", p);
	const keep = new Set<string>();
	strokes.forEach((s, i) => {
		keep.add(s.id);
		let path = existing.get(s.id);
		if (!path) {
			path = createSvg("path");
			path.dataset.id = s.id;
		}
		// Keep document order = stroke order.
		if (svg.children[i] !== path) svg.insertBefore(path, svg.children[i] ?? null);
		const d = strokeD(s);
		if (path.getAttribute("d") !== d) path.setAttribute("d", d);
		path.setAttribute("fill", s.color);
		path.style.opacity = String(s.opacity ?? (s.tool === "highlighter" ? 0.35 : s.tool === "pencil" ? 0.85 : 1));
		path.classList.toggle("is-highlighter", s.tool === "highlighter");
		path.classList.toggle("is-selected", selected.has(s.id));
		path.classList.toggle("is-locked", !!s.locked);
	});
	for (const [id, el] of existing) if (!keep.has(id)) el.remove();
}
