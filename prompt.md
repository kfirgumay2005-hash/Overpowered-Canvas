# Build an Obsidian plugin that upgrades Canvas to a Miro-level whiteboard

## How we work
- Talk to me in **Hebrew**. Write code, comments, commit messages and docs in **English**.
- Work in **phases** (see "Roadmap"). At the end of each phase: stop, summarize what was built, give me a step-by-step manual test checklist for Obsidian, and wait for my feedback before starting the next phase.
- You cannot see Obsidian running. When behavior depends on Obsidian's undocumented internals, verify it against the real runtime objects — tell me exactly what to run in the developer console (Ctrl+Shift+I) and I'll paste the output back. Don't guess.
- Commit after each completed feature with a clear message.
- If a requirement is ambiguous, or two requirements conflict, ask me before implementing.

## Goal
One plugin (working name: **Canvas Studio** — rename freely) that:
1. Reproduces **every feature** of two existing community plugins — **Advanced Canvas** and **Canvas MindMap** — listed in detail below.
2. Adds the **Miro-style features that neither plugin, nor core Obsidian Canvas, provides**.
3. Works **on top of Obsidian's native Canvas** (.canvas files, JSON Canvas format), so canvases stay a first-class part of my vault.

## Ground rules
- **This is my own original plugin — NOT a fork.** Do **NOT** fork, clone or start from the repositories of Advanced Canvas or Canvas MindMap, and do **NOT** copy, translate or closely paraphrase their code, file structure or assets. Every line is written from scratch for this project. Advanced Canvas is GPL-3.0; copying from it would force my plugin under GPL, which I don't want. The feature lists below describe *behavior* to build, not code to reuse.
- **How to learn Obsidian's internals:** first from the runtime (developer console) and Obsidian's official typings. Reading other plugins' source is allowed only to understand how Obsidian's internal canvas objects work — never as a template for our code.
- **Ownership & license:** I am the sole author and owner. Don't add a LICENSE file or license headers until I choose a license. Third-party libraries stay unmodified npm dependencies with their own license notices kept (note: `elkjs` is EPL-2.0 — fine as an unmodified dependency, never vendor or modify it).
- **Don't reimplement what core Canvas already has:** snap to grid / snap to objects, the alignment menu (align + distribute/justify), "Jump to group", readonly mode, basic "export as image". Integrate with them and extend only where this spec says so.
- **File format:** stay compatible with **JSON Canvas 1.0**. Store all extra data in **namespaced properties** (e.g. one `"x-studio"` object on nodes, edges and the canvas root — propose the exact schema in Phase 0). A canvas edited with this plugin must still open in vanilla Obsidian with no errors and no data loss (extra visuals may simply not render there).
- **Verify early** that Obsidian preserves unknown properties through load → edit → save. If it doesn't, patch the data get/set path so nothing is ever dropped.
- **Patching internals:** Obsidian's public API does not expose the Canvas view. Use `monkey-around` for all patches, keep each module's patches in one place, make every patch fully reversible on unload/disable, and document every internal property/method you rely on in `docs/INTERNALS.md` (name, what it does, how it was verified, Obsidian version).
- **Modular:** every feature is a module that can be enabled/disabled in settings. A disabled module = zero patches, zero listeners, zero DOM.
- **Offline:** no network calls.
- **Coexistence:** detect if Advanced Canvas or Canvas MindMap are enabled; show a one-time notice listing overlapping modules and offer to disable ours.

## Tech stack
- TypeScript (strict), official Obsidian sample-plugin structure, esbuild.
- `monkey-around` for patches.
- `elkjs` for auto layout (in a web worker if layouts get slow).
- `perfect-freehand` for pen strokes.
- `vitest` for unit tests of pure logic (geometry, layout, schema migrations, parsers).
- Ask me before adding any other dependency; prefer MIT/Apache licenses.

---

## Feature spec

### A. Parity with Advanced Canvas

**Core**
- Extended file format (in the spirit of "Advanced JSON Canvas"), fully compatible with JSON Canvas.
- Metadata cache support for .canvas files: canvases appear in graph view, outgoing links and backlinks.
- Frontmatter for .canvas files: an info button in the canvas view to view/edit properties; support tags, aliases, `cssclasses` (applied to the canvas view) and arbitrary properties; properties are searchable via global search.
- Auto file-node edges: create edges between file nodes based on a frontmatter property (default key `canvas-edges`, configurable).
- Single-node links & embeds: `[[file.canvas#node-id]]` links and `![[file.canvas#node-id]]` embeds render that node's content in markdown; command "Copy wikilink to node".
- Better defaults: enforce grid alignment for new nodes; default text-node size; default file-node size; minimum node size; option to disable font scaling relative to zoom.
- Enhanced readonly: disable popup menus; lock pan; lock zoom; keep zoom-to-selection / zoom-to-fit working.
- Improved image export: PNG and SVG, whole canvas or selection only, transparent background, privacy mode, optional logo.

