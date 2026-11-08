import { Menu, Setting, setIcon, type DropdownComponent } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { I18nKey } from "../../i18n";
import { LIMITS, MENU_STYLE_DEFAULTS, menuCss, sanitizeMenuStyle, type MenuColors, type MenuScope, type MenuStyleSettings, type NumberKey } from "./logic";

type Ctx = ModuleContext<MenuStyleSettings>;

/** Class of the menus opened in a canvas (they get the style unless it applies to every menu). */
const MARK = "opc-menu-styled";
const STYLE_ID = "opc-menu-style";
/**
 * The settings' preview menu sits in the page instead of floating. Written into each window with
 * the style (the settings may be a window of their own, without the module's body class).
 */
const PREVIEW_CSS = `.opc-menu-preview-box { display: flex; flex-direction: column; align-items: flex-start; gap: var(--size-4-2); padding: var(--size-4-3) 0; }
.opc-menu-preview-label { color: var(--text-muted); font-size: var(--font-ui-smaller); }
.opc-menu-preview-box > .menu.opc-menu-preview { position: relative; inset: auto; display: block; z-index: auto; max-height: none; pointer-events: none; animation: none; }`;

/** Was this menu opened from a canvas: at a point of a canvas view, or under a canvas control? */
function openedInCanvas(menu: Menu, pos: { x: number; y: number }, doc?: Document): boolean {
	const d = doc ?? activeDocument;
	const canvasSel = '.workspace-leaf-content[data-type="canvas"], .canvas-wrapper';
	const parent = (menu as Menu & { parentEl?: HTMLElement | null }).parentEl;
	if (parent?.closest?.(canvasSel)) return true;
	const el = d.elementFromPoint(pos.x, pos.y) as HTMLElement | null;
	return !!el?.closest?.(canvasSel);
}

/**
 * Right-click menu style: text size, spacing, width, corners, icons, shadow and colors (for light
 * and dark themes) of context menus. By default only menus opened in a canvas; optionally every
 * menu of the vault. Only what the user changes is written, so themes and other plugins' menu
 * items keep working; native (system) menus can't be styled.
 */
export const menuStyleModule = defineModule<MenuStyleSettings>({
	id: "menu-style",
	name: "menuStyle.name",
	description: "menuStyle.desc",
	group: "interaction",
	defaultEnabled: true,
	defaultSettings: MENU_STYLE_DEFAULTS,
	sanitizeSettings: (raw) => sanitizeMenuStyle(raw),

	enable(ctx: Ctx) {
		// One <style> per window (the main one, popouts, the settings window).
		const styles = new Set<HTMLStyleElement>();
		const css = () => {
			const scopes: MenuScope[] = [{ body: "", menu: ctx.settings.allVault ? ".menu" : `.menu.${MARK}` }];
			return `${PREVIEW_CSS}
${menuCss(ctx.settings, scopes)}`;
		};
		const ensure = (doc: Document) => {
			let el = doc.getElementById(STYLE_ID) as HTMLStyleElement | null;
			if (!el) {
				el = doc.head.createEl("style", { attr: { id: STYLE_ID } });
				styles.add(el);
			}
			el.textContent = css();
		};
		const refresh = () => {
			for (const el of [...styles]) {
				if (!el.isConnected) styles.delete(el);
				else el.textContent = css();
			}
		};
		ensure(document);
		ctx.registerEvent(ctx.app.workspace.on("window-open", (win) => ensure(win.doc)));
		ctx.app.workspace.iterateAllLeaves((leaf) => {
			const doc = leaf.view.containerEl.doc;
			if (doc !== document) ensure(doc);
		});
		ctx.onSettingsChange(refresh);
		ctx.register(() => {
			for (const el of styles) el.remove();
			styles.clear();
		});
		ensureStyle = ensure;
		ctx.register(() => (ensureStyle = null));

		// Mark the menus opened in a canvas (node, edge, selection, background, toolbar menus…).
		ctx.patch("Menu.showAtPosition (menu style)", Menu.prototype, {
			showAtPosition: (next) =>
				function (this: Menu, pos: { x: number; y: number }, doc?: Document) {
					let inCanvas = false;
					try {
						inCanvas = openedInCanvas(this, pos, doc);
					} catch {
						// Not ours to break: the menu opens unstyled.
					}
					const out = next.call(this, pos, doc);
					if (inCanvas) (this as Menu & { dom?: HTMLElement }).dom?.addClass(MARK);
					return out;
				},
		});
	},

	renderSettings(el, ctx: Ctx) {
		ensureStyle?.(el.doc);
		renderMenuStyleSettings(el, ctx);
	},
});

