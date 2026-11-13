/**
 * The Review flowchart window. List screen: every flowchart found (search, rename, how many
 * reviews, the last one, when the next is due) and a choice between the charts' own shapes and
 * plain squares. Quiz screen: the chart with its cards empty; Submit shows the right answers next
 * to the written ones, then Again / Hard / Good / Easy schedules the next review (FSRS).
 */
import { Modal, Notice, SearchComponent, setIcon, setTooltip, type App } from "obsidian";
import { SHAPES, type ShapeName } from "../../data/schema";
import type { EdgeSide } from "../../data/json-canvas";
import { shapeGeometry } from "../../geometry/shapes";
import type { I18nKey, Translate } from "../../i18n";
import { matches, normalize, queryWords } from "../../settings/search";
import { TextPromptModal } from "../../ui/text-prompt";
import { cardLabel, defaultName, type ChartNode, type Flowchart } from "./find";
import { preview, RATINGS, span, type MemoryState, type Rating } from "./fsrs";
import { grade, normalizeAnswer, type Grade } from "./grade";
import type { ChartEntry } from "./store";

/** How cards are answered: typed from memory, or picked from the chart's own texts and dragged in. */
export type AnswerMode = "type" | "drag";
export const ANSWER_MODES: readonly AnswerMode[] = ["type", "drag"];

/** A card to answer: what was answered, and how its answer is cleared away to show the result. */
interface Field {
	node: ChartNode;
	card: HTMLElement;
	inner: HTMLElement;
	value(): string;
	clear(): void;
}

export interface ReviewHost {
	readonly app: App;
	t(): Translate;
	settings(): { squares: boolean; nameWords: number; answerMode: AnswerMode };
	setSquares(on: boolean): Promise<void>;
	setAnswerMode(mode: AnswerMode): Promise<void>;
	/** Every flowchart to review, with its entry (already reset when the chart changed). */
	scan(): Promise<{ chart: Flowchart; entry: ChartEntry }[]>;
	rename(chart: Flowchart, name: string | undefined): Promise<void>;
	rate(chart: Flowchart, state: MemoryState): Promise<void>;
	reveal(chart: Flowchart): Promise<void>;
	/** Subscribe to data changes (another device synced the note); returns an unsubscribe. */
	onChange(cb: () => void): () => void;
}

const PAD = 40;
const RATING_KEYS: Record<Rating, I18nKey> = { 1: "flowchartReview.again", 2: "flowchartReview.hard", 3: "flowchartReview.good", 4: "flowchartReview.easy" };
const isShape = (s: string | undefined): s is ShapeName => !!s && (SHAPES as readonly string[]).includes(s);
/** Cards that are filled in: text cards with words. Files, links and empty shapes are shown as they are. */
const isAsked = (n: ChartNode) => n.type === "text" && cardLabel(n).length > 0;

export function formatSpan(t: Translate, ms: number): string {
	const s = span(ms);
	return t(`flowchartReview.unit.${s.unit}` as I18nKey, { n: s.n });
}

export function chartName(chart: Flowchart, entry: ChartEntry, words: number): string {
	return entry.name ?? (defaultName(chart, words) || chart.path);
}

export class ReviewModal extends Modal {
	private items: { chart: Flowchart; entry: ChartEntry }[] = [];
	private query = "";
	private screen: "list" | "quiz" = "list";
	private unsubscribe: (() => void) | null = null;
	/** Ctrl/Cmd+Enter in the quiz: Submit. */
	private submitKey: (() => void) | null = null;

	constructor(private readonly host: ReviewHost) {
		super(host.app);
	}

