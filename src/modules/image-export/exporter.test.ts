import { describe, expect, it, vi } from "vitest";
import { rewriteRootSelectors } from "./exporter";

// The exporter fetches web images through Obsidian; these tests only need its pure helpers.
vi.mock("obsidian", () => ({ arrayBufferToBase64: vi.fn(), requestUrl: vi.fn() }));

describe("rewriteRootSelectors", () => {
	it("maps body, html and :root to the export root", () => {
		expect(rewriteRootSelectors("body")).toBe(".opc-export-root");
		expect(rewriteRootSelectors(":root")).toBe(".opc-export-root");
		expect(rewriteRootSelectors("body.theme-dark .canvas-node")).toBe(".opc-export-root.theme-dark .canvas-node");
		expect(rewriteRootSelectors("html, body > div")).toBe(".opc-export-root, .opc-export-root > div");
		expect(rewriteRootSelectors(":is(body) .x")).toBe(":is(.opc-export-root) .x");
	});

	it("leaves other selectors alone", () => {
		expect(rewriteRootSelectors(".body-text .rooted")).toBe(".body-text .rooted");
		expect(rewriteRootSelectors(".canvas-node:root-ish")).toBe(".canvas-node:root-ish");
	});
});
