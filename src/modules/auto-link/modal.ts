import { Modal, Setting, setIcon, setTooltip, type TFile } from "obsidian";
import type { ModuleContext } from "../../core/module";
import { logError } from "../../core/log";
import type { AutoLinkScope, AutoLinkSettings } from "./index";
import type { Created } from "./match";

export interface FilePlan {
	file: TFile;
	created: Created[];
}

export interface ModalHost {
	scan(scope: AutoLinkScope, active: TFile | null): Promise<FilePlan[]>;
	run(files: TFile[]): Promise<void>;
	/** Adds a title to the excluded ones. */
	refuse(title: string): Promise<void>;
}

/** The linked words of a file, most frequent first. */
function summarize(created: Created[]): { text: string; target: string; count: number }[] {
	const rows = new Map<string, { text: string; target: string; count: number }>();
	for (const c of created) {
		const key = `${c.text.toLowerCase()}\n${c.target}`;
		const row = rows.get(key);
		if (row) row.count++;
		else rows.set(key, { text: c.text, target: c.target, count: 1 });
	}
	return [...rows.values()].sort((a, b) => b.count - a.count);
}

/** Lists what a run would write; nothing is written until the button is pressed. */
export class AutoLinkModal extends Modal {
	private plans: FilePlan[] = [];
	private readonly skipped = new Set<string>();
	private summaryEl!: HTMLElement;
	private listEl!: HTMLElement;
	private runButton!: HTMLButtonElement;
	/** The newest scan: an older one finishing late is ignored. */
	private scanId = 0;

	constructor(
		private readonly ctx: ModuleContext<AutoLinkSettings>,
		private readonly host: ModalHost,
		private readonly active: TFile | null,
	) {
		super(ctx.app);
	}

	override onOpen(): void {
		const { t, settings } = this.ctx;
		this.setTitle(t("autoLink.modal.title"));
		this.modalEl.addClass("opc-autolink-modal");
		const { contentEl } = this;
		new Setting(contentEl).setName(t("autoLink.scope.name")).addDropdown((d) =>
			d
				.addOptions({ file: t("autoLink.scope.file"), folder: t("autoLink.scope.folder"), vault: t("autoLink.scope.vault") })
				.setValue(settings.scope)
				.onChange(async (v) => {
					await this.ctx.updateSettings({ scope: v as AutoLinkScope });
					void this.rescan();
				}),
		);
		new Setting(contentEl).setName(t("autoLink.notes.name")).addToggle((c) =>
			c.setValue(settings.notes).onChange(async (v) => {
				await this.ctx.updateSettings({ notes: v });
				void this.rescan();
			}),
		);
		this.summaryEl = contentEl.createDiv({ cls: "opc-autolink-summary" });
		this.listEl = contentEl.createDiv({ cls: "opc-autolink-list" });
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
			.addButton((b) => {
				b.setCta().setButtonText(t("autoLink.modal.create")).onClick(() => void this.create());
				this.runButton = b.buttonEl;
			});
		void this.rescan();
	}

	private selected(): FilePlan[] {
		return this.plans.filter((p) => !this.skipped.has(p.file.path));
	}

	private refreshSummary(): void {
		const chosen = this.selected();
		const links = chosen.reduce((n, p) => n + p.created.length, 0);
		this.summaryEl.setText(this.plans.length ? this.ctx.t("autoLink.modal.summary", { links, files: chosen.length }) : this.ctx.t("autoLink.modal.none"));
		this.runButton.disabled = links === 0;
	}

	private async rescan(): Promise<void> {
		const id = ++this.scanId;
		this.summaryEl.setText(this.ctx.t("autoLink.modal.scanning"));
		this.listEl.empty();
		this.runButton.disabled = true;
		try {
			const plans = await this.host.scan(this.ctx.settings.scope, this.active);
			if (id !== this.scanId) return;
			this.plans = plans;
			this.renderList();
		} catch (error) {
			logError("[overpowered-canvas] auto-link: scan", error);
			this.summaryEl.setText(this.ctx.t("autoLink.modal.scanFailed"));
		}
	}

	private renderList(): void {
		this.listEl.empty();
		for (const plan of this.plans) {
			const row = this.listEl.createEl("details", { cls: "opc-autolink-file" });
			const head = row.createEl("summary");
			const box = head.createEl("input", { attr: { type: "checkbox", "aria-label": plan.file.path } });
			box.checked = !this.skipped.has(plan.file.path);
			box.addEventListener("click", (evt) => evt.stopPropagation());
			box.addEventListener("change", () => {
				if (box.checked) this.skipped.delete(plan.file.path);
				else this.skipped.add(plan.file.path);
				this.refreshSummary();
			});
			head.createSpan({ cls: "opc-autolink-path", text: plan.file.path });
			head.createSpan({ cls: "opc-autolink-count", text: String(plan.created.length) });
			// The rows are built on first open: a whole vault can have thousands.
			row.addEventListener("toggle", () => {
				if (row.open && row.childElementCount === 1) this.renderDetail(row, plan);
			});
		}
		this.refreshSummary();
	}

	private renderDetail(row: HTMLElement, plan: FilePlan): void {
		const { t } = this.ctx;
		for (const item of summarize(plan.created)) {
			const line = row.createDiv({ cls: "opc-autolink-link" });
			line.createSpan({ cls: "opc-autolink-words", text: item.text });
			line.createSpan({ cls: "opc-autolink-arrow", text: "→" });
			line.createSpan({ cls: "opc-autolink-target", text: item.target });
			if (item.count > 1) line.createSpan({ cls: "opc-autolink-count", text: `×${item.count}` });
			const refuse = line.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("autoLink.modal.refuse") } });
			setIcon(refuse, "ban");
			setTooltip(refuse, t("autoLink.modal.refuse"));
			refuse.addEventListener("click", () => {
				void this.host.refuse(item.text).then(() => this.rescan());
			});
		}
	}

	private async create(): Promise<void> {
		const files = this.selected().map((p) => p.file);
		this.close();
		await this.host.run(files);
	}

	override onClose(): void {
		this.scanId++;
		this.contentEl.empty();
	}
}