**Nodes**
- Node templates: "Save node as template" (exactly one node selected) with an icon picker; templates appear in the card menu (bottom bar); right-click → Remove.
- Shapes: terminal, process, decision, input/output, on-page reference, predefined process, document, database, pill (plus the new shapes in section D).
- Border styles: solid, dotted, dashed, invisible. Text alignment: left, center, right.
- Auto-resize node to fit its content (per-node toggle).
- Variable breakpoints: a per-node CSS variable `--variable-breakpoint` controls the zoom level at which node content is unrendered (cache values for performance).
- Alternative text rendering that stops content from jumping between edit mode and reading mode (non-destructive, text nodes inside canvas only).
- Z-order control from the context menu (forward, backward, to front, to back).
- Custom colors in the color picker via CSS variables `--canvas-color-N` (N > 6).
- Create groups independently of nodes.

**Edges**
- Path styles: solid, dotted, short-dashed, long-dashed.
- Arrow styles: triangle, triangle outline, halved triangle, thin triangle, diamond, diamond outline, circle, circle outline, blunted, none.
- Pathfinding: default (bezier), straight, squared (orthogonal), A* (routes around nodes).
- Floating edges: dropping an edge end on a drop zone inside a node makes it attach to the best side automatically.
- Flip edge direction in one click.
- Highlight edges connected to the selected node(s) (styleable through a CSS class).
- Select connected edges; select only incoming or only outgoing edges.

**Interaction**
- A full canvas command suite (propose the list: create, select, move, zoom, style, etc.).
- Ctrl/Cmd+F search inside the canvas with a native-like UI; jump between results.
- Presentation mode: mark a start slide; navigate along edges with arrow keys / PageUp / PageDown (compatible with presentation remotes); numbered edges define order when a node has several outgoing edges; presentation forces readonly; ESC exits; "Continue presentation" resumes from the last slide; a card-menu action creates slides with consistent dimensions.
- PDF annotation: a `pinned=true` embed parameter shows a single page; command "Insert PDF for annotation" (one node per page, locked aspect ratio); command "Pin PDF page".
- Portals: embed another canvas inline, see its nodes, and create edges into the embedded canvas's nodes.
- Collapsible groups.
- Focus mode: blur everything except the focused node (connected edges stay sharp when edge highlight is on).
- Encapsulate selection: move the selected nodes into a new canvas and leave a link node in their place.

**Styling & extensibility**
- Custom style attributes declared in CSS snippets through a YAML block inside a CSS comment (separate markers for node styles and edge styles; fields: key, label, optional lucide icon, options — exactly one option has value `null`). Values are exposed as `data-*` attributes on node/edge elements (and on the body of node iframes) so CSS can target them, and they appear in the popup menu automatically.
- Public events, prefixed (e.g. `canvas-studio:`), via `app.workspace.on`: node interaction, edge interaction, undo, redo, readonly changed, data requested, data loaded, before save, after save — plus events for every new feature in section D.

### B. Parity with Canvas MindMap
- `Tab`: create a child node (when not in text-edit mode). `Enter`: create a sibling node (hotkey configurable).
- `Alt+Arrows`: navigate between nodes. `Ctrl/Cmd+Arrows`: create a floating node in that direction. `Ctrl/Cmd+Shift+Arrows`: create a child node in that direction.
- Auto layout of a tree in a chosen direction.
- Select a node's whole subtree.
- Change the color of a node's edges.
- Commands: create child / sibling / floating node, enter/exit edit mode.

### C. Core Canvas features to respect (do not duplicate)
Snap to grid, snap to objects, alignment & distribute menu, Jump to group, readonly mode, basic image export. Nothing we add may break them.

### D. New features (not in either plugin)

