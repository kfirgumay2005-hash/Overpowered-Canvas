/**
 * History and data-access tests against a fake canvas that mirrors the behavior of Obsidian
 * 1.14's canvas (see docs/INTERNALS.md): getData() spreads `data` and shallow-copies each
 * node's unknownData, requestSave() refreshes `data` and debounces a history push, undo
 * re-imports a snapshot.
 */
import { describe, expect, it } from "vitest";
import { createCanvasDataApi, ReadOnlyExtraDataError } from "../data/access";
import type { CanvasFileData, CanvasNodeData } from "../data/json-canvas";
import type { CanvasLike, CanvasNodeLike } from "../internals/types";
import { createHistoryApi } from "./history";

class FakeNode {
	x = 0;
	y = 0;
	width = 100;
	height = 100;
	color = "";
	unknownData: Record<string, unknown> = {};
	constructor(
		readonly canvas: FakeCanvas,
		readonly id: string,
	) {}
	getData(): CanvasNodeData {
		return { ...this.unknownData, id: this.id, x: this.x, y: this.y, width: this.width, height: this.height } as CanvasNodeData;
	}
	setData(d: CanvasNodeData) {
		const { x, y, width, height, color, ...rest } = d;
		Object.assign(this, { x, y, width, height, color: color ?? "" });
		this.unknownData = rest;
	}
}

function debounced(fn: (d: CanvasFileData) => void) {
	let pending: CanvasFileData | null = null;
	const call = ((d: CanvasFileData) => {
		pending = d;
		return call;
	}) as unknown as CanvasLike["requestPushHistory"];
	call.run = () => {
		if (pending) {
			const d = pending;
			pending = null;
			fn(d);
		}
	};
	call.cancel = () => {
		pending = null;
		return call;
	};
	return call;
}

class FakeCanvas {
	nodes = new Map<string, FakeNode>();
	edges = new Map();
	data: CanvasFileData = {};
	saves = 0;
	view = { requestSave: () => this.saves++, file: null };
	history = {
		data: [] as CanvasFileData[],
		current: 0,
		push(d: CanvasFileData) {
			this.data.length = this.data.length > 0 ? this.current + 1 : 0;
			this.data.push(d);
			this.current = this.data.length - 1;
		},
	};
	requestPushHistory = debounced((d) => this.pushHistory(d));

	getData(): CanvasFileData {
		return { ...this.data, nodes: [...this.nodes.values()].map((n) => n.getData()), edges: [] };
	}
	setData(d: CanvasFileData) {
		this.importData(d);
		this.data = d;
		this.pushHistory(d);
	}
	importData(d: CanvasFileData) {
		const keep = new Set<string>();
		for (const nd of d.nodes ?? []) {
			const node = this.nodes.get(nd.id) ?? new FakeNode(this, nd.id);
			this.nodes.set(nd.id, node);
			node.setData(nd);
			keep.add(nd.id);
		}
		for (const id of [...this.nodes.keys()]) if (!keep.has(id)) this.nodes.delete(id);
	}
	requestSave() {
		this.data = this.getData();
		this.requestPushHistory(this.data);
		this.view.requestSave();
	}
	pushHistory(d: CanvasFileData) {
		this.history.push(d);
	}
	undo() {
		if (this.history.current > 0) this.applyHistory(this.history.data[--this.history.current]!);
	}
	applyHistory(d: CanvasFileData) {
		this.importData(d);
		this.data = d;
	}
	requestFrame() {}
}

function setup() {
	const fake = new FakeCanvas();
	fake.setData({ nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 100, height: 100 }], edges: [] });
	const canvas = fake as unknown as CanvasLike;
	const history = createHistoryApi();
	const readOnly: unknown[] = [];
	const data = createCanvasDataApi(history, (_c, found) => readOnly.push(found));
	const node = fake.nodes.get("a") as unknown as CanvasNodeLike;
	return { fake, canvas, history, data, node, readOnly };
}

