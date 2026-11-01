/**
 * Stands in for the "obsidian" package in unit tests: it ships only types, so anything importing
 * it at run time needs these. The base classes exist because modules subclass them on import;
 * tests never run code that really needs Obsidian.
 */
export class Component {}
export class Plugin extends Component {}
export class Modal {}
export class SuggestModal extends Modal {}
export class FuzzySuggestModal extends SuggestModal {}
export class View extends Component {}
export class ItemView extends View {}
export class PluginSettingTab {}
export class Setting {}
export class Notice {}
export class MarkdownView extends ItemView {}
export class TFile {}
export class TFolder {}

export const Platform = { isMobile: false, isPhone: false, isTablet: false, isDesktopApp: true };

export const normalizePath = (path: string): string => path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
