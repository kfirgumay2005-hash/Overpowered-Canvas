import { Setting, setIcon, type DropdownComponent } from "obsidian";
import { defineModule, type ModuleContext } from "../../core/module";
import type { I18nKey } from "../../i18n";
import { ALL_MENU_CLASSES, ALL_MENU_VARS, LIMITS, MENU_STYLE_DEFAULTS, menuStyleProps, sanitizeMenuStyle, type MenuColors, type MenuStyleSettings, type NumberKey } from "./logic";

type Ctx = ModuleContext<MenuStyleSettings>;

/** Class of the menus opened in a canvas (core/menu-kinds.ts). */
const MARK = "opc-menu-in-canvas";

/**
 * Right-click menu style: text size, spacing, width, corners, icons, shadow and colors (for light
 * and dark themes) of menus opened in a canvas, and of right-click and ⋮ menus everywhere when
 * Customize the bars applies them to the whole vault (core/menu-kinds.ts). Only what the user changes is written, so themes and other plugins' menu
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
		// The rules are in styles.css; each window's body (the main one, popouts, the settings
		// window) gets a class per changed value and the value as a CSS variable.
		const bodies = new Set<HTMLElement>();
		const apply = (body: HTMLElement) => {
			const { classes, vars } = menuStyleProps(ctx.settings);
			body.removeClasses([...ALL_MENU_CLASSES]);
			for (const v of ALL_MENU_VARS) body.style.removeProperty(v);
			body.addClasses(classes);
			body.setCssProps(vars);
			// Right-click and ⋮ menus everywhere when Customize the bars says so.
			body.toggleClass("opc-ms-context", ctx.menus.scope.context);
			body.toggleClass("opc-ms-more", ctx.menus.scope.more);
		};
		const ensure = (doc: Document) => {
			bodies.add(doc.body);
			apply(doc.body);
		};
		const refresh = () => {
			for (const body of [...bodies]) {
				if (!body.isConnected) bodies.delete(body);
				else apply(body);
			}
		};
		ensure(document);
		ctx.registerEvent(ctx.app.workspace.on("window-open", (win) => ensure(win.doc)));
		ctx.app.workspace.iterateAllLeaves((leaf) => {
			const doc = leaf.view.containerEl.doc;
			if (doc !== document) ensure(doc);
		});
		ctx.onSettingsChange(refresh);
		ctx.register(ctx.menus.onScopeChange(refresh));
		ctx.register(() => {
			for (const body of bodies) {
				body.removeClasses([...ALL_MENU_CLASSES, "opc-ms-context", "opc-ms-more"]);
				for (const v of ALL_MENU_VARS) body.style.removeProperty(v);
			}
			bodies.clear();
		});
		ensureStyle = ensure;
		ctx.register(() => (ensureStyle = null));
	},

	renderSettings(el, ctx: Ctx) {
		ensureStyle?.(el.doc);
		renderMenuStyleSettings(el, ctx);
	},
});

/** Set while the module runs: applies the style to a window (the settings may be a window of their own). */
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

	new Setting(el).setName(t("menuStyle.where.name")).setDesc(t("menuStyle.where.desc"));

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
				.setValue(s()[key] < 0 ? Math.min(max, Math.max(min, themeValue(key))) : s()[key])
				.onChange(async (v) => {
					await ctx.updateSettings({ [key]: v });
					describe();
				});
		});
		setting.addExtraButton((b) =>
			b
				.setIcon("rotate-ccw")
				.setTooltip(t("menuStyle.resetOne"))
				.onClick(async () => {
					await ctx.updateSettings({ [key]: -1 });
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
					void ctx.updateSettings({ [mode]: { ...s()[mode], [key]: v } }).then(describe);
				});
			});
			setting.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip(t("menuStyle.resetOne"))
					.onClick(() => void ctx.updateSettings({ [mode]: { ...s()[mode], [key]: "" } }).then(describe)),
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
				.setDestructive()
				.onClick(async () => {
					await ctx.updateSettings({ ...MENU_STYLE_DEFAULTS, light: { ...MENU_STYLE_DEFAULTS.light }, dark: { ...MENU_STYLE_DEFAULTS.dark } });
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