describe("history.transaction", () => {
	it("records exactly one undo step for many changes", () => {
		const { fake, canvas, history, data, node } = setup();
		const before = fake.history.data.length;
		history.transaction(canvas, () => {
			data.node(node).set({ border: "dashed" });
			node.x = 50;
			canvas.requestSave(); // Obsidian may also request a save mid-action
			data.node(node).set({ locked: true });
		});
		expect(fake.history.data.length).toBe(before + 1);
		fake.requestPushHistory.run(); // nothing left pending
		expect(fake.history.data.length).toBe(before + 1);
		expect(fake.saves).toBeGreaterThan(0);
	});

	it("undo restores the previous extra data", () => {
		const { fake, canvas, history, data, node } = setup();
		history.transaction(canvas, () => data.node(node).set({ border: "dashed" }));
		history.transaction(canvas, () => data.node(node).set({ border: "dotted" }));
		expect(data.node(node).get().border).toBe("dotted");
		fake.undo();
		expect(data.node(node).get().border).toBe("dashed");
		fake.undo();
		expect(data.node(node).get().border).toBeUndefined();
	});

	it("keeps snapshots intact because data is never mutated in place", () => {
		const { fake, canvas, history, data, node } = setup();
		history.transaction(canvas, () => data.node(node).set({ styles: { a: "1" } }));
		const snapshot = fake.history.data[fake.history.current]!;
		history.transaction(canvas, () => data.node(node).set({ styles: { a: "2" } }));
		expect((snapshot.nodes![0]!["x-opc"] as { styles: Record<string, string> }).styles.a).toBe("1");
	});

	it("rolls back and records nothing when the mutation throws", () => {
		const { fake, canvas, history, data, node } = setup();
		const steps = fake.history.data.length;
		expect(() =>
			history.transaction(canvas, () => {
				data.node(node).set({ border: "dashed" });
				node.x = 999;
				data.node(node).set({ opacity: 5 }); // invalid → throws
			}),
		).toThrow();
		expect(fake.history.data.length).toBe(steps);
		expect(data.node(node).get().border).toBeUndefined();
		expect(fake.nodes.get("a")!.x).toBe(0);
	});

	it("nested transactions join the outer step", () => {
		const { fake, canvas, history, data, node } = setup();
		const steps = fake.history.data.length;
		history.transaction(canvas, () => {
			history.transaction(canvas, () => data.node(node).set({ locked: true }));
			expect(history.isInTransaction(canvas)).toBe(true);
			data.node(node).set({ align: "center" });
		});
		expect(fake.history.data.length).toBe(steps + 1);
		expect(history.isInTransaction(canvas)).toBe(false);
	});

	it("does not record a step when nothing changed", () => {
		const { fake, canvas, history } = setup();
		const steps = fake.history.data.length;
		history.transaction(canvas, () => undefined);
		expect(fake.history.data.length).toBe(steps);
	});
});

describe("data access", () => {
	it("root data is stored with a version and survives getData()", () => {
		const { fake, canvas, history, data } = setup();
		history.transaction(canvas, () => data.root(canvas).set({ dir: "rtl" }));
		expect(fake.getData()["x-opc"]).toEqual({ dir: "rtl", v: 1 });
		expect(data.root(canvas).get()).toEqual({ dir: "rtl" });
		history.transaction(canvas, () => data.root(canvas).set({ dir: undefined }));
		expect(fake.getData()).not.toHaveProperty("x-opc");
	});

	it("a write outside a transaction requests a save", () => {
		const { fake, data, node } = setup();
		const saves = fake.saves;
		data.node(node).set({ locked: true });
		expect(fake.saves).toBe(saves + 1);
	});

	it("removes the key when the extra data becomes empty", () => {
		const { fake, data, node } = setup();
		data.node(node).set({ locked: true });
		data.node(node).set({ locked: undefined });
		expect(fake.nodes.get("a")!.getData()).not.toHaveProperty("x-opc");
	});

	it("refuses writes to files from a newer schema version", () => {
		const { fake, canvas, data, node, readOnly } = setup();
		fake.data = { ...fake.data, "x-opc": { v: 99 } };
		expect(data.isWritable(canvas)).toBe(false);
		expect(() => data.node(node).set({ locked: true })).toThrow(ReadOnlyExtraDataError);
		expect(readOnly).toEqual([99]);
	});
});
