# Public events

Overpowered Canvas triggers events on `app.workspace`, all prefixed with `overpowered-canvas:`.
Listen from another plugin (or a script) like this:

```ts
this.registerEvent(
	this.app.workspace.on("overpowered-canvas:node-created", (canvas, node) => {
		console.log("new card", node.id, "in", canvas.view.file?.path);
	}),
);
```

`canvas`, `node` and `edge` are Obsidian's own (undocumented) canvas objects. Treat them as
read-only unless you know the internals. Payloads are listed below; types are in
`src/core/events.ts` (`PublicEventMap`).

## Canvas lifecycle (module "Events API")

| Event | Payload | When |
|---|---|---|
| `node-created` | canvas, node | A card or group was added (created, pasted, loaded). |
| `node-removed` | canvas, node | A card or group was removed. |
| `node-moved` | canvas, node | Position or size changed. |
| `node-changed` | canvas, node | Its data changed (setData, undo/redo, our extra data). |
| `edge-created` / `edge-removed` / `edge-changed` | canvas, edge | Same for edges. |
| `node-interaction` | canvas, node, type, evt | `type` is `click`, `dblclick` or `contextmenu`. |
| `edge-interaction` | canvas, edge, type, evt | Same for edges. |
| `selection-changed` | canvas, items | The selection changed. |
| `undo` / `redo` | canvas | After undo / redo applied a step. |
| `readonly-changed` | canvas, readonly | Read-only mode toggled. |
| `data-requested` | canvas, data | `canvas.getData()` produced data (saving, history, copy). |
| `data-loaded` | canvas, data | A file was loaded into the canvas. |
| `before-save` / `after-save` | canvas | Around writing the file. |

## Features (emitted by their modules)

| Event | Payload |
|---|---|
| `module-enabled` / `module-disabled` | moduleId |
| `focus-mode-changed` | canvas, enabled |
| `group-collapsed` / `group-expanded` | group |
| `presentation-started` | canvas, slide |
| `presentation-slide-changed` | canvas, slide, index |
| `presentation-ended` | canvas |
| `selection-encapsulated` | canvas, newFile |
| `portal-opened` / `portal-closed` | canvas, portal |
| `pdf-inserted` | canvas, file, pages |
| `style-attribute-changed` | canvas, item, key, value |
| `layout-applied` | canvas, nodes, algorithm |
| `branch-collapsed` / `branch-expanded` | node |
| `stroke-added` | canvas, carrier, strokeId |
| `strokes-erased` | canvas, count |
| `drawing-mode-changed` | canvas, tool (null = off) |
| `shape-created` / `sticky-created` | canvas, node |
| `item-lock-changed` | canvas, item, locked |
| `minimap-toggled` | canvas, visible |
| `frame-focused` | canvas, frame |
| `board-template-applied` | canvas, templateName |
| `kanban-moved` | canvas, node, file, value |
| `query-group-refreshed` | canvas, group, added, removed |
| `outline-copied` | canvas, cards |
| `outline-inserted` | canvas, nodes |
| `note-exported` | canvasFile, note |
| `canvas-updated-from-note` | canvasFile, note, added, removed, updated |
