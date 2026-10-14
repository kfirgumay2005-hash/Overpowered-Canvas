# Obsidian Canvas internals we rely on

Obsidian's public API does not expose the Canvas view. Everything below is undocumented and
may change in any Obsidian release. Rules:

- Every internal member the plugin touches is listed here **before** it is used.
- Code reaches internals only through `src/internals/` (types, guards, probe) and each
  module's `patches.ts`.
- **Status:** 🟡 *source* = read from Obsidian's bundled `app.js` (used only to form hypotheses);
  🟢 *runtime* = confirmed in the developer console with the probe (`scripts/console/probe-internals.js`).
  A member is not relied on in a released phase until it is 🟢.
- The core refuses to touch a canvas view whose shape doesn't match
  (`findCanvasShapeProblems` in `src/internals/guards.ts`) and logs the mismatch instead.

Verified against: **Obsidian 1.14.4 (desktop, Windows)**.

## Views

| Member | What it does | Status |
|---|---|---|
| view type `"canvas"` | `workspace.getLeavesOfType("canvas")` returns canvas leaves; deferred leaves have no `view.canvas` yet and are skipped. | 🟡 source |
| `view.canvas` | The Canvas instance owned by the view. Survives switching files in the same leaf (`setViewData(data, clear=true)` clears and reloads it). | 🟡 source |
| `view.file` | The `.canvas` TFile. | 🟡 source |
| `view.getViewData()` | Serializes `canvas.data` with a tab-indented printer that keeps all-primitive objects and arrays on one line. | 🟡 source |
| `view.setViewData(text, clear)` | `JSON.parse` → `canvas.setData(...)`. Empty text → placeholder. A parse error throws (vanilla behavior). | 🟡 source |
| `view.requestSave()` | Debounced write of `getViewData()` to disk (standard `TextFileView`). | 🟡 source |

## Canvas

| Member | What it does | Status |
|---|---|---|
| `nodes: Map<id, node>`, `edges: Map<id, edge>` | Live items. | 🟡 source |
| `selection: Set<node \| edge>` | Current selection. | 🟡 source |
| `data` | Last full file data. **`getData()` returns `{...data, nodes, edges}`, so root-level unknown keys survive saves.** | 🟡 source |
| `getData()` | Rebuilds nodes (sorted by z-index) and edges from the live items. | 🟡 source |
| `setData(d)` | `importData(d, true)`, `data = d`, `pushHistory(d)`. `{}` shows the placeholder. | 🟡 source |
| `importData(d, clear)` | Creates/updates items. **Nodes with a type other than text/file/link/group are skipped**, and so are edges whose endpoints are missing — they are dropped on the next save. | 🟡 source |
| `requestSave(pushHistory = true)` | `data = getData()`, `requestPushHistory(data)`, `view.requestSave()`. | 🟡 source |
| `requestPushHistory` | `debounce(pushHistory, 250, true)` — Obsidian `Debouncer` with `run()` / `cancel()`. | 🟡 source |
| `pushHistory(d)` / `history` | `history = { data: snapshot[], current, max: 100 }` with `canUndo/canRedo/undo/redo/push/replace/clear`. Snapshots are full `getData()` results. | 🟡 source |
| `undo()` / `redo()` / `applyHistory(d)` | `importData(d, true)`, `data = d`, `view.requestSave()`. | 🟡 source |
| `markDirty(item)` / `markMoved(item)` / `requestFrame()` | Schedule re-render / re-index / a render frame. | 🟡 source |
| `x`, `y`, `zoom` | Viewport. `zoom` is log2 of the scale. | 🟡 source |
| `setViewport(x, y, zoom)` | Jumps the viewport (used by the benchmark). | 🟡 source |
| `zoomToFit()`, `zoomToSelection()`, `zoomToBbox(bbox)`, `getViewportBBox()` | Viewport helpers. | 🟡 source |
| `readonly` | Core read-only mode flag (`setReadonly(bool)`). | 🟡 source |
| `wrapperEl`, `canvasEl`, `cardMenuEl` | DOM roots: whole view / transformed layer / bottom card menu. | 🟡 source |
| `config.defaultTextNodeDimensions`, `config.defaultFileNodeDimensions` | `{250×60}` and `{400×400}` — "better defaults" in Phase 1. | 🟡 source |

### History — consequences for this plugin

1. Every change to `x-opc` (on items or the root) is part of the native undo stack automatically,
   because snapshots come from `getData()`.
2. **Snapshots are shallow.** `node.getData()` spreads `unknownData`, so the object stored under
   `"x-opc"` is *shared* between the live node and every snapshot. Mutating it in place would
   silently rewrite history. **All `x-opc` writes create new objects** (`src/data/access.ts`).
3. One user action = one undo step: `ctx.history.transaction(canvas, fn)` flushes any pending
   snapshot, runs `fn`, cancels what Obsidian queued meanwhile, then pushes exactly one snapshot
   (`src/core/history.ts`). If `fn` throws, the canvas is restored from the pre-transaction snapshot.
4. Undo/redo re-applies data through `importData`, which calls `node.setData` — this is where
   modules will hook re-rendering of their visuals (Phase 1).

## Nodes

| Member | What it does | Status |
|---|---|---|
| `x, y, width, height, color` | Geometry and color. `setData` rounds coordinates. | 🟡 source |
| `unknownData` | Everything in the node JSON except `x/y/width/height/color` (it also holds `id`, `type`, `text`…). `getData()` spreads it first, then writes the known fields. **Our `"x-opc"` key lives here.** | 🟡 source |
| `getData()` / `setData(d)` | Serialize / apply. Subclasses add `text` (text), `file`+`subpath` (file), `url` (link), `label`+`background`+`backgroundStyle` (group). | 🟡 source |
| `nodeEl` | Root DOM element (`.canvas-node`). | 🟡 source |
| `render()`, `getBBox()`, `moveTo`, `resize`, `moveAndResize`, `setColor`, `updateBreakpoint`, `showMenu` | Rendering, geometry and menus — used from Phase 1 on. | 🟡 source |

## Edges

| Member | What it does | Status |
|---|---|---|
| `from`, `to` | `{ node, side, end }`; `end` is `"none"` or `"arrow"`. Defaults: `fromEnd: none`, `toEnd: arrow`. | 🟡 source |
| `unknownData`, `getData()`, `setData(d)` | Same pattern as nodes. | 🟡 source |
| `lineGroupEl`, `lineEndGroupEl`, `path`, `labelElement` | SVG/DOM parts — Phase 1. | 🟡 source |

## Workspace / app

| Member | What it does | Status |
|---|---|---|
| `canvas:node-menu`, `canvas:edge-menu`, `canvas:selection-menu`, `canvas:node-connection-drop-menu` | Workspace events fired when Obsidian builds canvas context menus. | 🟡 source |
| `app.plugins.enabledPlugins: Set<string>` | Enabled community plugin ids (coexistence check). Falls back to "none enabled" if missing. | 🟡 source |

## How to verify (runtime)

1. Disable **Advanced Canvas** (it patches the same objects) and reload Obsidian (Ctrl+R).
2. Open a canvas that contains a text card, a group and at least one edge; click into it.
3. Open the developer console (Ctrl+Shift+I). Type `allow pasting` if Chrome asks.
4. Paste the contents of `scripts/console/probe-internals.js` and press Enter. The report is
   printed and copied to the clipboard.
5. Paste the report back to Claude; every 🟡 row confirmed by it becomes 🟢 with the date.

The same report is available from the **Diagnostics** module: command
“Copy canvas internals report”.
