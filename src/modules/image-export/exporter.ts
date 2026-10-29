/**
 * Canvas → SVG (and PNG) without screen capture: the visible DOM of the exported cards and
 * edges is cloned into an SVG <foreignObject> together with the CSS rules it uses. Images and
 * the privacy font are inlined as data URLs so the SVG is self-contained.
 */
import { arrayBufferToBase64, requestUrl } from "obsidian";
import type { CanvasEdgeLike, CanvasLike, CanvasNodeLike } from "../../internals/types";
import { isHiddenNode, renderedZ } from "../shared";

export interface ExportOptions {
	scope: "all" | "selection";
	transparent: boolean;
	privacy: boolean;
	watermark: boolean;
	/** Pixel ratio for PNG. */
	scale: number;
	padding: number;
}

export interface ExportResult {
	svg: string;
	width: number;
	height: number;
}

const XHTML = "http://www.w3.org/1999/xhtml";
const MAX_SIDE = 16_000;

function itemsInScope(canvas: CanvasLike, scope: ExportOptions["scope"]): { nodes: CanvasNodeLike[]; edges: CanvasEdgeLike[] } {
	const all = [...canvas.nodes.values()].filter((n) => !isHiddenNode(n)).sort((a, b) => renderedZ(a) - renderedZ(b));
	const nodes = scope === "selection" ? all.filter((n) => canvas.selection.has(n)) : all;
	const set = new Set(nodes);
	const shown = new Set(all);
	const edges = [...canvas.edges.values()].filter(
		(e) => shown.has(e.from.node) && shown.has(e.to.node) && (scope === "all" || canvas.selection.has(e) || (set.has(e.from.node) && set.has(e.to.node))),
	);
	return { nodes, edges };
}

/** Makes sure every exported node has its content rendered (they may be virtualized away). */
async function mountContent(nodes: CanvasNodeLike[]): Promise<void> {
	for (const node of nodes) {
		node.render();
		if (!node.nodeEl.parentNode) node.canvas.canvasEl.appendChild(node.nodeEl);
		node.updateBreakpoint(true);
	}
	// Markdown renders asynchronously; give it a moment, then wait for images.
	await sleep(400);
	const images = nodes.flatMap((n) => [...n.nodeEl.querySelectorAll("img")]);
	await Promise.all(images.filter((img) => !img.complete).map((img) => new Promise((r) => { img.onload = img.onerror = r; window.setTimeout(r, 3000); })));
}

async function toDataUrl(url: string): Promise<string | null> {
	try {
		if (/^https?:/i.test(url)) {
			const res = await requestUrl({ url });
			const type = res.headers["content-type"] ?? "application/octet-stream";
			return `data:${type};base64,${arrayBufferToBase64(res.arrayBuffer)}`;
		}
		// Local resources (vault files, app fonts, blob: URLs) are not network requests.
		const blob = await (await activeWindow.fetch(url)).blob();
		return await new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result as string);
			reader.onerror = () => resolve(null);
			reader.readAsDataURL(blob);
		});
	} catch {
		return null;
	}
}

/** Replaces things a foreignObject cannot show (iframes, webviews, canvases) and inlines images. */
async function sanitizeClone(root: HTMLElement, originals: HTMLElement[]): Promise<void> {
	for (const el of [...root.querySelectorAll("iframe, webview, video, audio, object, embed")]) {
		const box = createDiv({ cls: "opc-export-placeholder", text: (el.getAttribute("src") ?? "").replace(/^app:\/\/[^/]+/, "") || "⧉" });
		el.replaceWith(box);
	}
	// <canvas> (PDF pages, charts): copy pixels from the original element.
	const liveCanvases = originals.flatMap((o) => [...o.querySelectorAll("canvas")]);
	[...root.querySelectorAll("canvas")].forEach((el, i) => {
		const live = liveCanvases[i];
		const img = createEl("img");
		try {
			if (live) img.src = live.toDataURL();
		} catch {
			// tainted
		}
		img.style.cssText = el.getAttribute("style") ?? "";
		el.replaceWith(img);
	});
	for (const img of [...root.querySelectorAll("img")]) {
		const src = img.getAttribute("src");
		if (src && !src.startsWith("data:")) {
			const data = await toDataUrl(src);
			if (data) img.setAttribute("src", data);
			else img.removeAttribute("src");
		}
		img.removeAttribute("srcset");
		img.removeAttribute("loading");
	}
	root.querySelectorAll(".is-selected, .is-focused, .is-opc-highlighted, .opc-search-match, .opc-search-current").forEach((el) => el.removeClasses(["is-selected", "is-focused", "is-opc-highlighted", "opc-search-match", "opc-search-current"]));
	root.querySelectorAll(".canvas-node-interaction-layer, .canvas-node-resizer, .canvas-node-connection-point, .collapse-indicator, .canvas-node-content-blocker").forEach((el) => el.remove());
}

