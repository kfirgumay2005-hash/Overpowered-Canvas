import { FuzzySuggestModal, Modal, Notice, Setting, sanitizeHTMLToDom, setIcon, setTooltip, type App, type Command, type Menu } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { commandRunner } from "../../internals/app";
import type { CanvasLike, CanvasMenuLike } from "../../internals/types";
import { BARS_TUTORIAL, TUTORIAL_KEY } from "../../tutorials/runner";
import { IconPickerModal } from "../../ui/icon-picker";
import { isImageCard, randomId } from "../shared";
import { isNode } from "../../core/canvas-ui";
import { BARS, buttonKeys, buttonLabel, customKey, hiddenKey, isPopupBar, orderOf, popupFor, sanitizeBarSettings, sortKeys, type Bar, type BarButtonsSettings, type CustomButton } from "./logic";

type Ctx = ModuleContext<BarButtonsSettings>;

const HIDDEN = "opc-bar-hidden";
const CUSTOM = "opc-bar-custom";
const CUSTOM_GROUP = "opc-bar-custom-group";
/** Module buttons mounted later stay before the added ones (see CanvasUi.mountCardButton). */
const LAST_ORDER = "100000";

interface BarButton {
	el: HTMLElement;
	key: string;
	label: string;
}

/** A row of the list: a button of a bar, or a command added to it. */
interface Row {
	key: string;
	label: string;
	icon: (el: HTMLElement) => void;
	custom?: CustomButton;
}

/**
 * The popup over a selection is built again for every selection, with the buttons that fit it:
 * the buttons each popup (over any selection, over images) has shown are remembered (for this
 * session) so the list can name them all.
 */
const popupSeen = new Map<Bar, Map<string, { label: string; svg: string }>>();
const seenOn = (bar: Bar) => {
	let seen = popupSeen.get(bar);
	if (!seen) popupSeen.set(bar, (seen = new Map<string, { label: string; svg: string }>()));
	return seen;
};

/** The popup the current selection gets: over images when only image cards are selected. */
function popupOf(canvas: CanvasLike): Bar {
	return popupFor([...canvas.selection].map((item) => ({ image: isNode(item) && isImageCard(item) })));
}

const classes = (el: Element | null | undefined) => (el ? [...el.classList] : []);

/** The buttons of a bar as they stand, without the added ones. */
function buttonsOf(canvas: CanvasLike, bar: Bar): BarButton[] {
	const els =
		bar === "bottom"
			? [...canvas.cardMenuEl.querySelectorAll<HTMLElement>(`:scope > .canvas-card-menu-button:not(.${CUSTOM})`)]
			: bar === "side"
				? [...canvas.canvasControlsEl.querySelectorAll<HTMLElement>(`:scope > .canvas-control-group:not(.${CUSTOM_GROUP}) > .canvas-control-item`)]
				: [...(canvas.menu?.menuEl.querySelectorAll<HTMLElement>(`:scope > .clickable-icon:not(.${CUSTOM})`) ?? [])];
	const labels = els.map((el) => el.getAttribute("aria-label") ?? "");
	const keys = buttonKeys(
		els.map((el, i) => {
			const icon = classes(el.querySelector("svg"));
			return { classes: classes(el), groupClasses: bar === "side" ? classes(el.parentElement) : [], iconClasses: icon, label: labels[i]!, ...(isPopupBar(bar) ? { iconName: icon.find((c) => c !== "svg-icon") } : {}) };
		}),
	);
	return els.map((el, i) => ({ el, key: keys[i]!, label: buttonLabel(labels[i]!) || keys[i]! }));
}

/** Runs a command for this canvas, as if it had been picked from the palette there. */
function run(ctx: Ctx, canvas: CanvasLike, button: CustomButton): void {
	ctx.app.workspace.setActiveLeaf(canvas.view.leaf, { focus: true });
	if (!commandRunner(ctx.app)?.executeCommandById(button.command)) new Notice(ctx.t("barButtons.unavailable", { name: button.name }));
}

/** Hidden keys that apply on this canvas: tutorials point at the buttons, so their boards keep all of them (but the one about this module). */
function hiddenOn(ctx: Ctx, canvas: CanvasLike): Set<string> {
	const tutorial = canvas.view.file ? (canvas.getData() as unknown as Record<string, unknown>)[TUTORIAL_KEY] : undefined;
	return new Set(tutorial !== undefined && tutorial !== BARS_TUTORIAL ? [] : ctx.settings.hidden);
}

