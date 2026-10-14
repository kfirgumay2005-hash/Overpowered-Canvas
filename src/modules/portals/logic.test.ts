import { describe, expect, it } from "vitest";
import { buildGhosts, ghostId, parseGhostId, stripGhosts } from "./logic";

describe("ghost ids", () => {
	it("round-trips", () => {
		expect(parseGhostId(ghostId("p1", "abc"))).toEqual({ portalId: "p1", targetId: "abc" });
		expect(parseGhostId("plain")).toBeNull();
	});
});

describe("stripGhosts", () => {
	const ghosts = new Set(["p~a", "p~b", "p~e1"]);
	const isGhost = (id: string) => ghosts.has(id);
	const data = {
		nodes: [
			{ id: "p", type: "file", file: "x.canvas", x: 0, y: 0, width: 10, height: 10 },
			{ id: "p~a", type: "text", x: 0, y: 0, width: 10, height: 10 },
			{ id: "r", type: "text", x: 0, y: 0, width: 10, height: 10 },
		],
		edges: [
			{ id: "e", fromNode: "r", toNode: "p~a", "x-opc": { path: "dotted" } },
			{ id: "e2", fromNode: "p~b", toNode: "r" },
			{ id: "p~e1", fromNode: "p~a", toNode: "p~b" },
			{ id: "e3", fromNode: "p~a", toNode: "p~b" },
			{ id: "e4", fromNode: "r", toNode: "p" },
		],
		"x-opc": { v: 1 },
	};

	it("drops ghosts and inner edges, maps edges to ghosts onto the portal", () => {
		const out = stripGhosts(data, isGhost);
		expect(out.nodes?.map((n) => n.id)).toEqual(["p", "r"]);
		expect(out.edges).toEqual([
			{ id: "e", fromNode: "r", toNode: "p", "x-opc": { path: "dotted", portalTarget: { end: "to", nodeId: "a" } } },
			{ id: "e2", fromNode: "p", toNode: "r", "x-opc": { portalTarget: { end: "from", nodeId: "b" } } },
			{ id: "e4", fromNode: "r", toNode: "p" },
		]);
		expect(out["x-opc"]).toEqual({ v: 1 });
		expect(data.nodes).toHaveLength(3); // input untouched
	});
});

describe("buildGhosts", () => {
	it("shifts target content into the portal frame and skips nested portals", () => {
		const g = buildGhosts(
			{ id: "p", x: 1000, y: 500 },
			{
				nodes: [
					{ id: "a", type: "text", x: 100, y: 100, width: 50, height: 20, "x-opc": { shape: "star" } },
					{ id: "b", type: "file", file: "y.canvas", x: 300, y: 200, width: 100, height: 50, "x-opc": { portal: { open: true } } },
				],
				edges: [{ id: "e", fromNode: "a", toNode: "b" }, { id: "dangling", fromNode: "a", toNode: "zzz" }],
			},
			20,
			30,
		);
		expect(g.nodes).toEqual([
			{ id: "p~a", type: "text", x: 1020, y: 550, width: 50, height: 20, "x-opc": { shape: "star" } },
			{ id: "p~b", type: "file", file: "y.canvas", x: 1220, y: 650, width: 100, height: 50 },
		]);
		expect(g.edges).toEqual([{ id: "p~e", fromNode: "p~a", toNode: "p~b" }]);
		expect([g.width, g.height]).toEqual([340, 220]);
	});
});
