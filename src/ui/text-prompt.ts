/** Small modal asking for one line of text. */
import { Modal, Setting, type App } from "obsidian";
import type { Translate } from "../i18n";

export class TextPromptModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly options: { title: string; help?: string; value?: string; placeholder?: string },
		private readonly onSubmit: (value: string) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { t, options } = this;
		this.setTitle(options.title);
		if (options.help) this.contentEl.createEl("p", { cls: "setting-item-description", text: options.help });
		let value = options.value ?? "";
		const submit = () => {
			if (!value.trim()) return;
			this.close();
			this.onSubmit(value.trim());
		};
		new Setting(this.contentEl).addText((text) => {
			text.inputEl.addClass("opc-text-prompt-input");
			if (options.placeholder) text.setPlaceholder(options.placeholder);
			text.setValue(value).onChange((v) => (value = v));
			text.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && submit());
			setTimeout(() => {
				text.inputEl.focus();
				text.inputEl.select();
			});
		});
		new Setting(this.contentEl)
			.addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
			.addButton((b) => b.setButtonText(t("common.apply")).setCta().onClick(submit));
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