/**
 * The popup over a selection, as set: buttons taken off are hidden, added commands come last.
 * A selection of images only gets the image popup's settings. Runs after every rebuild of the
 * popup (each selection).
 */
function applyToPopup(ctx: Ctx, menu: CanvasMenuLike): void {
	const canvas = menu.canvas;
	const el = menu.menuEl;
	if (!el.isConnected || canvas.selection.size === 0) return;
	const bar = popupOf(canvas);
	el.querySelectorAll(`:scope > .${CUSTOM}`).forEach((b) => b.remove());
	const hidden = hiddenOn(ctx, canvas);
	for (const b of buttonsOf(canvas, bar)) {
		seenOn(bar).set(b.key, { label: b.label, svg: b.el.querySelector("svg")?.outerHTML ?? "" });
		b.el.toggleClass(HIDDEN, hidden.has(hiddenKey(bar, b.key)));
	}
	for (const button of ctx.settings.custom) {
		if (button.bar !== bar) continue;
		const b = el.createEl("button", { cls: `clickable-icon ${CUSTOM}`, attr: { "aria-label": button.name, "data-opc-custom": button.id } });
		setIcon(b, button.icon);
		setTooltip(b, button.name, { placement: "top" });
		b.addEventListener("click", () => run(ctx, canvas, button));
	}
	applyOrder(ctx, canvas, bar);
	// Centered again over the selection, with its new width.
	menu.render(false);
}

function mountCustom(ctx: Ctx, canvas: CanvasLike): void {
	canvas.wrapperEl.querySelectorAll(`.canvas-card-menu .${CUSTOM}, .canvas-controls .${CUSTOM}, .${CUSTOM_GROUP}`).forEach((el) => el.remove());
	const side = ctx.settings.custom.filter((b) => b.bar === "side");
	const group = side.length ? canvas.canvasControlsEl.createDiv({ cls: `canvas-control-group mod-raised ${CUSTOM_GROUP}` }) : null;
	for (const button of ctx.settings.custom) {
		if (isPopupBar(button.bar)) continue;
		const el = button.bar === "side" ? group!.createDiv({ cls: `canvas-control-item ${CUSTOM}` }) : canvas.cardMenuEl.createDiv({ cls: `canvas-card-menu-button opc-card-button ${CUSTOM}` });
		if (button.bar === "bottom") el.dataset.opcOrder = LAST_ORDER;
		el.dataset.opcCustom = button.id;
		setIcon(el, button.icon);
		setTooltip(el, button.name, { placement: button.bar === "side" ? "left" : "top" });
		el.setAttribute("aria-label", button.name);
		el.addEventListener("click", () => run(ctx, canvas, button));
	}
}

/**
 * The order chosen for a bar, with CSS `order` (the bars are flex boxes): the app's own elements
 * stay where they are. On the side bar a group of buttons stays together, placed by its first one.
 */
function applyOrder(ctx: Ctx, canvas: CanvasLike, bar: Bar): void {
	const saved = ctx.settings.order[bar];
	const entries = [...buttonsOf(canvas, bar).map((b) => ({ key: b.key, el: b.el })), ...customEls(canvas, bar).map((el) => ({ key: customKey(el.dataset.opcCustom ?? ""), el }))];
	entries.forEach((e, natural) => e.el.setCssProps({ order: saved ? String(orderOf(e.key, natural, saved)) : "" }));
	if (bar !== "side") return;
	for (const group of Array.from(canvas.canvasControlsEl.children) as HTMLElement[]) {
		const orders = (Array.from(group.children) as HTMLElement[]).map((c) => Number(c.style.order)).filter((n) => Number.isFinite(n) && n > 0);
		group.setCssProps({ order: saved && orders.length ? String(Math.min(...orders)) : "" });
	}
}

/** The added buttons of a bar, as they stand. */
function customEls(canvas: CanvasLike, bar: Bar): HTMLElement[] {
	const root = bar === "bottom" ? canvas.cardMenuEl : bar === "side" ? canvas.canvasControlsEl : popupOf(canvas) === bar ? canvas.menu?.menuEl : null;
	return root ? (Array.from(root.querySelectorAll<HTMLElement>(`.${CUSTOM}[data-opc-custom]`))) : [];
}

