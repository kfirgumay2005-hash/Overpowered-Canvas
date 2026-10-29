# Obsidian Canvas internals we rely on

Obsidian's public API does not expose the Canvas view. Everything below is undocumented and
may change in any Obsidian release. Rules:

- Every internal member the plugin touches is listed here **before** it is used.
- Code reaches internals only through `src/internals/` (types, guards, probe) and each
  module's `patches.ts`.
- **Status:** 🟡 *source* = read from Obsidian's bundled `app.js` (used only to form hypotheses);
  🟢 *runtime* = confirmed at runtime with the probe (Diagnostics → “Copy canvas internals report”).
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
3. Enable the **Diagnostics** module and run the command “Copy canvas internals report”. The
   report is copied to the clipboard.
4. Paste the report back to Claude; every 🟡 row confirmed by it becomes 🟢 with the date.

## Phase 1–2 additions (verified at runtime in Obsidian 1.14.4 unless noted)

| Member | What it does | Status |
|---|---|---|
| `canvas.menu.render(rebuild)` / `menu.menuEl` | Selection toolbar; `rebuild=false` only repositions. We append buttons after a rebuild and re-run positioning. | 🟢 runtime |
| `canvas.cardMenuEl`, `canvas.dragTempNode(evt, size, cb)` | Bottom card bar and its drag-to-place helper (cb gets the top-left). | 🟢 runtime |
| `canvas.config.{defaultTextNodeDimensions, defaultFileNodeDimensions, minContainerDimension}` | Per-canvas defaults read by `createTextNode`/`createFileNode` and resizing. | 🟢 runtime |
| `canvas.getEdgesForNode`, `edgeFrom`/`edgeTo` (`add`/`delete`/`getArray`) | Node → edges index. **`edge.setData()` swaps nodes without updating it** (undo/redo of a re-attached end); repaired in the edge setData hook. | 🟢 runtime |
| `node.setIsEditing(bool)` | Edit mode toggle. Text cards edit inside an `iframe.embed-iframe` whose `<body>` carries our body classes and stylesheet but not node attributes → `data-opc-*` are mirrored to it. | 🟢 runtime |
| `node.updateBreakpoint(show)` (base and content subclasses), `node.isContentMounted` | Mounts/unmounts content when crossing the zoom breakpoint; called every frame for attached nodes. | 🟢 runtime |
| `node.zIndex`, `renderZIndex()`, `canvas.zIndexCounter` | Stacking; `getData()` sorts nodes by zIndex, so changes persist. Groups compute zIndex from area. | 🟢 runtime |
| `edge.updatePath()`, `edge.path.{display,interaction}`, `edge.fromLineEnd/toLineEnd.el`, `edge.bezier` | Path drawing; line ends are recreated when the end type changes; `bezier` is only read by `getCenter()` (label and toolbar position). | 🟢 runtime |
| `canvas.setReadonly(bool)`, `canvas.options.defaultWheelBehavior` | Read-only mode; wheel meaning (pan/zoom). | 🟢 runtime |
| workspace events `canvas:node-menu`, `canvas:edge-menu`, `canvas:selection-menu` | Context menus `(menu, item)` / `(menu, canvas)`. | 🟢 runtime |
| `view.scope` | The canvas view's keymap scope (Mod+Z etc.); we register Mod+F there. | 🟢 runtime |
| `view.setEphemeralState({subpath})` | Receives `#subpath` when a link opens the canvas. | 🟢 runtime |
| `app.metadataCache.getCache(path)` / `iterateFileCache(cb)` | Returns `{}` for non-markdown files; we answer for `.canvas` from our in-memory index. | 🟢 runtime |
| `app.metadataCache.getBacklinksForFile`, `resolvedLinks`, `linkUpdaters.canvas` | Already include canvas references (core canvas index). | 🟢 runtime |
| `app.internalPlugins.plugins.canvas.instance.index.getForPath(path)` | Core canvas index: `{ embeds: [{file, subpath}], caches: {nodeId: CachedMetadata} }`. | 🟢 runtime |
| `app.embedRegistry.embedByExtension.canvas(ctx, file, subpath)` | Embed factory for `![[x.canvas…]]`; returns a Component with `loadFile()`. | 🟢 runtime |
| `file-properties` view: `isSupportedFile`, `readSupportedFile`, `saveFrontmatter(fm)`, `updateFrontmatter`, `update` | Core File properties pane; only writes markdown (safe for canvases). We extend it to canvases. | 🟢 runtime |
| `app.fileManager.processFrontMatter(canvasFile)` | No-op on `.canvas` files (verified: file unchanged). | 🟢 runtime |
| `window.electron.remote.dialog.showSaveDialog` | Desktop save dialog used by image export. | 🟢 runtime |
| SVG `<foreignObject>` → `<img>` → `<canvas>` | Not tainted with a `data:` URL; **tainted with a `blob:` URL**. | 🟢 runtime |

