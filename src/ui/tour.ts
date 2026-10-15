/**
 * The guided tour: a small panel that walks through every feature, one step at a time, with
 * back / next arrows. Where a feature has a visible control in the open canvas, the control is
 * highlighted. The step is saved, so the tour continues where the user stopped.
 */
import { setIcon, setTooltip, type App } from "obsidian";
import { SETTINGS_GROUP_ORDER, type AnyModule } from "../core/module";
import type { ModuleManager } from "../core/module-manager";
import type { I18nKey, Translate } from "../i18n";
import type { CanvasViewLike } from "../internals/types";

interface TourStep {
	title: string;
	body: string;
	/** Group / section label shown above the title. */
	section?: string;
	/** CSS selector, searched inside the active canvas, of the control to highlight. */
	target?: string;
	/** Module this step presents (offers to enable it when off). */
	module?: string;
}

/** Where each feature's own control lives in the canvas. */
const TARGETS: Readonly<Record<string, string>> = {
	"sticky-notes": ".opc-card-sticky",
	"floating-text": ".opc-card-floating-text",
	"infinite-lines": ".opc-card-infinite-line",
	drawing: ".opc-card-drawing",
	shapes: ".opc-card-shape",
	"board-templates": ".opc-card-insert-template",
	"create-group": ".opc-card-create-group",
	presentation: ".opc-card-add-slide",
	minimap: ".opc-minimap-control",
	grid: ".opc-grid-control",
	frames: ".opc-frames-control",
};

export interface TourHost {
	readonly app: App;
	readonly modules: ModuleManager;
	readonly definitions: readonly AnyModule[];
	t(): Translate;
	getStep(): number;
	setStep(step: number): void;
	openSettings(): void;
}

export class Tour {
	private panel: HTMLElement | null = null;
	private highlight: HTMLElement | null = null;
	private steps: TourStep[] = [];

	constructor(private readonly host: TourHost) {}

	get isOpen(): boolean {
		return !!this.panel;
	}

	toggle(): void {
		if (this.panel) this.close();
		else this.open();
	}

	open(): void {
		this.steps = this.buildSteps();
		if (!this.panel) {
			this.panel = document.body.createDiv({ cls: "opc-tour", attr: { role: "dialog", "aria-live": "polite" } });
			document.addEventListener("keydown", this.onKey, true);
		}
		this.render();
	}

	close(): void {
		this.panel?.remove();
		this.panel = null;
		this.clearHighlight();
		document.removeEventListener("keydown", this.onKey, true);
	}

	private go(delta: number): void {
		const next = Math.min(this.steps.length - 1, Math.max(0, this.host.getStep() + delta));
		this.host.setStep(next);
		this.render();
	}