/** Puts the settings on one canvas. Safe to repeat: it changes the bars only when they differ. */
function applyTo(ctx: Ctx, canvas: CanvasLike, mounted: WeakMap<CanvasLike, string>): void {
	const shape = JSON.stringify(ctx.settings.custom);
	if (mounted.get(canvas) !== shape) {
		mounted.set(canvas, shape);
		mountCustom(ctx, canvas);
	}
	const hidden = hiddenOn(ctx, canvas);
	for (const bar of BARS) if (!isPopupBar(bar)) for (const b of buttonsOf(canvas, bar)) b.el.toggleClass(HIDDEN, hidden.has(hiddenKey(bar, b.key)));
	// A group or a bar with nothing left in it goes too.
	for (const group of canvas.canvasControlsEl.querySelectorAll<HTMLElement>(":scope > .canvas-control-group")) group.toggleClass(HIDDEN, group.childElementCount > 0 && [...group.children].every((c) => c.hasClass(HIDDEN)));
	canvas.cardMenuEl.toggleClass(HIDDEN, [...canvas.cardMenuEl.children].every((c) => c.hasClass(HIDDEN)));
	applyOrder(ctx, canvas, "bottom");
	applyOrder(ctx, canvas, "side");
	// Modules add their side groups after ours: the added buttons stay last.
	const group = canvas.canvasControlsEl.querySelector(`:scope > .${CUSTOM_GROUP}`);
	if (group && group.nextElementSibling) canvas.canvasControlsEl.appendChild(group);
}

/** Lists every command of the app: its own, this plugin's and other plugins'. */
class CommandSuggest extends FuzzySuggestModal<Command> {
	constructor(
		app: App,
		placeholder: string,
		private readonly commands: Command[],
		private readonly onPick: (command: Command) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): Command[] {
		return this.commands;
	}

	getItemText(command: Command): string {
		return command.name;
	}

	onChooseItem(command: Command): void {
		this.onPick(command);
	}
}

/** The bars as lists: a switch for each button, added commands with their name and icon. */
class BarsModal extends Modal {
	constructor(
		private readonly ctx: Ctx,
		private readonly canvas: CanvasLike,
	) {
		super(ctx.app);
	}

	override onOpen(): void {
		this.setTitle(this.ctx.t("barButtons.edit.name"));
		this.modalEl.addClass("opc-bars-modal");
		this.render();
	}

