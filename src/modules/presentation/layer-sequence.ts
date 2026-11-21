/**
 * The sequence editor of a presentation by layers: which layers are steps and in what order, which
 * are base layers, how steps reveal and where the view goes. Every change is one undo step and is
 * saved in the canvas at once.
 */
import { Modal, setIcon, setTooltip, type App } from "obsidian";
import { LAYER_CAMERAS, LAYER_REVEALS, type LayerCamera, type LayerInfo, type LayerReveal, type LayerSequence, type LayerStepInfo } from "../../data/schema";
import type { Translate } from "../../i18n";
import { moveStep, resolveSequence } from "./layer-steps";

export interface SequenceStore {
	layers(): readonly LayerInfo[];
	read(): LayerSequence | undefined;
	/** False when the canvas can't be changed (read-only). */
	write(next: LayerSequence | undefined): boolean;
	editable(): boolean;
	start(): void;
}

/** Drops empty fields; nothing left means no sequence at all. */
export function cleanSequence(seq: LayerSequence): LayerSequence | undefined {
	const out: LayerSequence = {};
	// An empty list is kept: no steps chosen (no list at all plays every layer).
	if (seq.steps) out.steps = seq.steps.map((s) => ({ layer: s.layer, ...(s.reveal ? { reveal: s.reveal } : {}), ...(s.camera ? { camera: s.camera } : {}) }));
	if (seq.reveal) out.reveal = seq.reveal;
	if (seq.camera) out.camera = seq.camera;
	if (seq.base?.length) out.base = [...new Set(seq.base)];
	return Object.keys(out).length > 0 ? out : undefined;
}

/** The stored steps; without any, the default ones (every layer that is not a base layer) made explicit. */
export function explicitSteps(seq: LayerSequence | undefined, layers: readonly LayerInfo[]): LayerStepInfo[] {
	if (seq?.steps) return seq.steps.map((s) => ({ ...s }));
	return resolveSequence(seq, layers).steps.map((s) => ({ layer: s.layers[0]! }));
}

/** Adds the layer as the last step (and makes it no base layer), or takes it out of the steps. */
export function toggleStepIn(seq: LayerSequence | undefined, id: string): LayerSequence | undefined {
	const steps = seq?.steps ?? [];
	const isStep = steps.some((s) => s.layer === id);
	return cleanSequence({ ...seq, steps: isStep ? steps.filter((s) => s.layer !== id) : [...steps, { layer: id }], base: seq?.base?.filter((b) => b !== id) });
}

/** Makes the layer a base layer (no step any more), or an ordinary layer again. */
export function toggleBaseIn(seq: LayerSequence | undefined, id: string): LayerSequence | undefined {
	const base = seq?.base ?? [];
	if (base.includes(id)) return cleanSequence({ ...seq, base: base.filter((b) => b !== id) });
	return cleanSequence({ ...seq, base: [...base, id], steps: seq?.steps?.filter((s) => s.layer !== id) });
}

