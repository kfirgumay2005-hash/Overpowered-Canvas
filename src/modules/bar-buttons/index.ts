import { FuzzySuggestModal, Modal, Notice, Setting, setIcon, setTooltip, type App, type Command, type Menu } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import { commandRunner } from "../../internals/app";
import type { CanvasLike } from "../../internals/types";
import { TUTORIAL_KEY } from "../../tutorials/runner";
import { IconPickerModal } from "../../ui/icon-picker";
import { randomId } from "../shared";
import { BARS, buttonKeys, buttonLabel, hiddenKey, sanitizeBarSettings, type Bar, type BarButtonsSettings, type CustomButton } from "./logic";

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

const classes = (el: Element | null | undefined) => (el ? [...el.classList] : []);

/** The buttons of a bar as they stand, without the added ones. */
function buttonsOf(canvas: CanvasLike, bar: Bar): BarButton[] {
	const els =
		bar === "bottom"
			? [...canvas.cardMenuEl.querySelectorAll<HTMLElement>(`:scope > .canvas-card-menu-button:not(.${CUSTOM})`)]
			: [...canvas.canvasControlsEl.querySelectorAll<HTMLElement>(`:scope > .canvas-control-group:not(.${CUSTOM_GROUP}) > .canvas-control-item`)];
	const labels = els.map((el) => el.getAttribute("aria-label") ?? "");
	const keys = buttonKeys(els.map((el, i) => ({ classes: classes(el), groupClasses: bar === "side" ? classes(el.parentElement) : [], iconClasses: classes(el.querySelector("svg")), label: labels[i]! })));
	return els.map((el, i) => ({ el, key: keys[i]!, label: buttonLabel(labels[i]!) || keys[i]! }));
}

/** Runs a command for this canvas, as if it had been picked from the palette there. */
function run(ctx: Ctx, canvas: CanvasLike, button: CustomButton): void {
	ctx.app.workspace.setActiveLeaf(canvas.view.leaf, { focus: true });
	if (!commandRunner(ctx.app)?.executeCommandById(button.command)) new Notice(ctx.t("barButtons.unavailable", { name: button.name }));
}

function mountCustom(ctx: Ctx, canvas: CanvasLike): void {
	canvas.wrapperEl.querySelectorAll(`.${CUSTOM}, .${CUSTOM_GROUP}`).forEach((el) => el.remove());
	const side = ctx.settings.custom.filter((b) => b.bar === "side");
	const group = side.length ? canvas.canvasControlsEl.createDiv({ cls: `canvas-control-group mod-raised ${CUSTOM_GROUP}` }) : null;
	for (const button of ctx.settings.custom) {
		const el = button.bar === "side" ? group!.createDiv({ cls: `canvas-control-item ${CUSTOM}` }) : canvas.cardMenuEl.createDiv({ cls: `canvas-card-menu-button opc-card-button ${CUSTOM}` });
		if (button.bar === "bottom") el.dataset.opcOrder = LAST_ORDER;
		setIcon(el, button.icon);
		setTooltip(el, button.name, { placement: button.bar === "side" ? "left" : "top" });
		el.setAttribute("aria-label", button.name);
		el.addEventListener("click", () => run(ctx, canvas, button));
	}
}

/** Puts the settings on one canvas. Safe to repeat: it changes the bars only when they differ. */
function applyTo(ctx: Ctx, canvas: CanvasLike, mounted: WeakMap<CanvasLike, string>): void {
	const shape = JSON.stringify(ctx.settings.custom);
	if (mounted.get(canvas) !== shape) {
		mounted.set(canvas, shape);
		mountCustom(ctx, canvas);
	}
	// Tutorials point at the buttons, so their boards keep all of them.
	const tutorial = !!canvas.view.file && TUTORIAL_KEY in (canvas.getData() as unknown as Record<string, unknown>);
	const hidden = new Set(tutorial ? [] : ctx.settings.hidden);
	for (const bar of BARS) for (const b of buttonsOf(canvas, bar)) b.el.toggleClass(HIDDEN, hidden.has(hiddenKey(bar, b.key)));
	// A group or a bar with nothing left in it goes too.
	for (const group of canvas.canvasControlsEl.querySelectorAll<HTMLElement>(":scope > .canvas-control-group")) group.toggleClass(HIDDEN, group.childElementCount > 0 && [...group.children].every((c) => c.hasClass(HIDDEN)));
	canvas.cardMenuEl.toggleClass(HIDDEN, [...canvas.cardMenuEl.children].every((c) => c.hasClass(HIDDEN)));
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

/** Both bars as lists: a switch for each button, added commands with their name and icon. */
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
			new Setting(contentEl).setName(ctx.t(bar === "bottom" ? "barButtons.bottom" : "barButtons.side")).setHeading();
			for (const b of buttonsOf(this.canvas, bar)) this.buttonRow(bar, b);
			for (const b of ctx.settings.custom) if (b.bar === bar) this.customRow(b);
			new Setting(contentEl).addButton((button) => button.setButtonText(ctx.t("barButtons.add")).onClick(() => this.addTo(bar)));
		}
		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText(ctx.t("barButtons.restore"))
				.setDestructive()
				.onClick(() => void this.save({ hidden: [], custom: [] })),
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

	private buttonRow(bar: Bar, b: BarButton): void {
		const { ctx } = this;
		const key = hiddenKey(bar, b.key);
		const row = new Setting(this.contentEl).setName(b.label);
		const svg = b.el.querySelector("svg");
		this.rowIcon(row, (el) => {
			if (svg) el.appendChild(svg.cloneNode(true));
		});
		row.addToggle((toggle) =>
			toggle
				.setTooltip(ctx.t("barButtons.show"))
				.setValue(!ctx.settings.hidden.includes(key))
				.onChange((shown) => void ctx.updateSettings({ hidden: shown ? ctx.settings.hidden.filter((k) => k !== key) : [...ctx.settings.hidden, key] })),
		);
	}

	private customRow(b: CustomButton): void {
		const { ctx } = this;
		const row = new Setting(this.contentEl).setName(b.name);
		this.rowIcon(row, (el) => setIcon(el, b.icon));
		row.addExtraButton((button) =>
			button
				.setIcon("pencil")
				.setTooltip(ctx.t("barButtons.change"))
				.onClick(() => this.pickLook(b.name, b.icon, (name, icon) => void this.save({ custom: ctx.settings.custom.map((c) => (c.id === b.id ? { ...c, name, icon } : c)) }))),
		);
		row.addExtraButton((button) =>
			button
				.setIcon("trash-2")
				.setTooltip(ctx.t("barButtons.remove"))
				.onClick(() => void this.save({ custom: ctx.settings.custom.filter((c) => c.id !== b.id) })),
		);
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
 * The bottom bar and the side bar, your way: any button can be taken off, and any command of the
 * app (its own, this plugin's or another plugin's) can be added as a button.
 */
export const barButtonsModule = defineModule<BarButtonsSettings>({
	id: "bar-buttons",
	name: "barButtons.name",
	description: "barButtons.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: { hidden: [], custom: [] },
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
			};
		});
		ctx.on("data-load", (canvas) => applyTo(ctx, canvas, mounted));
		ctx.onSettingsChange(() => {
			for (const canvas of ctx.canvases()) applyTo(ctx, canvas, mounted);
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
