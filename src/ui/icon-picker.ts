/** Modal asking for a name and a Lucide icon (searchable grid, keyboard accessible). */
import { Modal, Setting, getIconIds, setIcon, setTooltip, type App } from "obsidian";
import type { Translate } from "../i18n";

export interface IconPickerResult {
	name: string;
	icon: string;
}

const MAX_RESULTS = 160;

export class IconPickerModal extends Modal {
	private name: string;
	private icon: string;
	private gridEl!: HTMLElement;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly options: { title: string; name: string; icon: string; askName?: boolean },
		private readonly onSubmit: (result: IconPickerResult) => void,
	) {
		super(app);
		this.name = options.name;
		this.icon = options.icon;
	}

	override onOpen(): void {
		const { t, contentEl } = this;
		this.setTitle(this.options.title);
		this.modalEl.addClass("opc-icon-picker-modal");
		if (this.options.askName !== false)
			new Setting(contentEl).setName(t("iconPicker.name")).addText((text) => {
				text.setValue(this.name).onChange((v) => (this.name = v));
				setTimeout(() => text.inputEl.select());
			});
		let query = "";
		new Setting(contentEl).setName(t("iconPicker.icon")).addSearch((search) =>
			search.setPlaceholder(t("iconPicker.search")).onChange((v) => {
				query = v;
				this.renderGrid(query);
			}),
		);
		this.gridEl = contentEl.createDiv({ cls: "opc-icon-grid", attr: { role: "listbox" } });
		this.renderGrid(query);
		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText(t("common.save"))
				.setCta()
				.onClick(() => this.submit()),
		);
		this.scope.register([], "Enter", (evt) => {
			if ((evt.target as HTMLElement).closest(".opc-icon-grid")) return;
			this.submit();
			return false;
		});
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private submit(): void {
		const name = this.name.trim();
		if (!name) return;
		this.close();
		this.onSubmit({ name, icon: this.icon });
	}

	private renderGrid(query: string): void {
		const q = query.trim().toLowerCase();
		const ids = getIconIds()
			.filter((id) => !q || id.toLowerCase().includes(q))
			.slice(0, MAX_RESULTS);
		this.gridEl.empty();
		for (const id of ids) {
			const b = this.gridEl.createEl("button", { cls: "clickable-icon opc-icon-choice", attr: { role: "option", "aria-label": id } });
			setIcon(b, id);
			setTooltip(b, id.replace(/^lucide-/, ""));
			if (id === this.icon) b.addClass("is-active");
			b.addEventListener("click", () => {
				this.icon = id;
				this.gridEl.querySelectorAll(".is-active").forEach((el) => el.removeClass("is-active"));
				b.addClass("is-active");
			});
			b.addEventListener("dblclick", () => {
				this.icon = id;
				this.submit();
			});
		}
	}
}