	override onOpen(): void {
		this.modalEl.addClass("opc-review-modal");
		this.unsubscribe = this.host.onChange(() => {
			if (this.screen === "list") void this.showList();
		});
		this.contentEl.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter" && (evt.ctrlKey || evt.metaKey) && this.submitKey) {
				evt.preventDefault();
				this.submitKey();
			}
		});
		void this.showList();
	}

	override onClose(): void {
		this.unsubscribe?.();
		activeDocument.querySelectorAll(".opc-review-ghost").forEach((g) => g.remove());
		this.contentEl.empty();
	}

	// ---------- list ----------

	async showList(): Promise<void> {
		const t = this.host.t();
		this.screen = "list";
		this.submitKey = null;
		this.modalEl.removeClass("is-quiz");
		this.setTitle(t("flowchartReview.title"));
		const { contentEl } = this;
		if (!contentEl.querySelector(".opc-review-list")) {
			contentEl.empty();
			contentEl.createDiv({ cls: "opc-review-loading", text: t("flowchartReview.loading") });
		}
		this.items = await this.host.scan();
		if (this.screen !== "list") return;
		const scroll = contentEl.querySelector(".opc-review-rows")?.scrollTop ?? 0;
		contentEl.empty();
		const bar = contentEl.createDiv({ cls: "opc-review-toolbar" });
		const search = new SearchComponent(bar.createDiv({ cls: "opc-review-search" })).setPlaceholder(t("flowchartReview.search")).setValue(this.query);
		/** A row of two buttons, one of them on. */
		const choice = <V,>(label: I18nKey, cls: string, attr: string, options: [V, I18nKey][], current: V, set: (v: V) => Promise<void>) => {
			const box = bar.createDiv({ cls: "opc-review-shapes", attr: { role: "radiogroup", "aria-label": t(label) } });
			box.createSpan({ cls: "opc-review-shapes-label", text: t(label) });
			for (const [value, text] of options) {
				const b = box.createEl("button", { cls: `opc-review-shape-choice ${cls}`, text: t(text), attr: { [attr]: String(value), role: "radio" } });
				const on = current === value;
				b.toggleClass("is-active", on);
				b.setAttr("aria-checked", String(on));
				b.addEventListener("click", () => {
					void set(value).then(() => {
						box.querySelectorAll(".opc-review-shape-choice").forEach((el) => {
							const active = el === b;
							el.toggleClass("is-active", active);
							el.setAttr("aria-checked", String(active));
						});
					});
				});
			}
		};
		choice("flowchartReview.shapes", "opc-review-squares-choice", "data-squares", [[false, "flowchartReview.shapes.original"], [true, "flowchartReview.shapes.squares"]], this.host.settings().squares, (v) => this.host.setSquares(v));
		choice("flowchartReview.answers", "opc-review-mode-choice", "data-mode", [["type", "flowchartReview.answers.type"], ["drag", "flowchartReview.answers.drag"]] as [AnswerMode, I18nKey][], this.host.settings().answerMode, (v) => this.host.setAnswerMode(v));

		const rows = contentEl.createDiv({ cls: "opc-review-rows" });
		const empty = contentEl.createDiv({ cls: "opc-review-empty" });
		if (!this.items.length) {
			empty.createEl("p", { text: t("flowchartReview.none") });
			empty.createEl("p", { cls: "setting-item-description", text: t("flowchartReview.noneHelp") });
			return;
		}
		const now = Date.now();
		const words = this.host.settings().nameWords;
		const sorted = [...this.items].sort((a, b) => dueOf(a.entry, now) - dueOf(b.entry, now) || chartName(a.chart, a.entry, words).localeCompare(chartName(b.chart, b.entry, words)));
		const cards: { el: HTMLElement; text: string }[] = [];
		for (const item of sorted) cards.push({ el: this.row(rows, item, now), text: normalize(`${chartName(item.chart, item.entry, words)} ${item.chart.path}`) });
		const filter = (q: string) => {
			this.query = q;
			const w = queryWords(q);
			let shown = 0;
			for (const c of cards) {
				const ok = matches(w, c.text);
				c.el.toggle(ok);
				if (ok) shown++;
			}
			empty.empty();
			if (!shown) empty.createEl("p", { text: t("flowchartReview.noMatch") });
		};
		search.onChange(filter);
		filter(this.query);
		rows.scrollTop = scroll;
	}

	private row(parent: HTMLElement, item: { chart: Flowchart; entry: ChartEntry }, now: number): HTMLElement {
		const t = this.host.t();
		const { chart, entry } = item;
		const words = this.host.settings().nameWords;
		const row = parent.createDiv({ cls: "opc-review-row", attr: { "data-key": chart.key } });
		const main = row.createDiv({ cls: "opc-review-row-main" });
		const head = main.createDiv({ cls: "opc-review-row-head" });
		head.createSpan({ cls: "opc-review-name", text: chartName(chart, entry, words) });
		const rename = head.createEl("button", { cls: "clickable-icon opc-review-rename", attr: { "aria-label": t("flowchartReview.rename") } });
		setIcon(rename, "pencil");
		setTooltip(rename, t("flowchartReview.rename"));
		rename.addEventListener("click", () => {
			new TextPromptModal(this.app, t, { title: t("flowchartReview.rename"), help: t("flowchartReview.renameHelp", { name: defaultName(chart, words) }), value: chartName(chart, entry, words) }, (value) => {
				const name = value.trim() === defaultName(chart, words) ? undefined : value.trim();
				void this.host.rename(chart, name).then(() => this.showList());
			}).open();
		});
		const file = chart.path.split("/").pop()?.replace(/\.canvas$/, "") ?? chart.path;
		main.createDiv({ cls: "opc-review-where", text: t("flowchartReview.where", { file, count: chart.nodes.filter(isAsked).length }) });

		const stats = main.createDiv({ cls: "opc-review-stats" });
		const state = entry.state;
		const stat = (cls: string, text: string) => stats.createSpan({ cls: `opc-review-stat ${cls}`, text });
		stat("opc-review-count", t("flowchartReview.reviews", { count: state?.reps ?? 0 }));
		stat("opc-review-last", state ? t("flowchartReview.last", { when: t("flowchartReview.ago", { span: formatSpan(t, now - state.last) }) }) : t("flowchartReview.last", { when: t("flowchartReview.never") }));
		const next = !state ? t("flowchartReview.new") : state.due <= now ? t("flowchartReview.dueNow") : t("flowchartReview.next", { span: formatSpan(t, state.due - now) });
		stat(`opc-review-next${!state || state.due <= now ? " is-due" : ""}`, next);

		const actions = row.createDiv({ cls: "opc-review-row-actions" });
		const open = actions.createEl("button", { cls: "clickable-icon opc-review-open", attr: { "aria-label": t("flowchartReview.reveal") } });
		setIcon(open, "locate");
		setTooltip(open, t("flowchartReview.reveal"));
		open.addEventListener("click", () => {
			this.close();
			void this.host.reveal(chart);
		});
		const start = actions.createEl("button", { cls: "mod-cta opc-review-start", text: t("flowchartReview.start") });
		start.addEventListener("click", () => this.showQuiz(item));
		return row;
	}

	// ---------- quiz ----------

	private zoom = 1;

	showQuiz(item: { chart: Flowchart; entry: ChartEntry }): void {
		const t = this.host.t();
		const { chart, entry } = item;
		this.screen = "quiz";
		this.modalEl.addClass("is-quiz");
		this.setTitle(chartName(chart, entry, this.host.settings().nameWords));
		const { contentEl } = this;
		contentEl.empty();
		const squares = this.host.settings().squares;

		const top = contentEl.createDiv({ cls: "opc-review-quiz-bar" });
		const back = top.createEl("button", { cls: "opc-review-back", text: t("flowchartReview.back") });
		setIcon(back.createSpan({ cls: "opc-review-back-icon" }), "arrow-left");
		back.prepend(back.lastChild!);
		back.addEventListener("click", () => void this.showList());
		top.createSpan({ cls: "opc-review-hint", text: t("flowchartReview.hint") });
		const zoomBox = top.createDiv({ cls: "opc-review-zoom" });

		const board = contentEl.createDiv({ cls: "opc-review-board" });
		const stage = board.createDiv({ cls: "opc-review-stage" });
		const minX = Math.min(...chart.nodes.map((n) => n.x)) - PAD;
		const minY = Math.min(...chart.nodes.map((n) => n.y)) - PAD;
		const width = Math.max(...chart.nodes.map((n) => n.x + n.width)) - minX + PAD;
		const height = Math.max(...chart.nodes.map((n) => n.y + n.height)) - minY + PAD;
		stage.setCssProps({ "--opc-review-w": `${width}px`, "--opc-review-h": `${height}px` });
		const byId = new Map(chart.nodes.map((n) => [n.id, n]));

		// Edges below the cards.
		const svg = stage.createSvg("svg", { cls: "opc-review-edges", attr: { width: String(width), height: String(height), viewBox: `0 0 ${width} ${height}` } });
		const defs = svg.createSvg("defs");
		const marker = defs.createSvg("marker", { attr: { id: "opc-review-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "8", markerHeight: "8", orient: "auto-start-reverse" } });
		marker.createSvg("path", { attr: { d: "M0,0 L10,5 L0,10 z" } });
		for (const e of chart.edges) {
			const a = byId.get(e.from);
			const b = byId.get(e.to);
			if (!a || !b) continue;
			const { d, mid } = edgePath(a, b, e.fromSide, e.toSide, minX, minY);
			const path = svg.createSvg("path", { attr: { d } });
			if (e.toEnd === "arrow") path.setAttr("marker-end", "url(#opc-review-arrow)");
			if (e.fromEnd === "arrow") path.setAttr("marker-start", "url(#opc-review-arrow)");
			if (e.label) {
				const label = stage.createDiv({ cls: "opc-review-edge-label", text: e.label });
				label.setCssProps({ "--opc-review-x": `${mid.x}px`, "--opc-review-y": `${mid.y}px` });
			}
		}

		const drag = this.host.settings().answerMode === "drag";
		const fields: Field[] = [];
		for (const node of chart.nodes) {
			const card = stage.createDiv({ cls: "opc-review-card", attr: { "data-id": node.id } });
			card.setCssProps({ "--opc-review-x": `${node.x - minX}px`, "--opc-review-y": `${node.y - minY}px`, "--opc-review-cw": `${node.width}px`, "--opc-review-ch": `${node.height}px` });
			if (node.color) card.setCssProps({ "--opc-review-color": /^#/.test(node.color) ? node.color : `rgb(var(--canvas-color-${node.color}))` });
			const shape = !squares && isShape(node.shape) && node.shape !== "process" && node.shape !== "rectangle" ? node.shape : null;
			const inner = card.createDiv({ cls: "opc-review-card-inner" });
			if (shape) {
				card.addClass("has-shape");
				const g = shapeGeometry(shape, node.width, node.height);
				const outline = card.createSvg("svg", { cls: "opc-review-outline", attr: { viewBox: `0 0 ${node.width} ${node.height}`, width: String(node.width), height: String(node.height), preserveAspectRatio: "none" } });
				outline.createSvg("path", { attr: { d: g.d } });
				if (g.decoration) outline.createSvg("path", { cls: "opc-review-decoration", attr: { d: g.decoration } });
				card.prepend(outline);
				inner.setCssProps({ "--opc-inset-top": `${g.insets.top * node.height}px`, "--opc-inset-right": `${g.insets.right * node.width}px`, "--opc-inset-bottom": `${g.insets.bottom * node.height}px`, "--opc-inset-left": `${g.insets.left * node.width}px` });
			}
			if (isAsked(node)) {
				card.addClass("is-asked");
				if (drag) {
					const slot = inner.createDiv({ cls: "opc-review-slot" });
					fields.push({ node, card, inner, value: () => slot.querySelector(".opc-review-chip")?.textContent ?? "", clear: () => slot.remove() });
				} else {
					const input = inner.createEl("textarea", { cls: "opc-review-input", attr: { dir: "auto", "aria-label": t("flowchartReview.fill"), placeholder: "…" } });
					fields.push({ node, card, inner, value: () => input.value, clear: () => input.remove() });
				}
			} else {
				card.addClass("is-given");
				inner.createDiv({ cls: "opc-review-given", text: cardLabel(node), attr: { dir: "auto" } });
			}
		}

		const setZoom = (z: number) => {
			this.zoom = Math.min(2, Math.max(0.2, z));
			stage.setCssProps({ "--opc-review-zoom": String(this.zoom) });
		};
		const fit = () => {
			const r = board.getBoundingClientRect();
			setZoom(Math.min(1, (r.width - 8) / width, (r.height - 8) / height) || 1);
		};
		const zb = (icon: string, label: I18nKey, fn: () => void) => {
			const b = zoomBox.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t(label) } });
			setIcon(b, icon);
			setTooltip(b, t(label));
			b.addEventListener("click", fn);
		};
		zb("zoom-out", "flowchartReview.zoomOut", () => setZoom(this.zoom / 1.25));
		zb("maximize", "flowchartReview.zoomFit", fit);
		zb("zoom-in", "flowchartReview.zoomIn", () => setZoom(this.zoom * 1.25));
		board.addEventListener(
			"wheel",
			(evt) => {
				if (!evt.ctrlKey && !evt.metaKey) return;
				evt.preventDefault();
				setZoom(this.zoom * (evt.deltaY < 0 ? 1.1 : 1 / 1.1));
			},
			{ passive: false },
		);
		setZoom(1);
		if (drag) {
			top.querySelector(".opc-review-hint")?.setText(t("flowchartReview.hintDrag"));
			this.answerBank(contentEl.createDiv({ cls: "opc-review-bank" }), stage, fields);
		}
		window.requestAnimationFrame(() => {
			fit();
			contentEl.querySelector<HTMLElement>(".opc-review-input")?.focus({ preventScroll: true });
		});

		const foot = contentEl.createDiv({ cls: "opc-review-foot" });
		const submit = foot.createEl("button", { cls: "mod-cta opc-review-submit", text: t("flowchartReview.submit") });
		const doSubmit = () => {
			this.submitKey = null;
			this.submitted(item, fields, foot);
		};
		submit.addEventListener("click", doSubmit);
		this.submitKey = doSubmit;
	}

	/**
	 * The texts of the asked cards, shuffled, below the chart. Drag one onto a card (mouse, finger
	 * or pen), or tap it and then tap a card. A card holds one answer: dropping another sends the
	 * first back. Tapping an answer on a card and then the bank (or dragging it off) takes it back.
	 */
	private answerBank(bank: HTMLElement, stage: HTMLElement, fields: Field[]): void {
		const chips = shuffle(fields.map((f) => cardLabel(f.node))).map((text, i) => bank.createDiv({ cls: "opc-review-chip", text, attr: { "data-chip": String(i), dir: "auto", tabindex: "0", role: "button" } }));
		let picked: HTMLElement | null = null;
		const pick = (chip: HTMLElement | null) => {
			picked?.removeClass("is-picked");
			picked = chip;
			picked?.addClass("is-picked");
			stage.toggleClass("is-picking", !!picked);
		};
		const slotOf = (card: Element | null) => card?.closest(".opc-review-card.is-asked")?.querySelector<HTMLElement>(".opc-review-slot") ?? null;
		const place = (chip: HTMLElement, slot: HTMLElement | null) => {
			if (slot) {
				const old = slot.querySelector<HTMLElement>(".opc-review-chip");
				if (old && old !== chip) bank.appendChild(old);
				slot.appendChild(chip);
			} else bank.appendChild(chip);
			for (const f of fields) f.card.toggleClass("is-filled", !!f.card.querySelector(".opc-review-slot .opc-review-chip"));
			pick(null);
		};
		/** Ends a drag whose release never came (the next press starts clean). */
		let abandon: (() => void) | null = null;
		for (const chip of chips) {
			chip.addEventListener("pointerdown", (down) => {
				if (down.button !== 0) return;
				down.preventDefault();
				down.stopPropagation();
				abandon?.();
				// The release reaches the answer wherever the pointer is.
				try {
					chip.setPointerCapture(down.pointerId);
				} catch {
					/* the pointer is already gone */
				}
				let ghost: HTMLElement | null = null;
				const move = (evt: PointerEvent) => {
					if (evt.pointerId !== down.pointerId) return;
					if (!ghost && Math.hypot(evt.clientX - down.clientX, evt.clientY - down.clientY) < 6) return;
					if (!ghost) {
						ghost = activeDocument.body.createDiv({ cls: "opc-review-chip opc-review-ghost", text: chip.textContent ?? "" });
						chip.addClass("is-dragging");
					}
					ghost.setCssStyles({ left: `${evt.clientX}px`, top: `${evt.clientY}px` });
					stage.querySelectorAll(".is-drop").forEach((el) => el.removeClass("is-drop"));
					activeDocument.elementFromPoint(evt.clientX, evt.clientY)?.closest(".opc-review-card.is-asked")?.addClass("is-drop");
				};
				const stop = () => {
					activeWindow.removeEventListener("pointermove", move);
					activeWindow.removeEventListener("pointerup", up);
					activeWindow.removeEventListener("pointercancel", up);
					stage.querySelectorAll(".is-drop").forEach((el) => el.removeClass("is-drop"));
					chip.removeClass("is-dragging");
					ghost?.remove();
					abandon = null;
				};
				const up = (evt: PointerEvent) => {
					if (evt.pointerId !== down.pointerId) return;
					const dragged = !!ghost;
					stop();
					if (chip.hasPointerCapture(evt.pointerId)) chip.releasePointerCapture(evt.pointerId);
					if (!dragged) {
						// A tap: pick it (or let go of it); a tap on a picked one on a card puts it back.
						if (picked === chip && chip.parentElement !== bank) place(chip, null);
						else pick(picked === chip ? null : chip);
						return;
					}
					if (evt.type === "pointercancel") return;
					place(chip, slotOf(activeDocument.elementFromPoint(evt.clientX, evt.clientY)));
				};
				abandon = stop;
				activeWindow.addEventListener("pointermove", move);
				activeWindow.addEventListener("pointerup", up);
				activeWindow.addEventListener("pointercancel", up);
			});
			// The tap is handled on pointerup; its click must not reach the card under it.
			chip.addEventListener("click", (evt) => evt.stopPropagation());
			chip.addEventListener("keydown", (evt) => {
				if (evt.key !== "Enter" && evt.key !== " ") return;
				evt.preventDefault();
				pick(picked === chip ? null : chip);
			});
		}
		// Tap a card (or the bank) while an answer is picked.
		for (const f of fields)
			f.card.addEventListener("click", () => {
				if (picked) place(picked, slotOf(f.card));
			});
		bank.addEventListener("click", (evt) => {
			if (picked && evt.target === bank) place(picked, null);
		});
	}

	private submitted(item: { chart: Flowchart; entry: ChartEntry }, fields: Field[], foot: HTMLElement): void {
		const t = this.host.t();
		const drag = !!this.contentEl.querySelector(".opc-review-bank");
		let score = 0;
		const counts: Record<Grade, number> = { correct: 0, close: 0, wrong: 0 };
		for (const f of fields) {
			const written = f.value().trim();
			// A dragged answer is the text of a card: it is right only when it is this card's text.
			const g: Grade = drag ? (written && normalizeAnswer(written) === normalizeAnswer(cardLabel(f.node)) ? "correct" : "wrong") : grade(written, f.node.text);
			counts[g]++;
			score += g === "correct" ? 1 : g === "close" ? 0.5 : 0;
			f.card.addClass(`is-${g}`);
			f.clear();
			if (g !== "correct") f.inner.createDiv({ cls: "opc-review-yours", text: written || t("flowchartReview.blank"), attr: { dir: "auto" } });
			f.inner.createDiv({ cls: "opc-review-correct", text: cardLabel(f.node), attr: { dir: "auto" } });
		}
		this.contentEl.querySelector(".opc-review-bank")?.remove();
		this.contentEl.querySelector(".opc-review-hint")?.empty();
		const ratio = fields.length ? score / fields.length : 1;
		foot.empty();
		foot.addClass("is-done");
		const summary = foot.createDiv({ cls: "opc-review-score" });
		summary.createSpan({ cls: "opc-review-score-main", text: t("flowchartReview.score", { correct: counts.correct, total: fields.length }) });
		if (counts.close) summary.createSpan({ cls: "opc-review-score-close", text: t("flowchartReview.close", { count: counts.close }) });
		summary.createSpan({ cls: "opc-review-score-ask", text: t("flowchartReview.ask") });
		const buttons = foot.createDiv({ cls: "opc-review-rates" });
		const now = Date.now();
		const outcomes = preview(item.entry.state ?? null, now);
		const suggested: Rating = ratio < 0.5 ? 1 : ratio < 0.8 ? 2 : 3;
		for (const r of RATINGS) {
			const b = buttons.createEl("button", { cls: `opc-review-rate opc-review-rate-${r}`, attr: { "data-rating": String(r) } });
			b.createSpan({ cls: "opc-review-rate-name", text: t(RATING_KEYS[r]) });
			b.createSpan({ cls: "opc-review-rate-when", text: formatSpan(t, outcomes[r].due - now) });
			if (r === suggested) b.addClass("is-suggested");
			b.addEventListener("click", () => {
				buttons.querySelectorAll("button").forEach((x) => (x.disabled = true));
				void this.host.rate(item.chart, outcomes[r]).then(() => {
					new Notice(t("flowchartReview.saved", { span: formatSpan(t, outcomes[r].due - now) }));
					void this.showList();
				});
			});
		}
		const again = foot.createEl("button", { cls: "opc-review-retry", text: t("flowchartReview.retry") });
		again.addEventListener("click", () => this.showQuiz(item));
	}
}

/** A copy in random order (Fisher-Yates). */
export function shuffle<T>(list: readonly T[], random: () => number = Math.random): T[] {
	const out = [...list];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

const dueOf = (entry: ChartEntry, now: number) => (entry.state ? entry.state.due : now);

/** Where an edge leaves a card: the middle of a side (given, or the side facing the other card). */
function anchor(n: ChartNode, other: ChartNode, side: EdgeSide | undefined): { x: number; y: number; side: EdgeSide } {
	let s = side;
	if (!s) {
		const dx = other.x + other.width / 2 - (n.x + n.width / 2);
		const dy = other.y + other.height / 2 - (n.y + n.height / 2);
		s = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
	}
	const p = s === "top" ? { x: n.x + n.width / 2, y: n.y } : s === "bottom" ? { x: n.x + n.width / 2, y: n.y + n.height } : s === "left" ? { x: n.x, y: n.y + n.height / 2 } : { x: n.x + n.width, y: n.y + n.height / 2 };
	return { ...p, side: s };
}

const NORMAL: Record<EdgeSide, { x: number; y: number }> = { top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };

/** A curve like the canvas draws: out of each side along its normal. */
function edgePath(a: ChartNode, b: ChartNode, fromSide: EdgeSide | undefined, toSide: EdgeSide | undefined, ox: number, oy: number): { d: string; mid: { x: number; y: number } } {
	const p = anchor(a, b, fromSide);
	const q = anchor(b, a, toSide);
	const dist = Math.hypot(q.x - p.x, q.y - p.y);
	const k = Math.min(150, Math.max(30, dist / 2));
	const c1 = { x: p.x + NORMAL[p.side].x * k, y: p.y + NORMAL[p.side].y * k };
	const c2 = { x: q.x + NORMAL[q.side].x * k, y: q.y + NORMAL[q.side].y * k };
	const f = (v: number) => Math.round(v * 10) / 10;
	const d = `M${f(p.x - ox)},${f(p.y - oy)} C${f(c1.x - ox)},${f(c1.y - oy)} ${f(c2.x - ox)},${f(c2.y - oy)} ${f(q.x - ox)},${f(q.y - oy)}`;
	const mid = { x: (p.x + 3 * c1.x + 3 * c2.x + q.x) / 8 - ox, y: (p.y + 3 * c1.y + 3 * c2.y + q.y) / 8 - oy };
	return { d, mid };
}