	private onKey = (evt: KeyboardEvent) => {
		if (!this.panel || (evt.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable=true], .modal")) return;
		const rtl = getComputedStyle(this.panel).direction === "rtl";
		if (evt.key === "Escape") this.close();
		else if (evt.key === "ArrowRight") this.go(rtl ? -1 : 1);
		else if (evt.key === "ArrowLeft") this.go(rtl ? 1 : -1);
		else return;
		evt.preventDefault();
		evt.stopPropagation();
	};

	private buildSteps(): TourStep[] {
		const t = this.host.t();
		const intro: TourStep[] = [
			{ title: t("tour.welcome.title"), body: t("tour.welcome.body") },
			{ title: t("tour.cardMenu.title"), body: t("tour.cardMenu.body"), target: ".canvas-card-menu" },
			{ title: t("tour.selection.title"), body: t("tour.selection.body"), target: ".canvas-menu" },
			{ title: t("tour.controls.title"), body: t("tour.controls.body"), target: ".canvas-controls" },
			{ title: t("tour.settings.title"), body: t("tour.settings.body") },
		];
		const features: TourStep[] = [];
		for (const group of SETTINGS_GROUP_ORDER)
			for (const def of this.host.definitions.filter((d) => d.group === group))
				features.push({ section: t(`group.${group}` as I18nKey), title: t(def.name), body: t(def.description), target: TARGETS[def.id], module: def.id });
		return [...intro, ...features, { title: t("tour.end.title"), body: t("tour.end.body") }];
	}

	private render(): void {
		const panel = this.panel;
		if (!panel) return;
		const t = this.host.t();
		const index = Math.min(this.steps.length - 1, Math.max(0, this.host.getStep()));
		const step = this.steps[index]!;
		panel.empty();

		const head = panel.createDiv({ cls: "opc-tour-head" });
		head.createSpan({ cls: "opc-tour-count", text: t("tour.count", { n: index + 1, total: this.steps.length }) });
		const close = head.createDiv({ cls: "clickable-icon opc-tour-close", attr: { "aria-label": t("tour.close") } });
		setIcon(close, "x");
		close.addEventListener("click", () => this.close());

		if (step.section) panel.createDiv({ cls: "opc-tour-section", text: step.section });
		panel.createDiv({ cls: "opc-tour-title", text: step.title });
		panel.createDiv({ cls: "opc-tour-body", text: step.body });

		if (step.module) {
			const status = this.host.modules.status(step.module);
			if (status === "disabled") {
				const row = panel.createDiv({ cls: "opc-tour-status" });
				row.createSpan({ text: t("tour.module.off") });
				const enable = row.createEl("button", { text: t("tour.module.enable") });
				enable.addEventListener("click", async () => {
					await this.host.modules.setEnabled(step.module!, true);
					this.render();
				});
			} else if (status === "unavailable") panel.createDiv({ cls: "opc-tour-status", text: t("settings.module.desktopOnly") });
		}
		if (index === 4) {
			const open = panel.createEl("button", { cls: "opc-tour-link", text: t("tour.settings.open") });
			open.addEventListener("click", () => this.host.openSettings());
		}

		const nav = panel.createDiv({ cls: "opc-tour-nav" });
		const prev = nav.createEl("button", { cls: "opc-tour-prev", attr: { "aria-label": t("tour.prev") } });
		setIcon(prev, "arrow-left");
		setTooltip(prev, t("tour.prev"));
		prev.disabled = index === 0;
		prev.addEventListener("click", () => this.go(-1));
		const progress = nav.createDiv({ cls: "opc-tour-progress" });
		progress.createDiv({ cls: "opc-tour-progress-bar" }).style.width = `${((index + 1) / this.steps.length) * 100}%`;
		const next = nav.createEl("button", { cls: "opc-tour-next mod-cta", attr: { "aria-label": t("tour.next") } });
		setIcon(next, "arrow-right");
		setTooltip(next, t("tour.next"));
		if (index === this.steps.length - 1) {
			next.empty();
			next.setText(t("tour.finish"));
			next.addEventListener("click", () => {
				this.host.setStep(0);
				this.close();
			});
		} else next.addEventListener("click", () => this.go(1));

		this.showHighlight(step.target, panel);
	}

	private activeCanvasEl(): HTMLElement | null {
		const view = this.host.app.workspace.getMostRecentLeaf()?.view as CanvasViewLike | undefined;
		return view?.getViewType?.() === "canvas" ? (view.canvas?.wrapperEl ?? null) : null;
	}

	private showHighlight(selector: string | undefined, panel: HTMLElement): void {
		this.clearHighlight();
		if (!selector) return;
		const target = this.activeCanvasEl()?.querySelector<HTMLElement>(selector);
		if (!target || !target.isShown()) {
			panel.createDiv({ cls: "opc-tour-hint", text: this.activeCanvasEl() ? this.host.t()("tour.notVisible") : this.host.t()("tour.openCanvas") });
			return;
		}
		const r = target.getBoundingClientRect();
		const pad = 4;
		this.highlight = document.body.createDiv({ cls: "opc-tour-highlight" });
		this.highlight.setCssStyles({ left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
	}

	private clearHighlight(): void {
		this.highlight?.remove();
		this.highlight = null;
	}
}