export class LayerSequenceModal extends Modal {
	private dragFrom = -1;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly store: SequenceStore,
	) {
		super(app);
	}

	override onOpen(): void {
		this.modalEl.addClass("opc-layer-sequence-modal");
		this.setTitle(this.t("presentation.layers.editorTitle"));
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private save(next: LayerSequence | undefined): void {
		this.store.write(next);
		this.render();
	}

	private render(): void {
		const { t, store } = this;
		const el = this.contentEl;
		el.empty();
		const layers = store.layers();
		const seq = store.read();
		const resolved = resolveSequence(seq, layers);
		const editable = store.editable();
		const byId = new Map(layers.map((l) => [l.id, l]));
		el.createEl("p", { cls: "opc-seq-intro", text: t("presentation.layers.intro") });
		if (!editable) el.createEl("p", { cls: "opc-seq-readonly mod-warning", text: t("presentation.layers.readonly") });

		// Defaults of the whole sequence.
		const defaults = el.createDiv({ cls: "opc-seq-defaults" });
		const revealSel = this.select(defaults, t("presentation.layers.reveal"), LAYER_REVEALS.map((r) => [r, t(`presentation.layers.reveal.${r}`)]), resolved.reveal, editable, (v) =>
			this.save(cleanSequence({ ...seq, reveal: v as LayerReveal })),
		);
		revealSel.addClass("opc-seq-reveal");
		const cameraSel = this.select(defaults, t("presentation.layers.camera"), LAYER_CAMERAS.map((c) => [c, t(`presentation.layers.camera.${c}`)]), resolved.camera, editable, (v) =>
			this.save(cleanSequence({ ...seq, camera: v as LayerCamera })),
		);
		cameraSel.addClass("opc-seq-camera");
		el.createEl("p", { cls: "opc-seq-help", text: t(resolved.reveal === "replace" ? "presentation.layers.reveal.replaceHelp" : "presentation.layers.reveal.accumulateHelp") });

		// The steps, in order.
		el.createEl("h3", { cls: "opc-seq-heading", text: t("presentation.layers.steps") });
		if (resolved.implicit) el.createEl("p", { cls: "opc-seq-help", text: t("presentation.layers.implicit") });
		const list = el.createDiv({ cls: "opc-seq-steps", attr: { role: "list" } });
		const steps = explicitSteps(seq, layers).filter((s) => byId.has(s.layer) && !resolved.base.includes(s.layer));
		const writeSteps = (next: LayerStepInfo[]) => this.save(cleanSequence({ ...seq, steps: next }));
		if (steps.length === 0) list.createDiv({ cls: "opc-seq-empty", text: t("presentation.layers.noSteps") });
		steps.forEach((step, index) => {
			const row = list.createDiv({ cls: "opc-seq-step", attr: { role: "listitem", draggable: String(editable), "data-layer": step.layer } });
			const grip = row.createSpan({ cls: "opc-seq-grip" });
			setIcon(grip, "grip-vertical");
			row.createSpan({ cls: "opc-seq-num", text: String(index + 1) });
			row.createSpan({ cls: "opc-seq-name", text: byId.get(step.layer)!.name });
			const opts = row.createDiv({ cls: "opc-seq-step-options" });
			// Rows are narrow: the choices without their explanation in brackets.
			const short = (label: string) => label.split(/\s*[(（]/)[0]!;
			const inherit = (label: string) => t("presentation.layers.default", { value: short(label) });
			this.bareSelect(
				opts,
				t("presentation.layers.stepReveal"),
				[["", inherit(t(`presentation.layers.reveal.${resolved.reveal}`))], ...LAYER_REVEALS.map((r) => [r, short(t(`presentation.layers.reveal.${r}`))] as [string, string])],
				step.reveal ?? "",
				editable,
				(v) => writeSteps(steps.map((s, i) => (i === index ? { ...s, reveal: (v || undefined) as LayerReveal | undefined } : s))),
			).addClass("opc-seq-step-reveal");
			this.bareSelect(
				opts,
				t("presentation.layers.stepCamera"),
				[["", inherit(t(`presentation.layers.camera.${resolved.camera}`))], ...LAYER_CAMERAS.map((c) => [c, t(`presentation.layers.camera.${c}`)] as [string, string])],
				step.camera ?? "",
				editable,
				(v) => writeSteps(steps.map((s, i) => (i === index ? { ...s, camera: (v || undefined) as LayerCamera | undefined } : s))),
			).addClass("opc-seq-step-camera");
			// Buttons too: dragging needs a mouse.
			const buttons = row.createDiv({ cls: "opc-seq-buttons" });
			this.iconButton(buttons, "arrow-up", t("presentation.layers.moveUp"), editable && index > 0, () => writeSteps(moveStep(steps, index, index - 1))).addClass("opc-seq-up");
			this.iconButton(buttons, "arrow-down", t("presentation.layers.moveDown"), editable && index < steps.length - 1, () => writeSteps(moveStep(steps, index, index + 1))).addClass("opc-seq-down");
			this.iconButton(buttons, "x", t("presentation.layers.remove"), editable, () => writeSteps(steps.filter((_, i) => i !== index))).addClass("opc-seq-remove");
			if (!editable) return;
			row.addEventListener("dragstart", (e) => {
				this.dragFrom = index;
				e.dataTransfer?.setData("text/plain", String(index));
				row.addClass("is-dragging");
			});
			row.addEventListener("dragend", () => row.removeClass("is-dragging"));
			row.addEventListener("dragover", (e) => {
				e.preventDefault();
				const r = row.getBoundingClientRect();
				row.toggleClass("drop-before", e.clientY < r.top + r.height / 2);
				row.toggleClass("drop-after", e.clientY >= r.top + r.height / 2);
			});
			row.addEventListener("dragleave", () => row.removeClasses(["drop-before", "drop-after"]));
			row.addEventListener("drop", (e) => {
				e.preventDefault();
				const r = row.getBoundingClientRect();
				const before = e.clientY < r.top + r.height / 2;
				row.removeClasses(["drop-before", "drop-after"]);
				const from = this.dragFrom;
				this.dragFrom = -1;
				if (from < 0) return;
				let to = before ? index : index + 1;
				if (from < to) to--;
				if (to !== from) writeSteps(moveStep(steps, from, to));
			});
		});

		// Every other layer: make it a step, or a base layer shown throughout.
		const others = layers.filter((l) => !steps.some((s) => s.layer === l.id));
		el.createEl("h3", { cls: "opc-seq-heading", text: t("presentation.layers.others") });
		el.createEl("p", { cls: "opc-seq-help", text: t("presentation.layers.othersHelp") });
		const otherList = el.createDiv({ cls: "opc-seq-others", attr: { role: "list" } });
		if (others.length === 0) otherList.createDiv({ cls: "opc-seq-empty", text: t("presentation.layers.noOthers") });
		for (const layer of [...others].reverse()) {
			const isBase = resolved.base.includes(layer.id);
			const row = otherList.createDiv({ cls: "opc-seq-other", attr: { role: "listitem", "data-layer": layer.id } });
			row.toggleClass("is-base", isBase);
			row.createSpan({ cls: "opc-seq-name", text: layer.name });
			row.createSpan({ cls: "opc-seq-state", text: t(isBase ? "presentation.layers.isBase" : "presentation.layers.isHidden") });
			const base = this.iconButton(row, "pin", t(isBase ? "presentation.layers.unbase" : "presentation.layers.base"), editable, () => this.save(toggleBaseIn(seq, layer.id)));
			base.addClass("opc-seq-base");
			base.toggleClass("is-active", isBase);
			base.setAttr("aria-pressed", String(isBase));
			// A base layer that becomes a step is no base layer any more.
			this.iconButton(row, "plus", t("presentation.layers.add"), editable, () =>
				this.save(cleanSequence({ ...seq, steps: [...steps, { layer: layer.id }], base: seq?.base?.filter((b) => b !== layer.id) })),
			).addClass("opc-seq-add");
		}

		const footer = el.createDiv({ cls: "modal-button-container" });
		const start = footer.createEl("button", { cls: "mod-cta opc-seq-start", text: t("presentation.layers.start") });
		start.disabled = resolved.steps.length === 0;
		start.addEventListener("click", () => {
			this.close();
			store.start();
		});
		footer.createEl("button", { text: t("common.close") }).addEventListener("click", () => this.close());
	}

	/** A labelled dropdown. */
	private select(parent: HTMLElement, label: string, options: [string, string][], value: string, enabled: boolean, onChange: (v: string) => void): HTMLSelectElement {
		const wrap = parent.createEl("label", { cls: "opc-seq-field" });
		wrap.createSpan({ cls: "opc-seq-field-label", text: label });
		return this.fillSelect(wrap.createEl("select", { cls: "dropdown" }), options, value, enabled, onChange);
	}

	/** A dropdown named for screen readers only (in a step row). */
	private bareSelect(parent: HTMLElement, label: string, options: [string, string][], value: string, enabled: boolean, onChange: (v: string) => void): HTMLSelectElement {
		const sel = parent.createEl("select", { cls: "dropdown", attr: { "aria-label": label } });
		setTooltip(sel, label);
		return this.fillSelect(sel, options, value, enabled, onChange);
	}

	private fillSelect(sel: HTMLSelectElement, options: [string, string][], value: string, enabled: boolean, onChange: (v: string) => void): HTMLSelectElement {
		for (const [v, text] of options) sel.createEl("option", { value: v, text });
		sel.value = value;
		sel.disabled = !enabled;
		sel.addEventListener("change", () => onChange(sel.value));
		return sel;
	}

	private iconButton(parent: HTMLElement, icon: string, label: string, enabled: boolean, run: () => void): HTMLButtonElement {
		const b = parent.createEl("button", { cls: "clickable-icon", attr: { "aria-label": label } });
		setIcon(b, icon);
		setTooltip(b, label);
		b.disabled = !enabled;
		b.addEventListener("click", (e) => {
			e.stopPropagation();
			if (!b.disabled) run();
		});
		return b;
	}
}
