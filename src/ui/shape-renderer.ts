/**
 * Insets are stored as unitless fractions in --opc-inset-*; CSS multiplies them with the
 * --canvas-node-width/height properties Obsidian sets on every node.
 *
 * Draws a shape outline (SVG) behind a node's content. The node container becomes transparent
 * through CSS keyed on [data-opc-shape]; the SVG takes over fill, stroke and selection outline.
 */
import type { ShapeName } from "../data/schema";
import { shapeGeometry } from "../geometry/shapes";
import type { CanvasNodeLike } from "../internals/types";

const SVG_NS = "http://www.w3.org/2000/svg";
const CLASS = "opc-shape";

export function shapePreviewSvg(shape: ShapeName, w = 22, h = 16): string {
	const g = shapeGeometry(shape, w, h);
	return `<svg class="opc-shape-preview" viewBox="-1 -1 ${w + 2} ${h + 2}" width="${w + 2}" height="${h + 2}"><path d="${g.d}"/>${g.decoration ? `<path class="opc-decoration" d="${g.decoration}"/>` : ""}</svg>`;
}

/** Renders `shape` on the node, or removes our outline when `shape` is null. */
export function renderNodeShape(node: CanvasNodeLike, shape: ShapeName | null): void {
	const nodeEl = node.nodeEl;
	let svg = nodeEl.querySelector<SVGSVGElement>(`:scope > svg.${CLASS}`);
	if (!shape) {
		if (svg) svg.remove();
		if (nodeEl.hasAttribute("data-opc-shape")) {
			nodeEl.removeAttribute("data-opc-shape");
			for (const side of ["top", "right", "bottom", "left"]) nodeEl.style.removeProperty(`--opc-inset-${side}`);
		}
		return;
	}
	const w = Math.max(1, node.width);
	const h = Math.max(1, node.height);
	const key = `${shape}:${w}:${h}`;
	if (svg && svg.dataset.key === key && nodeEl.firstChild === svg) return;

	if (!svg) {
		svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
		svg.classList.add(CLASS);
		svg.setAttribute("aria-hidden", "true");
		svg.append(document.createElementNS(SVG_NS, "path"), document.createElementNS(SVG_NS, "path"));
		(svg.firstChild as SVGPathElement).classList.add("opc-shape-body");
		(svg.lastChild as SVGPathElement).classList.add("opc-shape-decoration");
	}
	if (nodeEl.firstChild !== svg) nodeEl.insertBefore(svg, nodeEl.firstChild);
	const g = shapeGeometry(shape, w, h);
	svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
	svg.setAttribute("width", String(w));
	svg.setAttribute("height", String(h));
	(svg.firstChild as SVGPathElement).setAttribute("d", g.d);
	(svg.lastChild as SVGPathElement).setAttribute("d", g.decoration ?? "");
	svg.dataset.key = key;
	nodeEl.setAttribute("data-opc-shape", shape);
	nodeEl.style.setProperty("--opc-inset-top", g.insets.top.toFixed(3));
	nodeEl.style.setProperty("--opc-inset-right", g.insets.right.toFixed(3));
	nodeEl.style.setProperty("--opc-inset-bottom", g.insets.bottom.toFixed(3));
	nodeEl.style.setProperty("--opc-inset-left", g.insets.left.toFixed(3));
}
