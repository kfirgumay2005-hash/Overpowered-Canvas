import { Platform, Setting } from "obsidian";
import { defineModule } from "../../core/module";
import { mergeWithDefaults } from "../../settings/settings";

type PhoneBar = "bottom" | "side";

interface ToolbarSizeSettings {
	/** Selection toolbar, percent of the default size. */
	desktop: number;
	mobile: number;
	/** Canvas controls bar (zoom, undo…), percent of the default size. */
	controlsDesktop: number;
	controlsMobile: number;
	/** Where the controls bar sits on phones. */
	phoneBar: PhoneBar;
}

const DEFAULTS: ToolbarSizeSettings = { desktop: 100, mobile: 100, controlsDesktop: 100, controlsMobile: 100, phoneBar: "bottom" };
const MIN = 60;
const MAX = 200;
const clampPercent = (n: number, fallback: number) => (Number.isFinite(n) ? Math.min(MAX, Math.max(MIN, Math.round(n))) : fallback);

/** Obsidian marks phones (not tablets) with this class; the core hides the card bar there. */
const isPhone = () => document.body.hasClass("is-phone");

const overflows = (el: HTMLElement) => ({ wide: el.scrollWidth > el.clientWidth + 1, tall: el.scrollHeight > el.clientHeight + 1 });

/** Over a bar with more buttons than fit, the wheel scrolls the bar and leaves the board alone. */
function wheelOverBar(evt: WheelEvent): void {
	const bar = evt.currentTarget as HTMLElement;
	const { wide, tall } = overflows(bar);
	if (!wide && !tall) return;
	evt.stopPropagation();
	// A row has no vertical scrolling of its own: the ordinary wheel moves it sideways.
	if (wide && !tall && !evt.deltaX) {
		evt.preventDefault();
		// Right-to-left bars scroll towards negative values.
		bar.scrollLeft += bar.win.getComputedStyle(bar).direction === "rtl" ? -evt.deltaY : evt.deltaY;
	}
}

/**
 * Size of the selection toolbar and of the canvas controls bar, separately for desktop and mobile.
 * Both bars scroll when they hold more buttons than fit. On phones, where the core hides the card
 * bar (add card, shapes, text…), its buttons join the controls bar, which sits at the bottom of the
 * screen (scrolls sideways) or at the side (scrolls up and down).
 */
export const toolbarSizeModule = defineModule<ToolbarSizeSettings>({
	id: "toolbar-size",
	name: "toolbarSize.name",
	description: "toolbarSize.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: DEFAULTS,
	sanitizeSettings: (raw, defaults) => {
		const s = mergeWithDefaults(raw, defaults);
		return {
			desktop: clampPercent(s.desktop, defaults.desktop),
			mobile: clampPercent(s.mobile, defaults.mobile),
			controlsDesktop: clampPercent(s.controlsDesktop, defaults.controlsDesktop),
			controlsMobile: clampPercent(s.controlsMobile, defaults.controlsMobile),
			phoneBar: s.phoneBar === "side" ? "side" : "bottom",
		};
	},

	enable(ctx) {
		const apply = () => {
			const mobile = Platform.isMobile || isPhone();
			document.body.style.setProperty("--opc-menu-zoom", String((mobile ? ctx.settings.mobile : ctx.settings.desktop) / 100));
			document.body.style.setProperty("--opc-controls-zoom", String((mobile ? ctx.settings.controlsMobile : ctx.settings.controlsDesktop) / 100));
			for (const canvas of ctx.canvases()) {
				if (canvas.wrapperEl.hasAttribute("data-opc-phone-bar")) canvas.wrapperEl.setAttribute("data-opc-phone-bar", ctx.settings.phoneBar);
				if (canvas.selection.size > 0) canvas.menu.render(true);
			}
		};
		apply();
		ctx.onSettingsChange(apply);
		ctx.register(() => {
			document.body.style.removeProperty("--opc-menu-zoom");
			document.body.style.removeProperty("--opc-controls-zoom");
		});

		ctx.onCanvas((canvas) => {
			const card = canvas.cardMenuEl;
			const controls = canvas.canvasControlsEl;
			// A swipe over the buttons scrolls the bar instead of dragging a new card out; a tap still adds one.
			const keepScroll = (evt: PointerEvent) => {
				if (evt.pointerType !== "mouse" && (isPhone() || overflows(card).wide)) evt.stopPropagation();
			};
			card.addEventListener("pointerdown", keepScroll, true);
			card.addEventListener("wheel", wheelOverBar, { passive: false });
			controls.addEventListener("wheel", wheelOverBar, { passive: false });
			const unbind = () => {
				card.removeEventListener("pointerdown", keepScroll, true);
				card.removeEventListener("wheel", wheelOverBar);
				controls.removeEventListener("wheel", wheelOverBar);
			};
			if (!isPhone()) return unbind;
			const home = card.parentElement;
			const next = card.nextSibling;
			controls.prepend(card);
			card.addClass("mod-raised");
			canvas.wrapperEl.setAttribute("data-opc-phone-bar", ctx.settings.phoneBar);
			return () => {
				unbind();
				card.removeClass("mod-raised");
				canvas.wrapperEl.removeAttribute("data-opc-phone-bar");
				if (home) home.insertBefore(card, next && next.parentNode === home ? next : null);
			};
		});
	},

	renderSettings(el, ctx) {
		const slider = (name: string, key: "desktop" | "mobile" | "controlsDesktop" | "controlsMobile") =>
			new Setting(el)
				.setName(name)
				.setDesc(ctx.t("toolbarSize.percent.desc"))
				.addSlider((s) =>
					s
						.setLimits(MIN, MAX, 5)
						.setValue(ctx.settings[key])

						.onChange((v) => ctx.updateSettings({ [key]: v })),
				);
		new Setting(el).setName(ctx.t("toolbarSize.menu.heading")).setHeading();
		slider(ctx.t("toolbarSize.desktop.name"), "desktop");
		slider(ctx.t("toolbarSize.mobile.name"), "mobile");
		new Setting(el).setName(ctx.t("toolbarSize.controls.heading")).setHeading();
		slider(ctx.t("toolbarSize.desktop.name"), "controlsDesktop");
		slider(ctx.t("toolbarSize.mobile.name"), "controlsMobile");
		new Setting(el)
			.setName(ctx.t("toolbarSize.phoneBar.name"))
			.setDesc(ctx.t("toolbarSize.phoneBar.desc"))
			.addDropdown((d) =>
				d
					.addOption("bottom", ctx.t("toolbarSize.phoneBar.bottom"))
					.addOption("side", ctx.t("toolbarSize.phoneBar.side"))
					.setValue(ctx.settings.phoneBar)
					.onChange((v) => ctx.updateSettings({ phoneBar: v as PhoneBar })),
			);
	},
});