/** Set while the module runs: adds the style to a window (the settings may be a window of their own). */
let ensureStyle: ((doc: Document) => void) | null = null;

function renderMenuStyleSettings(el: HTMLElement, ctx: Ctx): void {
	const t = ctx.t;
	const s = () => ctx.settings;
	const update = (patch: Partial<MenuStyleSettings>) => void ctx.updateSettings(patch);

	// Live preview: a menu built like Obsidian's, with the same classes, so the same CSS styles it.
	const previewBox = el.createDiv({ cls: "opc-menu-preview-box" });
	previewBox.createDiv({ cls: "opc-menu-preview-label", text: t("menuStyle.preview") });
	const preview = previewBox.createDiv({ cls: `menu ${MARK} opc-menu-preview`, attr: { "aria-hidden": "true" } });
	const scroll = preview.createDiv({ cls: "menu-scroll" });
	const group1 = scroll.createDiv({ cls: "menu-group" });
	const item = (parent: HTMLElement, icon: string, key: I18nKey, cls = "") => {
		const it = parent.createDiv({ cls: `menu-item tappable ${cls}` });
		setIcon(it.createDiv({ cls: "menu-item-icon" }), icon);
		it.createDiv({ cls: "menu-item-title", text: t(key) });
	};
	item(group1, "copy", "menuStyle.preview.copy");
	item(group1, "palette", "menuStyle.preview.color", "selected");
	item(group1, "git-branch-plus", "menuStyle.preview.child");
	scroll.createDiv({ cls: "menu-separator" });
	const group2 = scroll.createDiv({ cls: "menu-group" });
	item(group2, "trash-2", "menuStyle.preview.delete");

	new Setting(el)
		.setName(t("menuStyle.allVault.name"))
		.setDesc(t("menuStyle.allVault.desc"))
		.addToggle((tg) => tg.setValue(s().allVault).onChange((v) => update({ allVault: v })));

	/** What the theme shows now (for sliders and color pickers left at the theme's value). */
	const themeValue = (key: NumberKey): number => {
		const item = preview.querySelector<HTMLElement>(".menu-item");
		const icon = preview.querySelector<HTMLElement>(".menu-item-icon .svg-icon");
		const cs = (e: Element | null | undefined) => (e ? getComputedStyle(e) : null);
		const n = (v: string | undefined) => Math.round(parseFloat(v ?? "") || 0);
		switch (key) {
			case "fontSize":
				return n(cs(item)?.fontSize);
			case "itemPadding":
				return n(cs(item)?.paddingTop);
			case "itemIndent":
				return n(cs(item)?.paddingLeft);
			case "width":
				return n(cs(preview)?.minWidth) || Math.round(preview.getBoundingClientRect().width);
			case "radius":
				return n(cs(preview)?.borderTopLeftRadius);
			case "iconSize":
				return n(cs(icon)?.width);
			case "iconGap":
				return n(cs(item)?.columnGap) || n(cs(item?.querySelector(".menu-item-icon"))?.marginRight);
		}
	};

	const numberRow = (key: NumberKey) => {
		const [min, max] = LIMITS[key];
		const setting = new Setting(el).setName(t(`menuStyle.${key}.name` as I18nKey));
		const describe = () => setting.setDesc(s()[key] < 0 ? t("menuStyle.theme", { value: themeValue(key) }) : t("menuStyle.px", { value: s()[key] }));
		let slider: { setValue(v: number): unknown } | null = null;
		setting.addSlider((sl) => {
			slider = sl;
			sl.setLimits(min, max, 1)
				.setDynamicTooltip()
				.setValue(s()[key] < 0 ? Math.min(max, Math.max(min, themeValue(key))) : s()[key])
				.onChange(async (v) => {
					await ctx.updateSettings({ [key]: v } as Partial<MenuStyleSettings>);
					describe();
				});
		});
		setting.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip(t("menuStyle.resetOne"))
				.onClick(async () => {
					await ctx.updateSettings({ [key]: -1 } as Partial<MenuStyleSettings>);
					slider?.setValue(Math.min(max, Math.max(min, themeValue(key))));
					describe();
				}),
		);
		// The theme's values are known once the preview is laid out.
		window.requestAnimationFrame(() => {
			describe();
			if (s()[key] < 0) slider?.setValue(Math.min(max, Math.max(min, themeValue(key))));
		});
		describe();
	};
	for (const key of ["fontSize", "itemPadding", "itemIndent", "width", "radius", "iconSize", "iconGap"] as NumberKey[]) numberRow(key);

	new Setting(el).setName(t("menuStyle.shadow.name")).addDropdown((d: DropdownComponent) =>
		d
			.addOptions({ theme: t("menuStyle.shadow.theme"), none: t("menuStyle.shadow.none"), soft: t("menuStyle.shadow.soft"), strong: t("menuStyle.shadow.strong") })
			.setValue(s().shadow)
			.onChange((v) => update({ shadow: v as MenuStyleSettings["shadow"] })),
	);

	const colorRows = (mode: "light" | "dark") => {
		new Setting(el).setName(t(`menuStyle.colors.${mode}` as I18nKey)).setHeading();
		const active = activeDocument.body.hasClass(mode === "dark" ? "theme-dark" : "theme-light");
		for (const key of ["background", "text", "hover", "border"] as (keyof MenuColors)[]) {
			const setting = new Setting(el).setName(t(`menuStyle.color.${key}` as I18nKey));
			const value = () => s()[mode][key];
			const describe = () => setting.setDesc(value() ? value() : t("menuStyle.themeColor"));
			setting.addColorPicker((c) => {
				const fallback = active ? cssColorOf(preview, key) : "";
				c.setValue(value() || fallback || "#808080").onChange((v) => {
					void ctx.updateSettings({ [mode]: { ...s()[mode], [key]: v } } as Partial<MenuStyleSettings>).then(describe);
				});
			});
			setting.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip(t("menuStyle.resetOne"))
					.onClick(() => void ctx.updateSettings({ [mode]: { ...s()[mode], [key]: "" } } as Partial<MenuStyleSettings>).then(describe)),
			);
			describe();
		}
	};
	colorRows("light");
	colorRows("dark");

	new Setting(el)
		.setName(t("menuStyle.reset.name"))
		.setDesc(t("menuStyle.reset.desc"))
		.addButton((b) =>
			b
				.setButtonText(t("menuStyle.reset.button"))
				.setWarning()
				.onClick(async () => {
					await ctx.updateSettings({ ...MENU_STYLE_DEFAULTS, allVault: s().allVault, light: { ...MENU_STYLE_DEFAULTS.light }, dark: { ...MENU_STYLE_DEFAULTS.dark } });
					// Redraw the options with the theme's values.
					const parent = el;
					parent.empty();
					renderMenuStyleSettings(parent, ctx);
				}),
		);
}

/** The theme's color of a part of the preview menu, as #rrggbb (for the color pickers' start). */
function cssColorOf(preview: HTMLElement, key: keyof MenuColors): string {
	const target = key === "hover" ? preview.querySelector(".menu-item.selected") : key === "text" ? preview.querySelector(".menu-item-title") : preview;
	if (!target) return "";
	const cs = getComputedStyle(target);
	const value = key === "background" || key === "hover" ? cs.backgroundColor : key === "text" ? cs.color : cs.borderTopColor;
	const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
	if (!m) return "";
	return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, "0")).join("")}`;
}
