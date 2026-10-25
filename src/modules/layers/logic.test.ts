import { describe, expect, it } from "vitest";
import { BASE_LAYER, cardZ, groupZ, heirOf, layerIndex, layersOf, moveLayer, neighborLayer, nextLayerName } from "./logic";

const L = (...ids: string[]) => ids.map((id) => ({ id, name: id }));

describe("layers", () => {
	it("gives a canvas without layers one implicit layer", () => {
		expect(layersOf(undefined, "Layer 1")).toEqual([{ id: BASE_LAYER, name: "Layer 1" }]);
		expect(layersOf([], "Layer 1")).toHaveLength(1);
		expect(layersOf(L("a", "b"), "x").map((l) => l.id)).toEqual(["a", "b"]);
	});

	it("puts unknown and absent layer ids on the bottom layer", () => {
		const layers = L("a", "b", "c");
		expect(layerIndex(layers, "c")).toBe(2);
		expect(layerIndex(layers, undefined)).toBe(0);
		expect(layerIndex(layers, "gone")).toBe(0);
	});

	it("stacks every card of a higher layer above every card of a lower one", () => {
		expect(cardZ(1, -5)).toBeGreaterThan(cardZ(0, 10_000_000));
		expect(cardZ(0, 3)).toBeGreaterThan(cardZ(0, 2));
		expect(cardZ(99, 8_000_000)).toBeLessThan(2 ** 31);
	});

	it("keeps groups below every card, ordered by layer, then bigger under smaller", () => {
		expect(groupZ(99, 1)).toBeLessThan(cardZ(0, -8_000_000));
		expect(groupZ(1, 1e12)).toBeGreaterThan(groupZ(0, 1));
		expect(groupZ(0, 100)).toBeGreaterThan(groupZ(0, 10_000));
		expect(groupZ(0, 0)).toBeGreaterThan(-(2 ** 31));
	});

	it("names new layers after the first free number", () => {
		const t = (n: number) => `Layer ${n}`;
		expect(nextLayerName([{ id: "a", name: "Layer 1" }], t)).toBe("Layer 2");
		expect(nextLayerName([{ id: "a", name: "Layer 1" }, { id: "b", name: "Layer 3" }], t)).toBe("Layer 4");
	});

	it("moves layers", () => {
		expect(moveLayer(L("a", "b", "c"), 0, 2).map((l) => l.id)).toEqual(["b", "c", "a"]);
		expect(moveLayer(L("a", "b", "c"), 2, 0).map((l) => l.id)).toEqual(["c", "a", "b"]);
	});

	it("finds the neighbor layer and the heir of a deleted layer", () => {
		const layers = L("a", "b", "c");
		expect(neighborLayer(layers, "b", 1)?.id).toBe("c");
		expect(neighborLayer(layers, "c", 1)).toBeNull();
		expect(neighborLayer(layers, undefined, -1)).toBeNull();
		expect(heirOf(layers, "b")?.id).toBe("a");
		expect(heirOf(layers, "a")?.id).toBe("b");
		expect(heirOf(L("a"), "a")).toBeNull();
	});
});
