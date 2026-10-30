import { Component, MarkdownRenderer, Notice, TFile, setIcon } from "obsidian";
import { defineModule } from "../../core/module";
import type { CanvasNodeData } from "../../data/json-canvas";
import { embedRegistry, type EmbedContext } from "../../internals/app";
import type { CanvasLike, CanvasNodeLike, CanvasViewLike } from "../../internals/types";
import { pagesHost } from "../pages/api";
import { centerOn, selectedNodes } from "../shared";

/** "#abc123" → "abc123" for node subpaths; headings and blocks (#^…) are not node ids. */
export function nodeIdFromSubpath(subpath: string | undefined): string | null {
	if (!subpath || !subpath.startsWith("#") || subpath.startsWith("#^")) return null;
	const id = subpath.slice(1).trim();
	return /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

/** Embeds currently being rendered, to stop a node from embedding itself (directly or not). */
const rendering = new Set<string>();

class NodeEmbed extends Component {
	readonly containerEl: HTMLElement;

	constructor(
		private readonly ctx: EmbedContext,
		private readonly file: TFile,
		private readonly nodeId: string,
		private readonly labels: { notFound: string; open: string },
	) {
		super();
		this.containerEl = ctx.containerEl;
		this.containerEl.addClass("opc-node-embed");
	}

	async loadFile(): Promise<void> {
		const { app } = this.ctx;
		const el = this.containerEl;
		el.empty();
		let data: { nodes?: CanvasNodeData[] } = {};
		try {
			data = JSON.parse(await app.vault.cachedRead(this.file)) as { nodes?: CanvasNodeData[] };
		} catch {
			// handled as not found
		}
		const node = data.nodes?.find((n) => n.id === this.nodeId);
		const header = el.createDiv({ cls: "opc-node-embed-header" });
		setIcon(header.createSpan({ cls: "opc-node-embed-icon" }), "layout-dashboard");
		header.createSpan({ text: `${this.file.basename} › ${node ? labelOf(node) : this.nodeId}` });
		header.setAttr("aria-label", this.labels.open);
		header.addEventListener("click", (evt) => void app.workspace.openLinkText(`${this.file.path}#${this.nodeId}`, this.ctx.sourcePath, evt.ctrlKey || evt.metaKey));
		const body = el.createDiv({ cls: "opc-node-embed-content markdown-rendered" });
		if (!node) {
			body.createDiv({ cls: "opc-node-embed-missing", text: this.labels.notFound });
			return;
		}
		if (typeof node.color === "string" && node.color) el.style.setProperty("--opc-embed-color", /^\d+$/.test(node.color) ? `var(--canvas-color-${node.color})` : node.color);
		const key = `${this.file.path}#${this.nodeId}`;
		if (rendering.has(key)) {
			body.createDiv({ cls: "opc-node-embed-missing", text: "…" });
			return;
		}
		rendering.add(key);
		try {
			await renderNode(app, node, data.nodes ?? [], body, this.file.path, this);
		} finally {
			rendering.delete(key);
		}
	}
}

function labelOf(node: CanvasNodeData): string {
	if (node.type === "group") return node.label || "Group";
	if (node.type === "file" && typeof node.file === "string") return node.file.split("/").pop() ?? node.file;
	if (node.type === "link" && typeof node.url === "string") return node.url;
	const first = typeof node.text === "string" ? node.text.split("\n").find((l) => l.trim()) : "";
	return (first ?? "").replace(/^#+\s*/, "").replace(/[*_~`=]+/g, "").slice(0, 60) || node.id;
}

async function renderNode(app: EmbedContext["app"], node: CanvasNodeData, all: CanvasNodeData[], el: HTMLElement, sourcePath: string, owner: Component): Promise<void> {
	switch (node.type) {
		case "text":
			await MarkdownRenderer.render(app, String(node.text ?? ""), el, sourcePath, owner);
			return;
		case "file":
			await MarkdownRenderer.render(app, `![[${String(node.file ?? "")}${String(node.subpath ?? "")}]]`, el, sourcePath, owner);
			return;
		case "link":
			el.createEl("a", { cls: "external-link", href: String(node.url ?? ""), text: String(node.url ?? "") });
			return;
		case "group": {
			const inside = all.filter((n) => n.id !== node.id && n.type !== "group" && n.x >= node.x && n.y >= node.y && n.x + n.width <= node.x + node.width && n.y + n.height <= node.y + node.height);
			inside.sort((a, b) => a.y - b.y || a.x - b.x);
			for (const child of inside) await renderNode(app, child, all, el.createDiv({ cls: "opc-node-embed-child" }), sourcePath, owner);
			return;
		}
	}
}

function copyLink(canvas: CanvasLike, node: CanvasNodeLike, t: (k: "nodeLinks.copied") => string): void {
	const file = canvas.view.file;
	if (!file) return;
	const linktext = canvas.app.metadataCache.fileToLinktext(file, "", false);
	void navigator.clipboard.writeText(`[[${linktext}#${node.id}]]`);
	new Notice(t("nodeLinks.copied"));
}

/** A canvas loaded this recently has no zoom of its own yet: a link into it zooms to the card. */
const FRESH_MS = 1500;
/** The click on a link is still reaching the card that holds the link, which selects that card. */
const CLICK_SETTLES_MS = 50;

/**
 * Selects a node once it exists (the view may still be loading its file), on its own page. A view
 * in use keeps its zoom and only moves to the node.
 */
function revealNode(canvas: CanvasLike, id: string, fresh: () => boolean, tries = 20): void {
	const node = canvas.nodes.get(id);
	if (!node) {
		if (tries > 0) window.setTimeout(() => revealNode(canvas, id, fresh, tries - 1), 100);
		return;
	}
	pagesHost.api?.reveal(canvas, node);
	canvas.selectOnly(node);
	if (fresh()) canvas.zoomToBbox(node.getBBox());
	else centerOn(canvas, node);
}

/**
 * [[file.canvas#node-id]] opens the canvas zoomed to that node; ![[file.canvas#node-id]] renders
 * the node's content in notes. "Copy wikilink to node" puts such a link on the clipboard.
 */
export const nodeLinksModule = defineModule({
	id: "node-links",
	name: "nodeLinks.name",
	description: "nodeLinks.desc",
	group: "vault",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		// Links: the view receives the subpath as ephemeral state.
		let viewPatched = false;
		const loadedAt = new WeakMap<CanvasLike, number>();
		ctx.on("data-load", (canvas) => loadedAt.set(canvas, Date.now()));
		ctx.onCanvas((_canvas, view) => {
			if (viewPatched) return;
			viewPatched = true;
			ctx.patch("view.setEphemeralState", Object.getPrototypeOf(view) as CanvasViewLike & { setEphemeralState(state: unknown): void }, {
				setEphemeralState: (next) =>
					function (this: CanvasViewLike, state: { subpath?: string } | undefined) {
						next.call(this, state);
						const id = nodeIdFromSubpath(state?.subpath);
						if (!id) return;
						const canvas = this.canvas;
						window.setTimeout(() => revealNode(canvas, id, () => Date.now() - (loadedAt.get(canvas) ?? 0) < FRESH_MS), CLICK_SETTLES_MS);
					},
			});
		});

		// Embeds: wrap the core canvas embed for subpaths that name a node.
		const registry = embedRegistry(ctx.app);
		if (registry?.embedByExtension.canvas) {
			const labels = { notFound: ctx.t("nodeLinks.notFound"), open: ctx.t("nodeLinks.open") };
			ctx.patch("embedRegistry.canvas", registry.embedByExtension, {
				canvas: (next) =>
					function (this: unknown, embedCtx: EmbedContext, file: TFile, subpath: string) {
						const id = nodeIdFromSubpath(subpath);
						return id ? new NodeEmbed(embedCtx, file, id, labels) : next.call(this, embedCtx, file, subpath);
					},
			});
		}

		ctx.addCommand({
			id: "copy-node-link",
			name: ctx.t("nodeLinks.copy"),
			icon: "link",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				const nodes = canvas ? selectedNodes(canvas) : [];
				if (!canvas || nodes.length !== 1) return false;
				if (!checking) copyLink(canvas, nodes[0]!, ctx.t);
				return true;
			},
		});
		ctx.onNodeMenu((menu, node) => {
			if (node.canvas.selection.size === 1) menu.addItem((item) => item.setSection("action").setTitle(ctx.t("nodeLinks.copy")).setIcon("link").onClick(() => copyLink(node.canvas, node, ctx.t)));
		});
	},
});
