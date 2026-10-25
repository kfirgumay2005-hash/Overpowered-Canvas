/**
 * A small popover of icon buttons anchored under a toolbar button (shapes, borders, arrows…).
 * Keyboard accessible: arrow keys move focus, Enter/Space pick, Esc closes. Closes on outside
 * click. Only one picker is open at a time.
 */
import { sanitizeHTMLToDom, setIcon, setTooltip } from "obsidian";

export interface PickerItem {
	id: string;
	label: string;
	/** Lucide icon id, or an SVG string/element for custom previews. */
	icon?: string;
	svg?: string | SVGElement;
	active?: boolean;
}

export interface PickerSection {
	title?: string;
	items: PickerItem[];
	/** Columns of the grid (default 6). */
	columns?: number;
}

let current: { close(): void; anchor: HTMLElement } | null = null;

/**
 * An anchor that is not a toolbar button: menu actions run from the command palette pass one,
 * and the picker opens as a searchable list instead of a popover.
 */
export interface ChoiceAnchor extends HTMLElement {
	opcChoose?(sections: PickerSection[], onPick: (id: string) => void): void;
}

export function closePicker(): void {
	current?.close();
}

export function showPicker(anchor: HTMLElement, sections: PickerSection[], onPick: (id: string) => void): void {
	const target = anchor as ChoiceAnchor;
	if (target.opcChoose) return target.opcChoose(sections, onPick);
	if (current?.anchor === anchor) {
		current.close();
		return;
	}
	current?.close();
	const doc = anchor.doc;
	const el = doc.body.createDiv({ cls: "opc-picker", attr: { role: "menu" } });
	const buttons: HTMLElement[] = [];
	for (const section of sections) {
		if (section.title) el.createDiv({ cls: "opc-picker-title", text: section.title });
		const grid = el.createDiv({ cls: "opc-picker-grid" });
		grid.style.setProperty("--opc-picker-columns", String(section.columns ?? 6));
		for (const item of section.items) {
			const b = grid.createEl("button", { cls: "opc-picker-item clickable-icon", attr: { role: "menuitemradio", "aria-label": item.label, "aria-checked": String(!!item.active), "data-id": item.id } });
			if (item.active) b.addClass("is-active");
			if (item.svg) {
				if (typeof item.svg === "string") b.appendChild(sanitizeHTMLToDom(item.svg));
				else b.appendChild(item.svg);
			} else if (item.icon) setIcon(b, item.icon);
			setTooltip(b, item.label, { placement: "top" });
			b.addEventListener("click", (evt) => {
				evt.stopPropagation();
				close();
				onPick(item.id);
			});
			buttons.push(b);
		}
	}

	const rect = anchor.getBoundingClientRect();
	el.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
	el.style.top = `${Math.round(rect.bottom + 6)}px`;
	// Keep inside the window.
	const box = el.getBoundingClientRect();
	const win = doc.win;
	if (box.right > win.innerWidth - 8) el.style.left = `${Math.round(rect.left + rect.width / 2 - (box.right - win.innerWidth + 8))}px`;
	if (box.left < 8) el.style.left = `${Math.round(rect.left + rect.width / 2 + (8 - box.left))}px`;
	if (box.bottom > win.innerHeight - 8) el.style.top = `${Math.round(rect.top - box.height - 6)}px`;
	anchor.addClass("has-active-menu");

	const onPointerDown = (evt: PointerEvent) => {
		if (!el.contains(evt.target as Node) && !anchor.contains(evt.target as Node)) close();
	};
	const onKey = (evt: KeyboardEvent) => {
		const index = buttons.indexOf(doc.activeElement as HTMLElement);
		if (evt.key === "Escape") {
			evt.preventDefault();
			evt.stopPropagation();
			close();
			anchor.focus();
		} else if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(evt.key)) {
			evt.preventDefault();
			evt.stopPropagation();
			const rtl = getComputedStyle(el).direction === "rtl";
			const step = evt.key === "ArrowDown" ? 6 : evt.key === "ArrowUp" ? -6 : (evt.key === "ArrowRight") !== rtl ? 1 : -1;
			const next = buttons[Math.min(buttons.length - 1, Math.max(0, (index < 0 ? 0 : index + step)))];
			next?.focus();
		}
	};
	doc.addEventListener("pointerdown", onPointerDown, true);
	doc.addEventListener("keydown", onKey, true);

	function close() {
		if (!el.isConnected) return;
		el.remove();
		anchor.removeClass("has-active-menu");
		doc.removeEventListener("pointerdown", onPointerDown, true);
		doc.removeEventListener("keydown", onKey, true);
		if (current?.anchor === anchor) current = null;
	}
	current = { close, anchor };
	(buttons.find((b) => b.hasClass("is-active")) ?? buttons[0])?.focus({ preventScroll: true });
}

/**
 * A popover with custom content under a toolbar button (same look, placement and closing as the
 * picker: outside click or Esc). `onClose` runs however it closes.
 */
export function showPopover(anchor: HTMLElement, fill: (el: HTMLElement, close: () => void) => void, onClose?: () => void): void {
	if (current?.anchor === anchor) {
		current.close();
		return;
	}
	current?.close();
	const doc = anchor.doc;
	const el = doc.body.createDiv({ cls: "opc-picker opc-popover", attr: { role: "dialog" } });
	const onPointerDown = (evt: PointerEvent) => {
		if (!el.contains(evt.target as Node) && !anchor.contains(evt.target as Node)) close();
	};
	const onKey = (evt: KeyboardEvent) => {
		if (evt.key !== "Escape") return;
		evt.preventDefault();
		evt.stopPropagation();
		close();
		anchor.focus();
	};
	function close() {
		if (!el.isConnected) return;
		el.remove();
		anchor.removeClass("has-active-menu");
		doc.removeEventListener("pointerdown", onPointerDown, true);
		doc.removeEventListener("keydown", onKey, true);
		if (current?.anchor === anchor) current = null;
		onClose?.();
	}
	fill(el, close);
	const rect = anchor.getBoundingClientRect();
	el.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
	el.style.top = `${Math.round(rect.bottom + 6)}px`;
	const box = el.getBoundingClientRect();
	const win = doc.win;
	if (box.right > win.innerWidth - 8) el.style.left = `${Math.round(rect.left + rect.width / 2 - (box.right - win.innerWidth + 8))}px`;
	if (box.left < 8) el.style.left = `${Math.round(rect.left + rect.width / 2 + (8 - box.left))}px`;
	if (box.bottom > win.innerHeight - 8) el.style.top = `${Math.round(rect.top - box.height - 6)}px`;
	anchor.addClass("has-active-menu");
	doc.addEventListener("pointerdown", onPointerDown, true);
	doc.addEventListener("keydown", onKey, true);
	current = { close, anchor };
}
