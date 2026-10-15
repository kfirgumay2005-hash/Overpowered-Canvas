import { getAllTags, Modal, Notice, setIcon, setTooltip, Setting, TFile, type App } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { SCHEMA_KEY, type QuerySpec } from "../../data/schema";
import { center, contains, freeSlot } from "../../geometry/grid";
import type { Translate } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { mergeWithDefaults } from "../../settings/settings";
import { canvasDirection, mutate, nodeType, randomId } from "../shared";
import { diffMembers, formatProperties, isEmptyQuery, matchesQuery, parseList, parseProperties, type NoteMeta } from "./logic";

/** Examples of what the query fields take (data, not prose). */
const EXAMPLE_TAGS = "project, work";
const EXAMPLE_PROPERTIES = "status: doing\nowner";

interface QuerySettings {
	cardWidth: number;
	cardHeight: number;
	/** Safety limit per refresh. */
	maxNotes: number;
}


const boxOf = (n: CanvasNodeLike) => ({ x: n.x, y: n.y, width: n.width, height: n.height });

class QueryModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly initial: QuerySpec,
		private readonly onSubmit: (q: QuerySpec) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { t } = this;
		this.setTitle(t("query.title"));
		this.contentEl.createEl("p", { cls: "setting-item-description", text: t("query.help") });
		let tags = (this.initial.tags ?? []).join(", ");
		let folder = this.initial.folder ?? "";
		let props = formatProperties(this.initial.properties);
		let links = (this.initial.linksTo ?? []).join(", ");
		let auto = !!this.initial.auto;
		new Setting(this.contentEl).setName(t("query.tags")).setDesc(t("query.tags.desc")).addText((x) => x.setPlaceholder(EXAMPLE_TAGS).setValue(tags).onChange((v) => (tags = v)));
		new Setting(this.contentEl).setName(t("query.folder")).addText((x) => x.setPlaceholder("Projects").setValue(folder).onChange((v) => (folder = v)));
		new Setting(this.contentEl)
			.setName(t("query.properties"))
			.setDesc(t("query.properties.desc"))
			.addTextArea((x) => x.setPlaceholder(EXAMPLE_PROPERTIES).setValue(props).onChange((v) => (props = v)));
		new Setting(this.contentEl).setName(t("query.links")).setDesc(t("query.links.desc")).addText((x) => x.setValue(links).onChange((v) => (links = v)));
		new Setting(this.contentEl).setName(t("query.auto")).setDesc(t("query.auto.desc")).addToggle((x) => x.setValue(auto).onChange((v) => (auto = v)));
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(t("common.apply"))
					.setCta()
					.onClick(() => {
						const q: QuerySpec = {};
						const tagList = parseList(tags);
						if (tagList.length) q.tags = tagList;
						if (folder.trim()) q.folder = folder.trim();
						const p = parseProperties(props);
						if (p.length) q.properties = p;
						const l = parseList(links);
						if (l.length) q.linksTo = l;
						if (auto) q.auto = true;
						if (isEmptyQuery(q)) {
							new Notice(t("query.empty"));
							return;
						}
						this.close();
						this.onSubmit(q);
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Query groups: a group defined by a filter (tags, folder, properties, links) fills itself
 * with note cards for the matching notes. Refresh adds new matches in a grid and removes
 * cards it added that no longer match; cards you add yourself are never removed.
 */
export const queryGroupsModule = defineModule<QuerySettings>({
	id: "query-groups",
	name: "query.name",
	description: "query.desc",
	group: "data",
	defaultEnabled: true,
	defaultSettings: { cardWidth: 300, cardHeight: 200, maxNotes: 200 },
	sanitizeSettings: (raw, defaults) => mergeWithDefaults(raw, defaults),

	enable(ctx) {
		const app = ctx.app;

		const notes = (): NoteMeta[] =>
			app.vault.getMarkdownFiles().map((file) => {
				const cache = app.metadataCache.getFileCache(file);
				return {
					path: file.path,
					tags: (cache ? (getAllTags(cache) ?? []) : []).map((t) => t.replace(/^#/, "")),
					frontmatter: (cache?.frontmatter ?? {}),
					links: Object.keys(app.metadataCache.resolvedLinks[file.path] ?? {}),
				};
			});

		const queryOf = (group: CanvasNodeLike) => (nodeType(group) === "group" ? ctx.data.node(group).get().query : undefined);

		/** Returns [added, removed], or null when nothing changed. */
		const refresh = (canvas: CanvasLike, group: CanvasNodeLike, all = notes()): [number, number] | null => {
			const q = queryOf(group);
			if (!q || canvas.readonly) return null;
			const matching = all.filter((n) => matchesQuery(n, q)).map((n) => n.path);
			const limited = matching.slice(0, ctx.settings.maxNotes);
			if (matching.length > limited.length) new Notice(ctx.t("query.limited", { count: ctx.settings.maxNotes }));
			const fileNodes = [...canvas.nodes.values()].filter((n): n is CanvasNodeLike & { file: TFile } => nodeType(n) === "file" && n.file instanceof TFile);
			const owned = fileNodes.filter((n) => (n.unknownData[SCHEMA_KEY] as { queryOwner?: string } | undefined)?.queryOwner === group.id);
			const inGroup = new Set(fileNodes.filter((n) => owned.includes(n) || contains(boxOf(group), center(boxOf(n)))).map((n) => n.file.path));
			const { add, remove } = diffMembers(
				owned.map((n) => n.file.path),
				limited,
				inGroup,
			);
			if (add.length === 0 && remove.length === 0) return null;
			const rtl = canvasDirection(canvas) === "rtl";
			mutate(ctx, canvas, () => {
				for (const n of owned) if (remove.includes(n.file.path)) canvas.removeNode(n);
				const box = boxOf(group);
				const occupied = [...canvas.nodes.values()].filter((n) => n !== group && nodeType(n) !== "group" && contains(box, center(boxOf(n)))).map(boxOf);
				let grow = 0;
				const created = [];
				for (const path of add) {
					const slot = freeSlot({ ...box, height: box.height + grow }, occupied, ctx.settings.cardWidth, ctx.settings.cardHeight, rtl);
					grow += slot.grow;
					const rect = { x: Math.round(slot.x), y: Math.round(slot.y), width: ctx.settings.cardWidth, height: ctx.settings.cardHeight };
					occupied.push(rect);
					created.push({ id: randomId(), type: "file", file: path, ...rect, [SCHEMA_KEY]: { queryOwner: group.id } });
				}
				if (grow > 0) group.moveAndResize({ ...box, height: box.height + grow });
				if (created.length) canvas.importData({ nodes: created, edges: [] }, false);
			});
			ctx.events.emit("query-group-refreshed", canvas, group, add.length, remove.length);
			return [add.length, remove.length];
		};

		const refreshAll = (canvas: CanvasLike, onlyAuto: boolean) => {
			const all = notes();
			let changed = 0;
			for (const g of [...canvas.nodes.values()]) {
				const q = queryOf(g);
				if (q && (!onlyAuto || q.auto) && refresh(canvas, g, all)) changed++;
			}
			return changed;
		};

		// Auto-refresh: when the canvas opens and after vault changes settle.
		ctx.on("data-load", (canvas) => window.setTimeout(() => refreshAll(canvas, true), 500));
		let timer = 0;
		ctx.registerEvent(
			app.metadataCache.on("resolved", () => {
				window.clearTimeout(timer);
				timer = window.setTimeout(() => ctx.canvases().forEach((c) => refreshAll(c, true)), 1500);
			}),
		);
		ctx.register(() => window.clearTimeout(timer));

		// Badge with the filter summary and a refresh button.
		ctx.decorateNodes({
			apply: (node, extra) => {
				let badge = node.nodeEl.querySelector<HTMLElement>(":scope > .opc-query-badge");
				if (!extra.query || nodeType(node) !== "group") return badge?.remove();
				if (!badge) {
					badge = node.nodeEl.createDiv({ cls: "opc-query-badge" });
					const icon = badge.createSpan({ cls: "opc-query-icon" });
					setIcon(icon, "search");
					badge.createSpan({ cls: "opc-query-text" });
					const btn = badge.createEl("button", { cls: "clickable-icon opc-query-refresh", attr: { "aria-label": ctx.t("query.refresh") } });
					setIcon(btn, "refresh-cw");
					setTooltip(btn, ctx.t("query.refresh"));
					btn.addEventListener("pointerdown", (e) => e.stopPropagation());
					btn.addEventListener("click", (e) => {
						e.stopPropagation();
						const r = refresh(node.canvas, node);
						new Notice(r ? ctx.t("query.refreshed", { added: r[0], removed: r[1] }) : ctx.t("query.upToDate"));
					});
				}
				const q = extra.query;
				const parts = [
					...(q.tags ?? []).map((t) => `#${t}`),
					...(q.folder ? [`${q.folder}/`] : []),
					...(q.properties ?? []).map((p) => (p.value ? `${p.key}: ${p.value}` : p.key)),
					...(q.linksTo ?? []).map((l) => `→ ${l}`),
				];
				badge.querySelector(".opc-query-text")!.setText(parts.join(" · ") + (q.auto ? " ⟳" : ""));
			},
			clear: (node) => node.nodeEl.querySelector(":scope > .opc-query-badge")?.remove(),
		});

		const edit = (canvas: CanvasLike, group: CanvasNodeLike) =>
			new QueryModal(app, ctx.t, queryOf(group) ?? {}, (query) => {
				mutate(ctx, canvas, () => ctx.data.node(group).set({ query }));
				refresh(canvas, group);
			}).open();

		ctx.onNodeMenu((menu, node) => {
			if (node.canvas.readonly || nodeType(node) !== "group") return;
			const q = queryOf(node);
			menu.addItem((item) => item.setTitle(ctx.t(q ? "query.edit" : "query.make")).setIcon("search").onClick(() => edit(node.canvas, node)));
			if (!q) return;
			menu.addItem((item) => item.setTitle(ctx.t("query.refresh")).setIcon("refresh-cw").onClick(() => refresh(node.canvas, node)));
			menu.addItem((item) =>
				item
					.setTitle(ctx.t("query.remove"))
					.setIcon("search-x")
					.onClick(() =>
						mutate(ctx, node.canvas, () => {
							ctx.data.node(node).set({ query: undefined });
							// Cards it added stay, as ordinary cards.
							for (const n of node.canvas.nodes.values())
								if ((n.unknownData[SCHEMA_KEY] as { queryOwner?: string } | undefined)?.queryOwner === node.id) ctx.data.node(n).set({ queryOwner: undefined });
						}),
					),
			);
		});
		ctx.addCommand({
			id: "refresh-all",
			name: ctx.t("query.refreshAll"),
			icon: "refresh-cw",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) new Notice(ctx.t("query.refreshedGroups", { count: refreshAll(canvas, false) }));
				return true;
			},
		});
	},

	renderSettings(el, ctx: ModuleContext<QuerySettings>) {
		new Setting(el)
			.setName(ctx.t("query.cardSize"))
			.addText((x) => x.setValue(String(ctx.settings.cardWidth)).onChange((v) => Number(v) >= 100 && ctx.updateSettings({ cardWidth: Math.round(Number(v)) })))
			.addText((x) => x.setValue(String(ctx.settings.cardHeight)).onChange((v) => Number(v) >= 60 && ctx.updateSettings({ cardHeight: Math.round(Number(v)) })));
		new Setting(el)
			.setName(ctx.t("query.max"))
			.addSlider((s) => s.setLimits(10, 1000, 10).setValue(ctx.settings.maxNotes).onChange((v) => ctx.updateSettings({ maxNotes: v })));
	},
});
