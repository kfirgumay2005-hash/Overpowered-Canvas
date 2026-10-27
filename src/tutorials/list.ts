/**
 * The list of tutorials: cards with an icon, a summary, the step count and whether it's done.
 * Shown at the top of the settings tab and in a modal (command, canvas controls).
 */
import { Modal, setIcon, type App } from "obsidian";
import type { ModuleManager } from "../core/module-manager";
import type { Translate } from "../i18n";
import type { TutorialDefinition } from "./types";

export interface TutorialListHost {
	readonly app: App;
	readonly modules: ModuleManager;
	readonly catalog: readonly TutorialDefinition[];
	t(): Translate;
	isDone(id: string): boolean;
	/** Starts a tutorial (after the caller closed whatever showed the list). */
	start(def: TutorialDefinition): void;
	/** Ends the running tutorial, if any (its practice files are deleted). */
	stop(): Promise<void>;
}

export function renderTutorialList(el: HTMLElement, host: TutorialListHost, beforeStart: () => void = () => {}): void {
	const t = host.t();
	const done = host.catalog.filter((d) => host.isDone(d.id)).length;
	const head = el.createDiv({ cls: "opc-tutorials-progress" });
	head.createSpan({ text: t("tutorial.progress", { n: done, total: host.catalog.length }) });
	const bar = head.createDiv({ cls: "opc-tutorials-progress-bar" });
	bar.createDiv().setCssProps({ "--opc-progress": `${(done / host.catalog.length) * 100}%` });

	const grid = el.createDiv({ cls: "opc-tutorials-grid" });
	host.catalog.forEach((def, i) => {
		const finished = host.isDone(def.id);
		const item = grid.createEl("button", { cls: "opc-tutorials-card", attr: { "aria-label": t(def.title) } });
		item.toggleClass("is-done", finished);
		const top = item.createDiv({ cls: "opc-tutorials-card-top" });
		const icon = top.createDiv({ cls: "opc-tutorials-card-icon" });
		setIcon(icon, def.icon);
		top.createSpan({ cls: "opc-tutorials-card-number", text: String(i + 1) });
		if (finished) {
			const badge = top.createSpan({ cls: "opc-tutorials-card-badge" });
			setIcon(badge.createSpan(), "check");
			badge.createSpan({ text: t("tutorial.doneBadge") });
		}
		item.createDiv({ cls: "opc-tutorials-card-title", text: t(def.title) });
		item.createDiv({ cls: "opc-tutorials-card-summary", text: t(def.summary) });
		const foot = item.createDiv({ cls: "opc-tutorials-card-foot" });
		foot.createSpan({ text: t("tutorial.steps", { n: def.steps.length }) });
		const off = def.modules.filter((id) => host.modules.status(id) === "disabled").map((id) => {
			const m = host.modules.get(id);
			return m ? t(m.name) : id;
		});
		if (off.length > 0) foot.createSpan({ cls: "opc-tutorials-card-note", text: t("tutorial.turnsOn", { modules: off.join(", ") }) });
		const go = foot.createSpan({ cls: "opc-tutorials-card-go" });
		go.createSpan({ text: t(finished ? "tutorial.again" : "tutorial.start") });
		setIcon(go.createSpan(), "arrow-right");
		item.addEventListener("click", () => {
			beforeStart();
			host.start(def);
		});
	});
}

export class TutorialListModal extends Modal {
	constructor(
		app: App,
		private readonly host: TutorialListHost,
	) {
		super(app);
	}

	override onOpen(): void {
		const t = this.host.t();
		this.modalEl.addClass("opc-tutorials-modal");
		this.setTitle(t("tutorial.heading"));
		this.contentEl.createDiv({ cls: "opc-tutorials-intro", text: t("tutorial.intro") });
		renderTutorialList(this.contentEl, this.host, () => this.close());
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
