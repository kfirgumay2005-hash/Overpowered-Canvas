import { describe, expect, it } from "vitest";
import { buttonKeys, buttonLabel, hiddenKey, orderOf, sanitizeBarSettings, sortKeys, type ButtonFacts } from "./logic";

const button = (over: Partial<ButtonFacts>): ButtonFacts => ({ classes: [], groupClasses: [], iconClasses: [], label: "", ...over });

describe("buttonKeys", () => {
	it("prefers our own class over the icon", () => {
		const keys = buttonKeys([
			button({ classes: ["canvas-card-menu-button", "mod-draggable"], iconClasses: ["svg-icon", "lucide-sticky-note"], label: "Add card" }),
			button({ classes: ["canvas-card-menu-button", "opc-card-button", "opc-card-sticky"], iconClasses: ["svg-icon", "lucide-sticky-note"] }),
		]);
		expect(keys).toEqual(["lucide-sticky-note", "opc-card-sticky"]);
	});
	it("knows side bar buttons by their group, then their icon", () => {
		const keys = buttonKeys([button({ groupClasses: ["canvas-control-group", "mod-raised", "opc-grid-control"], iconClasses: ["lucide-grid"] }), button({ groupClasses: ["canvas-control-group", "mod-raised"], iconClasses: ["lucide-plus"] })]);
		expect(keys).toEqual(["opc-grid-control", "lucide-plus"]);
	});
	it("does not depend on the label when there is an icon", () => {
		const facts = (label: string) => button({ iconClasses: ["lucide-plus"], label });
		expect(buttonKeys([facts("Zoom in")])).toEqual(buttonKeys([facts("ズームイン")]));
	});
	it("falls back to the label and tells look-alikes apart", () => {
		expect(buttonKeys([button({ label: "Other" }), button({ label: "Other" }), button({ iconClasses: ["lucide-x"] }), button({ iconClasses: ["lucide-x"] })])).toEqual(["Other", "Other#2", "lucide-x", "lucide-x#2"]);
	});
});

describe("buttonLabel", () => {
	it("drops shortcuts and notes", () => {
		expect(buttonLabel("Zoom to fit\n(Shift + 1)")).toBe("Zoom to fit");
		expect(buttonLabel("Grid (right-click for size)")).toBe("Grid");
		expect(buttonLabel("Undo")).toBe("Undo");
	});
});

describe("sanitizeBarSettings", () => {
	it("starts empty", () => {
		expect(sanitizeBarSettings(undefined)).toEqual({ hidden: [], custom: [], order: {} });
		expect(sanitizeBarSettings({ hidden: "x", custom: 3 })).toEqual({ hidden: [], custom: [], order: {} });
	});
	it("keeps good entries and drops the rest", () => {
		const s = sanitizeBarSettings({
			hidden: [hiddenKey("side", "lucide-plus"), hiddenKey("side", "lucide-plus"), 4, ""],
			custom: [
				{ id: "a", bar: "side", command: "app:open-settings", icon: "lucide-cog", name: "Settings" },
				{ id: "a", bar: "side", command: "app:other" },
				{ id: "b", command: "app:reload" },
				{ id: "c" },
				null,
			],
		});
		expect(s.hidden).toEqual(["side:lucide-plus"]);
		expect(s.custom).toEqual([
			{ id: "a", bar: "side", command: "app:open-settings", icon: "lucide-cog", name: "Settings" },
			{ id: "b", bar: "bottom", command: "app:reload", icon: "lucide-terminal", name: "app:reload" },
		]);
	});
});

describe("the popup over a selection", () => {
	it("knows a module's button by its class and a core button by its icon, whatever the language", () => {
		const keys = buttonKeys([
			{ classes: ["clickable-icon", "opc-menu-button", "opc-menu-align"], groupClasses: [], iconClasses: ["svg-icon", "lucide-align-right"], label: "Text alignment" },
			{ classes: ["clickable-icon"], groupClasses: [], iconClasses: ["svg-icon", "zoom-to-selection"], label: "Zoom to selection\n(Shift + 2)", iconName: "zoom-to-selection" },
			{ classes: ["clickable-icon"], groupClasses: [], iconClasses: ["svg-icon", "lucide-trash-2"], label: "Remove" },
		]);
		expect(keys).toEqual(["opc-menu-align", "zoom-to-selection", "lucide-trash-2"]);
	});
	it("keeps commands added to the popup", () => {
		const s = sanitizeBarSettings({ custom: [{ id: "p", bar: "popup", command: "app:reload" }, { id: "q", bar: "nowhere", command: "app:reload" }] });
		expect(s.custom.map((c) => c.bar)).toEqual(["popup", "bottom"]);
	});
});

describe("the order of a bar", () => {
	it("puts chosen keys first, in their order, and new buttons after them as they come", () => {
		expect(sortKeys(["a", "b", "c", "d"], ["c", "a"])).toEqual(["c", "a", "b", "d"]);
		expect(sortKeys(["a", "b"], undefined)).toEqual(["a", "b"]);
	});
	it("keeps the order of added buttons and reads it back from settings", () => {
		const s = sanitizeBarSettings({ order: { bottom: ["custom:x", "lucide-trash-2", "custom:x", 3], nowhere: ["a"] } });
		expect(s.order).toEqual({ bottom: ["custom:x", "lucide-trash-2"] });
		expect(orderOf("lucide-trash-2", 5, s.order.bottom)).toBe(1);
		expect(orderOf("other", 5, s.order.bottom)).toBeGreaterThan(1);
	});
});