/** `body`, `html` and `:root` in a selector → the export root (the clone has no real body). */
export function rewriteRootSelectors(selector: string): string {
	return selector.replace(/(^|[\s,>+~(])(body|html|:root)(?=$|[\s.#:[,>+~)])/g, "$1.opc-export-root");
}

/** CSS rules that apply to the cloned tree (variables on the root included). */
function collectCss(root: Element, doc: Document): string {
	const out: string[] = [];
	const matches = (selector: string) => {
		const cleaned = selector
			.replace(/::?(before|after|placeholder|selection|marker|first-line|first-letter|-webkit-[\w-]+)/g, "")
			.replace(/:(hover|active|focus|focus-visible|focus-within|visited)/g, "");
		if (!cleaned.trim()) return true;
		try {
			return root.matches(cleaned) || !!root.querySelector(cleaned);
		} catch {
			return false;
		}
	};
	const visit = (rules: CSSRuleList) => {
		for (const rule of Array.from(rules)) {
			if (rule instanceof CSSStyleRule) {
				const selector = rewriteRootSelectors(rule.selectorText);
				if (matches(selector)) out.push(`${selector} { ${rule.style.cssText} }`);
			} else if (rule instanceof CSSMediaRule) {
				out.push(`@media ${rule.conditionText} {`);
				visit(rule.cssRules);
				out.push("}");
			} else if (rule instanceof CSSSupportsRule) {
				out.push(`@supports ${rule.conditionText} {`);
				visit(rule.cssRules);
				out.push("}");
			} else if ("cssRules" in rule && rule.constructor.name === "CSSLayerBlockRule") {
				visit((rule as CSSGroupingRule).cssRules);
			}
		}
	};
	for (const sheet of Array.from(doc.styleSheets)) {
		try {
			visit(sheet.cssRules);
		} catch {
			// cross-origin sheet
		}
	}
	// Drop at-rule blocks that ended up empty.
	return out.join("\n").replace(/@(media|supports)[^{]*\{\s*\}/g, "");
}

async function privacyFontCss(doc: Document): Promise<string> {
	for (const sheet of Array.from(doc.styleSheets)) {
		let rules: CSSRuleList;
		try {
			rules = sheet.cssRules;
		} catch {
			continue;
		}
		for (const rule of Array.from(rules)) {
			if (rule instanceof CSSFontFaceRule && /Flow Circular/i.test(rule.style.getPropertyValue("font-family"))) {
				const m = /url\(["']?([^"')]+)["']?\)/.exec(rule.style.getPropertyValue("src"));
				const data = m?.[1] ? await toDataUrl(m[1]) : null;
				if (data) return `@font-face { font-family: "Flow Circular"; src: url("${data}"); }`;
			}
		}
	}
	return "";
}

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function exportCanvasSvg(canvas: CanvasLike, opts: ExportOptions, watermarkText: string): Promise<ExportResult | null> {
	const { nodes, edges } = itemsInScope(canvas, opts.scope);
	if (nodes.length === 0) return null;
	const doc = canvas.wrapperEl.doc;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const n of nodes) {
		minX = Math.min(minX, n.x);
		minY = Math.min(minY, n.y);
		maxX = Math.max(maxX, n.x + n.width);
		maxY = Math.max(maxY, n.y + n.height);
	}
	for (const e of edges) {
		const b = e.getBBox();
		minX = Math.min(minX, b.minX);
		minY = Math.min(minY, b.minY);
		maxX = Math.max(maxX, b.maxX);
		maxY = Math.max(maxY, b.maxY);
	}
	minX -= opts.padding;
	minY -= opts.padding;
	maxX += opts.padding;
	maxY += opts.padding + (opts.watermark ? 40 : 0);
	const width = Math.ceil(maxX - minX);
	const height = Math.ceil(maxY - minY);

	await mountContent(nodes);
	for (const e of edges) e.render();

	// Build the clone tree.
	const body = doc.createElementNS(XHTML, "div");
	body.className = `${doc.body.className} opc-export-root`;
	body.setAttribute("style", `${doc.body.getAttribute("style") ?? ""};margin:0;width:${width}px;height:${height}px;position:relative;overflow:hidden;background:transparent;`);
	const wrapper = body.appendChild(doc.createElementNS(XHTML, "div"));
	wrapper.className = `canvas-wrapper${opts.privacy ? " is-text-garbled" : ""}`;
	wrapper.setAttribute("style", `position:absolute;left:0;top:0;width:${width}px;height:${height}px;--zoom-multiplier:1;contain:none;overflow:visible;background-color:${opts.transparent ? "transparent" : "var(--canvas-background)"};`);
	const canvasEl = wrapper.appendChild(doc.createElementNS(XHTML, "div"));
	canvasEl.className = "canvas";
	canvasEl.setAttribute("style", `position:absolute;left:0;top:0;transform:translate(${-minX}px, ${-minY}px);transform-origin:0 0;`);

	const cloneSvg = (src: SVGSVGElement, groups: SVGGElement[]) => {
		const svg = src.cloneNode(false) as SVGSVGElement;
		for (const g of groups) svg.appendChild(g.cloneNode(true));
		canvasEl.appendChild(svg);
	};
	cloneSvg(canvas.edgeContainerEl, edges.map((e) => e.lineGroupEl));
	const sorted = [...nodes].sort((a, b) => renderedZ(a) - renderedZ(b));
	const originals: HTMLElement[] = [];
	for (const n of sorted) {
		const clone = n.nodeEl.cloneNode(true) as HTMLElement;
		clone.style.zIndex = String(renderedZ(n));
		canvasEl.appendChild(clone);
		originals.push(n.nodeEl);
	}
	cloneSvg(canvas.edgeEndContainerEl, edges.map((e) => e.lineEndGroupEl));
	for (const e of edges) if (e.labelElement) canvasEl.appendChild(e.labelElement.wrapperEl.cloneNode(true));

	if (opts.watermark) {
		const mark = body.appendChild(doc.createElementNS(XHTML, "div"));
		mark.className = "opc-export-watermark";
		mark.textContent = watermarkText;
	}

	// CSS must be collected against a live tree: attach the clone off-screen briefly.
	const holder = doc.body.createDiv({ attr: { style: "position:fixed;left:-100000px;top:0;pointer-events:none;" } });
	holder.appendChild(body);
	let css = "";
	try {
		await sanitizeClone(body, originals);
		css = collectCss(body, doc) + (opts.privacy ? await privacyFontCss(doc) : "");
	} finally {
		holder.remove();
	}
	css += `\n.opc-export-root .canvas-node { pointer-events: none; }
.opc-export-placeholder { display:flex; align-items:center; justify-content:center; width:100%; height:100%; color: var(--text-muted); font-size: 14px; background: var(--background-secondary); }
.opc-export-watermark { position:absolute; right:16px; bottom:10px; font: 600 14px var(--font-interface, sans-serif); color: var(--text-faint); letter-spacing: 0.02em; }`;

	// Restore the core's virtualization of what is outside the viewport.
	canvas.requestFrame();

	const xhtml = new XMLSerializer().serializeToString(body);
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${escapeXml(canvas.view.file?.basename ?? "Canvas")}</title><style>${css.replace(/<\/style/gi, "<\\/style")}</style><foreignObject x="0" y="0" width="${width}" height="${height}">${xhtml}</foreignObject></svg>`;
	return { svg, width, height };
}

export async function svgToPng(result: ExportResult, scale: number): Promise<Blob> {
	const s = Math.max(0.1, Math.min(scale, MAX_SIDE / result.width, MAX_SIDE / result.height));
	const img = new Image();
	// A data: URL, not a blob: URL — Chromium taints the canvas for blob-loaded foreignObject SVGs.
	img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`;
	{
		await img.decode();
		const canvas = createEl("canvas");
		canvas.width = Math.round(result.width * s);
		canvas.height = Math.round(result.height * s);
		const g = canvas.getContext("2d");
		if (!g) throw new Error("No 2D context");
		g.scale(s, s);
		g.drawImage(img, 0, 0);
		return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"));
	}
}

function sleep(ms: number) {
	return new Promise((r) => window.setTimeout(r, ms));
}