	override onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { ctx, contentEl } = this;
		const top = contentEl.scrollTop;
		contentEl.empty();
		for (const bar of BARS) {
			new Setting(contentEl).setName(ctx.t(bar === "bottom" ? "barButtons.bottom" : bar === "side" ? "barButtons.side" : bar === "popup" ? "barButtons.popup" : "barButtons.image")).setHeading();
			const rows = this.rowsOf(bar);
			const keys = sortKeys(
				rows.map((r) => r.key),
				ctx.settings.order[bar],
			);
			const byKey = new Map(rows.map((r) => [r.key, r]));
			const list = contentEl.createDiv({ cls: "opc-bars-list" });
			for (const key of keys) this.row(list, bar, byKey.get(key)!);
			this.dragToOrder(list, bar);
			if (bar === "popup") new Setting(contentEl).setDesc(ctx.t("barButtons.popupHint"));
			if (bar === "image") new Setting(contentEl).setDesc(ctx.t("barButtons.imageHint"));
			new Setting(contentEl).addButton((button) => button.setButtonText(ctx.t("barButtons.add")).onClick(() => this.addTo(bar)));
		}
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(ctx.t("barButtons.restore"))
				.setDestructive()
				.onClick(() => void this.save({ hidden: [], custom: [], order: {} })),
		);
		contentEl.scrollTop = top;
	}

	private async save(patch: Partial<BarButtonsSettings>): Promise<void> {
		await this.ctx.updateSettings(patch);
		this.render();
	}

	private rowIcon(row: Setting, draw: (el: HTMLElement) => void): void {
		const icon = createSpan({ cls: "opc-bars-icon" });
		draw(icon);
		row.nameEl.prepend(icon);
	}

	/**
	 * The rows of a bar: its buttons and the commands added to it. The popup shows only the
	 * buttons that fit what is selected, so its list names those it has shown since Obsidian
	 * started, and those taken off.
	 */
	private rowsOf(bar: Bar): Row[] {
		const { ctx } = this;
		const rows: Row[] = [];
		if (isPopupBar(bar)) {
			// What the popup shows right now, if something is selected.
			if (this.canvas.selection.size && popupOf(this.canvas) === bar)
				for (const b of buttonsOf(this.canvas, bar)) seenOn(bar).set(b.key, { label: b.label, svg: b.el.querySelector("svg")?.outerHTML ?? "" });
			const keys = new Set(seenOn(bar).keys());
			for (const k of ctx.settings.hidden) if (k.startsWith(`${bar}:`)) keys.add(k.slice(bar.length + 1));
			for (const key of keys) {
				const seen = seenOn(bar).get(key);
				rows.push({
					key,
					label: seen?.label ?? key,
					icon: (el) => {
						if (seen?.svg) el.appendChild(sanitizeHTMLToDom(seen.svg));
					},
				});
			}
		} else
			for (const b of buttonsOf(this.canvas, bar)) {
				const svg = b.el.querySelector("svg");
				rows.push({
					key: b.key,
					label: b.label,
					icon: (el) => {
						if (svg) el.appendChild(svg.cloneNode(true));
					},
				});
			}
		for (const c of ctx.settings.custom) if (c.bar === bar) rows.push({ key: customKey(c.id), label: c.name, icon: (el) => setIcon(el, c.icon), custom: c });
		return rows;
	}

	/** One button: a handle to drag it up or down, then a switch (or, for an added one, change and remove). */
	private row(list: HTMLElement, bar: Bar, r: Row): void {
		const { ctx } = this;
		const row = new Setting(list).setName(r.label);
		row.settingEl.addClass("opc-bars-row");
		row.settingEl.dataset.key = r.key;
		this.rowIcon(row, r.icon);
		const grip = createSpan({ cls: "opc-bars-grip", attr: { "aria-label": ctx.t("barButtons.drag") } });
		setIcon(grip, "grip-vertical");
		setTooltip(grip, ctx.t("barButtons.drag"));
		row.nameEl.prepend(grip);
		const custom = r.custom;
		if (custom) {
			row.addExtraButton((button) =>
				button
					.setIcon("pencil")
					.setTooltip(ctx.t("barButtons.change"))
					.onClick(() => this.pickLook(custom.name, custom.icon, (name, icon) => void this.save({ custom: ctx.settings.custom.map((c) => (c.id === custom.id ? { ...c, name, icon } : c)) }))),
			);
			row.addExtraButton((button) =>
				button
					.setIcon("trash-2")
					.setTooltip(ctx.t("barButtons.remove"))
					.onClick(() => void this.save({ custom: ctx.settings.custom.filter((c) => c.id !== custom.id) })),
			);
			return;
		}
		const key = hiddenKey(bar, r.key);
		row.addToggle((toggle) =>
			toggle
				.setTooltip(ctx.t("barButtons.show"))
				.setValue(!ctx.settings.hidden.includes(key))
				.onChange((shown) => void ctx.updateSettings({ hidden: shown ? ctx.settings.hidden.filter((k) => k !== key) : [...ctx.settings.hidden, key] })),
		);
	}

	/**
	 * Drag a row by its handle, up or down (mouse, finger or pen): the row moves along while
	 * dragging, and the bar takes the new order when it is let go.
	 */
	private dragToOrder(list: HTMLElement, bar: Bar): void {
		let drag: { row: HTMLElement; pointer: number; startKeys: string[] } | null = null;
		const keys = () => (Array.from(list.children) as HTMLElement[]).map((el) => el.dataset.key ?? "").filter(Boolean);
		list.addEventListener("pointerdown", (evt) => {
			const grip = (evt.target as HTMLElement | null)?.closest?.(".opc-bars-grip");
			const row = grip?.closest<HTMLElement>(".opc-bars-row");
			if (!grip || !row || (evt.pointerType === "mouse" && evt.button !== 0)) return;
			evt.preventDefault();
			drag = { row, pointer: evt.pointerId, startKeys: keys() };
			row.addClass("is-dragging");
			try {
				list.setPointerCapture(evt.pointerId);
			} catch {
				// The drag still works while the pointer stays over the list.
			}
		});
		list.addEventListener("pointermove", (evt) => {
			const d = drag;
			if (!d || evt.pointerId !== d.pointer) return;
			evt.preventDefault();
			// The row goes before the first row whose middle is below the pointer.
			const others = (Array.from(list.children) as HTMLElement[]).filter((el) => el !== d.row);
			const before = others.find((el) => {
				const r = el.getBoundingClientRect();
				return evt.clientY < r.top + r.height / 2;
			});
			if (before) {
				if (d.row.nextElementSibling !== before) list.insertBefore(d.row, before);
			} else if (list.lastElementChild !== d.row) list.appendChild(d.row);
		});
		const end = (evt: PointerEvent) => {
			const d = drag;
			if (!d || evt.pointerId !== d.pointer) return;
			drag = null;
			d.row.removeClass("is-dragging");
			const next = keys();
			if (next.join("\n") !== d.startKeys.join("\n")) void this.save({ order: { ...this.ctx.settings.order, [bar]: next } });
		};
		list.addEventListener("pointerup", end);
		list.addEventListener("pointercancel", end);
	}

	private pickLook(name: string, icon: string, done: (name: string, icon: string) => void): void {
		new IconPickerModal(this.ctx.app, this.ctx.t, { title: this.ctx.t("barButtons.look"), name, icon }, (r) => done(r.name, r.icon)).open();
	}

	private addTo(bar: Bar): void {
		const { ctx } = this;
		const commands = commandRunner(ctx.app)?.listCommands() ?? [];
		new CommandSuggest(ctx.app, ctx.t("barButtons.pick"), commands, (command) =>
			this.pickLook(command.name, command.icon ?? "lucide-terminal", (name, icon) => void this.save({ custom: [...ctx.settings.custom, { id: randomId(8), bar, command: command.id, icon, name }] })),
		).open();
	}
}

