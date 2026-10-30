import { describe, expect, it } from "vitest";
import { buttonKeys, buttonLabel, hiddenKey, sanitizeBarSettings, type ButtonFacts } from "./logic";

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
		expect(sanitizeBarSettings(undefined)).toEqual({ hidden: [], custom: [] });
		expect(sanitizeBarSettings({ hidden: "x", custom: 3 })).toEqual({ hidden: [], custom: [] });
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