**Drawing & creation**
1. **Freehand layer:** pen, highlighter, eraser (whole-stroke and partial), pressure from pointer events (stylus), smoothing via perfect-freehand, color/size picker, lasso-select strokes, move/resize strokes. Strokes are stored in the canvas file and are undoable. Toggle drawing mode with a hotkey (default `P`); `Esc` returns to select mode.
   - **Stylus support:** palm rejection (ignore touch input while a pen is active or in contact); a "pen-only drawing" mode where the pen draws and fingers pan/zoom without switching tools; the stylus barrel button and eraser end (where the hardware reports them through pointer events) switch to the eraser automatically; tilt (`tiltX` / `tiltY` / `altitudeAngle`) shapes the stroke like a real pencil; hover preview of the brush where supported. Degrade gracefully when a device doesn't report a property. Give me test steps for iPad + Apple Pencil and for a Windows/Android pen.
   - **Drawing extras:** brush presets (pen, pencil, marker); recent-colors row; adjustable smoothing; shape recognition — hold at the end of a stroke to turn a rough circle / rectangle / triangle / line / arrow into a clean standalone shape (#2).
2. **Standalone shapes:** rectangle, rounded rectangle, ellipse, diamond, triangle, parallelogram, trapezoid, pentagon, hexagon, octagon, star, cross, heart, cylinder, cloud, speech bubble, callout, block arrows (left / right / up / down / double), line, arrow — with fill, stroke, opacity, optional text inside; resizable and rotatable.
3. **Free lines and arrows:** can exist unattached, or attach to a node/shape at either end; attached ends follow the node when it moves.
4. **Sticky notes:** a dedicated node type — square by default, sticky-note colors, font auto-shrinks so the text always fits, `Tab`/arrow creates the next sticky right next to it with the same style, optional author/date footer.
5. **Image crop:** non-destructive (store a crop rectangle), with "reset crop".

**Layout & structure**
6. **Auto-layout engine (elkjs)** for the selection or the whole canvas: mind map (left / right / up / down / radial / balanced on both sides), layered/hierarchical (flowcharts, respects edge direction), compact grid pack. Animated transition; the whole layout is a single undo step.
7. **Collapse/expand mind-map branches** with a child-count badge; collapsed state persisted in the file.
8. **Manual edge waypoints:** add, drag and remove bend points; stored in the file; manual waypoints override the pathfinding mode.
9. **Lock items:** lock position/size of individual nodes, shapes and strokes; visible lock indicator; locked items are selectable but not draggable.
10. **Edge labels:** label position draggable along the edge.

**Navigation**
11. **Minimap overlay** (toggle + hotkey): shows nodes, shapes, strokes and the current viewport; click/drag to navigate; corner position configurable.
12. **Frames panel:** a side panel (ItemView) listing all groups ("frames") of the active canvas — searchable, click to zoom to a frame, drag to reorder. Optional presentation mode that steps through frames in panel order (an alternative to edge-based presentation).

**Obsidian data integration**
13. **Board templates:** save an entire canvas (or a selection) as a template; "New canvas from template"; ship built-ins: Kanban, SWOT, Retro, Weekly plan, Mind map, Flowchart.
14. **Kanban mode with two-way sync:** a group can be bound to a frontmatter property value (e.g. `status: doing`). Moving a file node into that group updates the note's frontmatter; changing the property elsewhere moves the node on next open/refresh. Document the conflict rules.
15. **Query groups:** a group defined by a filter (tag, folder, property, links) auto-populates with file nodes for matching notes; manual "Refresh" plus optional auto-refresh; new matches are placed in a grid inside the group.

**RTL & language**
16. **Full RTL support:** global and per-canvas direction setting; text and sticky nodes render correctly in RTL (`dir="rtl"` or `auto`), including lists, checkboxes and mixed Hebrew/English; mind map and auto-layout mirror (children go to the left in RTL); keyboard navigation maps arrows logically in RTL; menus and panels mirror when Obsidian's UI is RTL.
17. **Localization:** English and Hebrew UI; all UI strings go through an i18n layer.

---

## Cross-cutting requirements
- **Undo/redo:** every mutation from every module integrates with the canvas's own history; one user action = one undo step.
- **Performance:** canvases with 1,000+ nodes and 2,000+ strokes must stay smooth (target 60 fps pan/zoom on a mid-range laptop). Cull/virtualize off-screen strokes and shapes. Write a script that generates a stress-test canvas, and benchmark before and after each phase.
- **Mobile:** the plugin must load on Obsidian mobile; features that can't work there are disabled gracefully; drawing supports touch and stylus.
- **Settings tab:** grouped by module, each with an enable toggle, its options, and "reset to defaults".
- **Commands:** every action is available in the command palette, with sensible default hotkeys that don't conflict with core hotkeys.
- **Schema versioning:** version the extra-data schema; write migrations with unit tests.
- **Data safety:** a failure in any module must never corrupt a canvas file; validate data before saving.
- **Accessibility basics:** menus reachable by keyboard, visible focus states.

## Roadmap
- **Phase 0 — Setup & research:** scaffold, module system, settings framework, i18n layer, data-schema proposal, unknown-property preservation test, `docs/INTERNALS.md`, dev-vault instructions with hot reload, stress-test canvas generator.
- **Phase 1 — Nodes & edges:** defaults, shapes, borders, text alignment, auto-resize, z-order, custom colors, node templates, edge styles, arrows, pathfinding, floating edges, flip, highlight, edge selection.
- **Phase 2 — Vault integration:** metadata cache, frontmatter, auto edges, single-node links/embeds, in-canvas search, readonly enhancements, image export.
- **Phase 3 — Interaction:** presentation mode, portals, collapsible groups, focus mode, encapsulate, PDF annotation, custom style attributes, events API.
- **Phase 4 — Mind map:** full Canvas MindMap parity + collapse branches (#7) + elkjs auto-layout (#6) + RTL mirroring.
- **Phase 5 — Drawing & shapes:** #1–#5 and #8–#10.
- **Phase 6 — Navigation:** minimap, frames panel (#11–#12).
- **Phase 7 — Data features:** board templates, kanban two-way sync, query groups (#13–#15).
- **Phase 8 — Hardening:** full RTL pass, Hebrew localization, performance pass, mobile pass, README.

## Definition of done (every feature)
- Works with its module enabled; disabling the module removes all of its effects.
- Undo/redo works.
- Survives save → close → reopen, and the file still opens cleanly in vanilla Obsidian.
- Works in RTL.
- Unit tests for any pure logic; manual test steps added to `docs/TESTING.md`.

## Start now
Begin with Phase 0. Before writing the bulk of the code, show me the proposed folder structure, the module interface, and the data schema (explain in Hebrew, code in English), and wait for my OK.