/**
 * The bottom bar, the side bar and the popup over a selection, your way: any button can be taken
 * off, and any command of the app (its own, this plugin's or another plugin's) can be added as a
 * button.
 */
export const barButtonsModule = defineModule<BarButtonsSettings>({
	id: "bar-buttons",
	name: "barButtons.name",
	description: "barButtons.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: { hidden: [], custom: [], order: {} },
	sanitizeSettings: (raw) => sanitizeBarSettings(raw),

	enable(ctx) {
		const mounted = new WeakMap<CanvasLike, string>();
		ctx.onCanvas((canvas) => {
			const apply = () => applyTo(ctx, canvas, mounted);
			apply();
			// Modules and other plugins add their buttons at their own pace.
			const observer = new MutationObserver(apply);
			observer.observe(canvas.cardMenuEl, { childList: true });
			observer.observe(canvas.canvasControlsEl, { childList: true, subtree: true });
			return () => {
				observer.disconnect();
				canvas.wrapperEl.querySelectorAll(`.${CUSTOM}, .${CUSTOM_GROUP}`).forEach((el) => el.remove());
				canvas.wrapperEl.querySelectorAll(`.${HIDDEN}`).forEach((el) => el.removeClass(HIDDEN));
				mounted.delete(canvas);
				if (canvas.selection.size) canvas.menu?.render(true);
			};
		});
		ctx.on("data-load", (canvas) => applyTo(ctx, canvas, mounted));
		// After the other modules have put their buttons in the popup.
		ctx.on("menu-render", (menu) => queueMicrotask(() => applyToPopup(ctx, menu)));
		ctx.onSettingsChange(() => {
			for (const canvas of ctx.canvases()) {
				applyTo(ctx, canvas, mounted);
				if (canvas.selection.size) canvas.menu?.render(true);
			}
		});
		// The menu of the settings button on the side bar, where people look for this.
		const patched = new WeakSet<object>();
		ctx.onCanvas((canvas) => {
			const proto = Object.getPrototypeOf(canvas) as CanvasLike;
			if (patched.has(proto)) return;
			patched.add(proto);
			ctx.patch("canvas.showQuickSettingsMenu (bars)", proto, {
				showQuickSettingsMenu: (next) =>
					function (this: CanvasLike, menu: Menu) {
						next.call(this, menu);
						menu.addItem((item) =>
							item
								.setSection("canvas")
								.setTitle(ctx.t("barButtons.edit.name"))
								.setIcon("sliders-horizontal")
								.onClick(() => new BarsModal(ctx, this).open()),
						);
					},
			});
		});
		ctx.addCommand({
			id: "customize",
			name: ctx.t("barButtons.edit.name"),
			icon: "sliders-horizontal",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas) return false;
				if (!checking) new BarsModal(ctx, canvas).open();
				return true;
			},
		});
	},

	renderSettings(el, ctx) {
		new Setting(el)
			.setName(ctx.t("barButtons.edit.name"))
			.setDesc(ctx.t("barButtons.edit.desc"))
			.addButton((b) =>
				b.setButtonText(ctx.t("barButtons.edit")).onClick(() => {
					const canvas = ctx.activeCanvas() ?? ctx.canvases()[0];
					if (canvas) new BarsModal(ctx, canvas).open();
					else new Notice(ctx.t("barButtons.noCanvas"));
				}),
			);
	},
});