## Phase 5 additions

| Member | What it does | Status |
|---|---|---|
| `node.onPointerdown(evt)` on `containerEl` | Starts the drag (mouse only); selection happens on `click` on `nodeEl`. Our ink/line SVGs sit beside `containerEl`, so their `pointerdown` is forwarded to it; the click bubbles to `nodeEl` by itself. | 🟢 runtime |
| `canvas.onPointerdown` on `wrapperEl` | Starts drag-to-select only when the target is the wrapper itself, so overlays and handles need no special care. | 🟢 source |
| `node.aspectRatio` | Kept during resize when non-zero. On image load the core sets it to the image's own ratio and refits the card (`resize` + `overrideHistory`). Image crop intercepts that first `moveAndResize`, switches to the cropped ratio and keeps the stored size. | 🟢 runtime |
| `canvas.markDirty(item)` → next animation frame → `item.render()` | `edge.render()` calls `updatePath()`. Frames don't run while the window is hidden (seen in automated runs), so drags call `edge.updatePath()` directly. | 🟢 runtime |
| `canvas.requestSave()` → `requestPushHistory` (250 ms debounce) | A gesture that writes with `{ history: false }` on every move and calls `requestSave()` once at the end is one undo step. | 🟢 runtime |
| `view.scope` runs only the first matching handler | Our canvas keys share one handler per combo (`ModuleContext.addCanvasKey`), dispatched by priority: sticky notes (Tab, Ctrl+Arrows on stickies) before the mind map, which only acts when its own conditions hold. | 🟢 runtime |

## Phase 6 additions

| Member | What it does | Status |
|---|---|---|
| `canvas.markViewportChanged()` | Called by every pan/zoom (`setViewport`, `panTo`, `panBy`, `zoomBy`, wheel, touch). The minimap patches it to schedule a redraw. | 🟢 runtime |
| `canvas.x`, `canvas.y` | World coordinates of the view's center; `panTo(x, y)` sets them. | 🟢 runtime |
| `.canvas-controls > .canvas-control-group.mod-raised > .canvas-control-item` | The right-side control bar; we append our own groups (minimap, frames) and remove them on disable. | 🟢 runtime |
| `app.viewRegistry.unregisterView(type)` | Lets a module register a workspace view and remove it again when disabled (`ModuleContext.registerView`). | 🟢 runtime |

## Phase 8 additions (performance and RTL)

| Member | What it does | Status |
|---|---|---|
| Canvas frame loop (`requestFrame` → rAF) | Animates `x`/`y`/`zoom` toward `tx`/`ty`/`tZoom` over several frames, applies the transform, then calls `virtualize()` **every frame**. `markViewportChanged()` only starts an animation, so per-frame work hooks `virtualize` (`canvas-frame` hook, `canvas-virtualize` interceptor). | 🟢 runtime |
| `canvas.virtualize()` | Attaches/detaches cards entering/leaving the view (≤ 10 new per frame) and measures the viewport (`getViewportBBox()` → DOM read). The LOD renderer defers it while the view moves. | 🟢 runtime |
| `canvas.getViewportBBox()` | Measures the wrapper (forced layout). Compute the view from `x`, `y`, `scale` and an observed size instead in per-frame code. | 🟢 runtime |
| `menu.render()` | Called every frame while something is selected; positions the toolbar with `getBoundingClientRect` (forced layout) — a core cost, not ours. | 🟢 runtime |
| `wrapperEl.mod-zoomed-out` | Core class when zoomed far out; we drop hover-only elements from the layout with it. | 🟢 runtime |
| Cards in `direction: rtl` | Cards are absolutely positioned without left/right; in an RTL container their static position flips. The transformed `.canvas` layer must stay LTR (direction module); text direction is applied to card content. | 🟢 runtime |
| `p[dir=auto]`, `li[dir=auto]` | The core marks each paragraph and list item for per-paragraph direction, but not the list; `:dir()` + `:has()` mirror lists. | 🟢 runtime |
| `menu.dom` (Menu) after `showAtPosition` | The core gives `.menu` `max-height: 100%` but opens it `top` px down, so long menus run past the window's bottom. `src/ui/menu-fit.ts` caps the height to the visible area (visual viewport, safe-area insets) after canvas menus open. | 🟢 runtime |
| `canvas.zoomToFit()` | Fits `nodes` (all of them). Pages patch it to fit the page shown. | 🟢 runtime |
| `canvas.getEdgesForNode(node)` + `removeEdge` / `importData` | Re-pointing edges when a branch moves to a page (edges are re-created with the new end). | 🟢 runtime |
| 2D canvas `font` setter / `fillText` | Resolve the font against computed style: inside a frame with pending DOM changes this forces a full style pass. Set the font once per context state. | 🟢 runtime |

