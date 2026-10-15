/**
 * A compact properties (frontmatter) editor: one row per property with a type, plus add/remove.
 * Values are JSON: text, number, checkbox, list of text.
 */
import { Modal, Setting, setIcon, setTooltip, type App } from "obsidian";
import type { Translate } from "../i18n";

type PropType = "text" | "list" | "number" | "checkbox";

interface Row {
	key: string;
	type: PropType;
	value: string | number | boolean | string[];
}

const LIST_KEYS = new Set(["tags", "aliases", "cssclasses"]);

function toRow(key: string, value: unknown): Row {
	if (Array.isArray(value)) return { key, type: "list", value: value.map((v) => String(v)) };
	if (typeof value === "boolean") return { key, type: "checkbox", value };
	if (typeof value === "number") return { key, type: "number", value };
	if (value === null || value === undefined) return { key, type: LIST_KEYS.has(key) ? "list" : "text", value: LIST_KEYS.has(key) ? [] : "" };
	return { key, type: "text", value: typeof value === "string" ? value : JSON.stringify(value) };
}

function convert(row: Row, type: PropType): Row["value"] {
	const v = row.value;
	switch (type) {
		case "list":
			return Array.isArray(v) ? v : String(v).split(",").map((s) => s.trim()).filter(Boolean);
		case "number": {
			const n = Number(Array.isArray(v) ? v[0] : v);
			return Number.isFinite(n) ? n : 0;
		}
		case "checkbox":
			return v === true || v === "true";
		default:
			return Array.isArray(v) ? v.join(", ") : String(v);
	}
}

/** Cleans a property list for storage: trims keys, drops empty keys, normalizes tags. */
export function rowsToFrontmatter(rows: { key: string; type: PropType; value: Row["value"] }[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const row of rows) {
		const key = row.key.trim();
		if (!key) continue;
		let value = row.value;
		if (Array.isArray(value)) {
			value = value.map((s) => s.trim()).filter(Boolean);
			if (key === "tags") value = value.map((t) => t.replace(/^#/, ""));
		}
		out[key] = value;
	}
	return out;
}

export class PropertiesModal extends Modal {
	private rows: Row[];
	private listEl!: HTMLElement;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly title: string,
		frontmatter: Record<string, unknown>,
		private readonly onSave: (frontmatter: Record<string, unknown>) => void,
	) {
		super(app);
		this.rows = Object.entries(frontmatter).map(([k, v]) => toRow(k, v));
	}

	override onOpen(): void {
		const { t } = this;
		this.setTitle(this.title);
		this.modalEl.addClass("opc-properties-modal");
		this.listEl = this.contentEl.createDiv({ cls: "opc-properties" });
		this.renderRows();
		new Setting(this.contentEl)
			.addButton((b) =>
				b
					.setButtonText(t("properties.add"))
					.setIcon("plus")
					.onClick(() => {
						this.rows.push({ key: "", type: "text", value: "" });
						this.renderRows(true);
					}),
			)
			.addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(t("common.save"))
					.setCta()
					.onClick(() => {
						this.close();
						this.onSave(rowsToFrontmatter(this.rows));
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private renderRows(focusLast = false): void {
		const { t } = this;
		this.listEl.empty();
		if (this.rows.length === 0) this.listEl.createDiv({ cls: "opc-properties-empty", text: t("properties.empty") });
		this.rows.forEach((row, index) => {
			const el = this.listEl.createDiv({ cls: "opc-property-row" });
			const key = el.createEl("input", { type: "text", cls: "opc-property-key", attr: { placeholder: t("properties.key"), "aria-label": t("properties.key") } });
			key.value = row.key;
			key.addEventListener("input", () => (row.key = key.value));
			const type = el.createEl("select", { cls: "dropdown opc-property-type", attr: { "aria-label": t("properties.type") } });
			for (const opt of ["text", "list", "number", "checkbox"] as PropType[]) type.createEl("option", { value: opt, text: t(`properties.type.${opt}`) });
			type.value = row.type;
			type.addEventListener("change", () => {
				row.value = convert(row, type.value as PropType);
				row.type = type.value as PropType;
				this.renderRows();
			});
			const valueEl = el.createDiv({ cls: "opc-property-value" });
			if (row.type === "checkbox") {
				const cb = valueEl.createEl("input", { type: "checkbox" });
				cb.checked = row.value === true;
				cb.addEventListener("change", () => (row.value = cb.checked));
			} else {
				const input = valueEl.createEl("input", { type: row.type === "number" ? "number" : "text", attr: { "aria-label": t("properties.value") } });
				input.value = Array.isArray(row.value) ? row.value.join(", ") : String(row.value);
				if (row.type === "list") input.placeholder = t("properties.listHint");
				input.addEventListener("input", () => {
					row.value = row.type === "list" ? input.value.split(",") : row.type === "number" ? Number(input.value) : input.value;
				});
			}
			const del = el.createEl("button", { cls: "clickable-icon opc-property-delete", attr: { "aria-label": t("properties.remove") } });
			setIcon(del, "x");
			setTooltip(del, t("properties.remove"));
			del.addEventListener("click", () => {
				this.rows.splice(index, 1);
				this.renderRows();
			});
			if (focusLast && index === this.rows.length - 1) window.setTimeout(() => key.focus());
		});
	}
}
