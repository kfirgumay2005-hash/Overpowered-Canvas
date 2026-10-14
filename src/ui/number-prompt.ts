/** Small modal asking for one number (empty = unset). */
import { Modal, Setting, type App } from "obsidian";
import type { Translate } from "../i18n";

export class NumberPromptModal extends Modal {
	constructor(
		app: App,
		private readonly t: Translate,
		private readonly options: { title: string; help?: string; value?: number; step?: number; min?: number; max?: number },
		private readonly onSubmit: (value: number | undefined) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { t, options } = this;
		this.setTitle(options.title);
		if (options.help) this.contentEl.createEl("p", { cls: "setting-item-description", text: options.help });
		let input = options.value === undefined ? "" : String(options.value);
		const submit = () => {
			const trimmed = input.trim();
			const n = Number(trimmed);
			if (trimmed !== "" && !Number.isFinite(n)) return;
			let value = trimmed === "" ? undefined : n;
			if (value !== undefined) {
				if (options.min !== undefined) value = Math.max(options.min, value);
				if (options.max !== undefined) value = Math.min(options.max, value);
			}
			this.close();
			this.onSubmit(value);
		};
		new Setting(this.contentEl).addText((text) => {
			text.inputEl.type = "number";
			if (options.step) text.inputEl.step = String(options.step);
			text.setValue(input).onChange((v) => (input = v));
			text.inputEl.addEventListener("keydown", (e) => e.key === "Enter" && submit());
			setTimeout(() => text.inputEl.focus());
		});
		new Setting(this.contentEl)
			.addButton((b) =>
				b.setButtonText(t("common.reset")).onClick(() => {
					this.close();
					this.onSubmit(undefined);
				}),
			)
			.addButton((b) => b.setButtonText(t("common.apply")).setCta().onClick(submit));
	}

	override onClose(): void {
		this.contentEl.empty();
	}
}
