import { defineModule } from "../../core/module";
import type { InteractionType } from "../../core/events";
import type { CanvasLike } from "../../internals/types";

/**
 * Public events for other plugins and scripts, on app.workspace as "overpowered-canvas:<name>":
 * node/edge created, removed, moved, changed and interaction; selection; undo/redo; read-only;
 * data requested/loaded; before/after save. Feature modules emit their own events (presentation,
 * portals, layout…) regardless of this module. See docs/EVENTS.md.
 */
export const eventsApiModule = defineModule({
	id: "events-api",
	name: "eventsApi.name",
	description: "eventsApi.desc",
	group: "developer",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		const ev = ctx.events;
		ctx.on("node-added", (n) => ev.emit("node-created", n.canvas, n));
		ctx.on("node-removed", (n) => ev.emit("node-removed", n.canvas, n));
		ctx.on("node-moved", (n) => ev.emit("node-moved", n.canvas, n));
		ctx.on("node-set-data", (n) => ev.emit("node-changed", n.canvas, n));
		ctx.on("node-extra-change", (n) => ev.emit("node-changed", n.canvas, n));
		ctx.on("edge-added", (e) => ev.emit("edge-created", e.canvas, e));
		ctx.on("edge-removed", (e) => ev.emit("edge-removed", e.canvas, e));
		ctx.on("edge-set-data", (e) => ev.emit("edge-changed", e.canvas, e));
		ctx.on("edge-extra-change", (e) => ev.emit("edge-changed", e.canvas, e));
		ctx.on("selection-change", (c) => ev.emit("selection-changed", c, [...c.selection]));
		ctx.on("history-apply", (c, dir) => ev.emit(dir, c));
		ctx.on("readonly-change", (c) => ev.emit("readonly-changed", c, c.readonly));
		ctx.on("data-load", (c) => ev.emit("data-loaded", c, c.data));
		ctx.on("save-before", (c) => ev.emit("before-save", c));
		ctx.on("save-after", (c) => ev.emit("after-save", c));
		ctx.transformData((data, canvas) => {
			ev.emit("data-requested", canvas, data);
			return data;
		});

		// Interactions: one listener per canvas, resolved to the node / edge under the pointer.
		ctx.onCanvas((canvas: CanvasLike) => {
			const handler = (type: InteractionType) => (evt: MouseEvent) => {
				const target = evt.target as Element | null;
				if (!target) return;
				const nodeEl = target.closest(".canvas-node");
				if (nodeEl) {
					for (const node of canvas.nodes.values()) if (node.nodeEl === nodeEl) return ev.emit("node-interaction", canvas, node, type, evt);
					return;
				}
				const g = target.closest(".canvas-edges g");
				if (g) for (const edge of canvas.edges.values()) if (edge.lineGroupEl === g) return ev.emit("edge-interaction", canvas, edge, type, evt);
			};
			const listeners = (["click", "dblclick", "contextmenu"] as const).map((type) => [type, handler(type)] as const);
			for (const [type, fn] of listeners) canvas.wrapperEl.addEventListener(type, fn, true);
			return () => {
				for (const [type, fn] of listeners) canvas.wrapperEl.removeEventListener(type, fn, true);
			};
		});
	},
});
