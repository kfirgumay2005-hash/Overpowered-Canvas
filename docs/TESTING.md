# Testing

## Automated

`npm test` runs the vitest suite: i18n tables, settings sanitizing, module dependency order,
overlap detection, `x-opc` validators, file validation, migrations, history transactions (against
a fake canvas that mirrors Obsidian 1.14's behavior), benchmark statistics, and the generators.

## Manual — Phase 0

### 0.1 Plugin loads with zero footprint
1. `npm run build`, then *Settings → Community plugins* → enable **Overpowered Canvas**.
2. Open the developer console (Ctrl+Shift+I): no red errors mentioning `overpowered-canvas`.
3. In the console run:
   `app.plugins.plugins["overpowered-canvas"].patcher.list()` → `[]`
   `[...document.body.classList].filter(c => c.startsWith("opc-"))` → `[]`
4. Command palette, type "Overpowered": no commands (every module is off by default).

### 0.2 Settings tab and modules
1. *Settings → Overpowered Canvas*: a language dropdown, a **Developer** group with
   **Diagnostics**, and the "Overlap notice" row.
2. Turn **Diagnostics** on → its options appear under it; the command palette now has three
   "Overpowered Canvas: …" commands; `document.body.classList.contains("opc-mod-diagnostics")` → `true`.
3. Turn it off → the commands disappear, the class is gone, `patcher.list()` is `[]`.
4. Turn it on, change *Benchmark length* to 120, click ↺ (reset) → back to 300.
5. Restart Obsidian → the enabled state and settings are remembered.

### 0.3 Language
1. Set *Interface language* to Hebrew → the settings tab redraws in Hebrew (full RTL mirroring is Phase 8).
2. Reload the plugin → command names are in Hebrew too. Set it back to "Same as Obsidian".

### 0.4 Coexistence notice
1. With Advanced Canvas enabled there is **no** notice in Phase 0 (no module overlaps it yet).
   From Phase 1 on, enabling an overlapping module while Advanced Canvas is on shows the notice
   once on the next start.

### 0.5 Unknown-property preservation (vanilla Obsidian)
1. *Community plugins*: turn off **Advanced Canvas** and **Overpowered Canvas**, then Ctrl+R.
2. In a terminal in the plugin folder: `node scripts/roundtrip.mjs create`.
3. Open `OPC Tests/roundtrip.canvas`. Move the yellow card a little, Ctrl+Z, Ctrl+Shift+Z,
   move the shape card, wait two seconds, close the tab.
4. `node scripts/roundtrip.mjs check` → expect `PASS`: every extra property survives, and only
   `rt-custom` / `rt-e2` (non-standard node type) are dropped.

### 0.6 Internals probe
1. Same state as 0.5 (Advanced Canvas off). Open `OPC Tests/roundtrip.canvas`, click into it.
2. Console → paste `scripts/console/probe-internals.js` → Enter. The report is copied; send it
   back. Expect `problems: []`, `roundTrip.node/edge/root: true`, `historyIsShallow: true`.

### 0.7 Stress canvas and baseline benchmark
1. `npm run stress` → open `OPC Tests/stress-1000.canvas`; it opens without errors.
2. Enable **Diagnostics**, press Shift+1 (zoom to fit), run *Run pan/zoom benchmark*; don't touch
   anything until the notice appears. Paste the copied JSON into `docs/BENCHMARKS.md`.
3. Run it once with Advanced Canvas off and once with it on, for comparison.

## Manual — Phase 1 (nodes & edges)

Automated runtime checks of every item below were run in an isolated Obsidian 1.14.4 instance
(see DEV.md → "Runtime harness"). Repeat them by hand in your vault:

### Nodes
1. **Shapes:** select a text card → toolbar "Shape" → pick *Decision*. The card becomes a diamond,
   text stays centered. Pick *No shape* → back to a card. Ctrl+Z / Ctrl+Shift+Z step through it.
2. **Borders:** toolbar "Border style" → Dashed / Dotted / Invisible (also on shapes and groups).
3. **Text alignment:** toolbar "Text alignment" → Center. Double-click to edit: the editor is
   centered too. In an RTL note "Align to start" aligns right.
4. **Auto-resize:** toolbar "Auto-resize" on a text card, type several lines → the card grows;
   delete lines → it shrinks. The toggle shows as active.
5. **Z-order:** overlap two cards, right-click → *Send to back* / *Bring to front*; reopen the file:
   the order is kept.
6. **Custom colors:** add a CSS snippet with `body { --canvas-color-7: #ff0080; }` → the color
   picker gets an extra swatch; pick it → reopen the file → still colored.
7. **Card templates:** right-click a card → *Save card as template* → name + icon → a new button
   appears in the bottom bar; click it (adds at center) or drag it; right-click it → remove.
8. **Empty group:** bottom bar → group button (click or drag).
9. **Better defaults:** create a card by double-click → it lands on the grid and uses the default
   size from settings. Toggle *Disable label scaling* and zoom out: labels keep their size.
10. **Variable breakpoints:** right-click a card → *Set content zoom breakpoint…* → `0`; zoom out
    below 100%: only that card shows its placeholder.
11. **Stable text rendering** (off by default): enable it; double-click a card with a heading and
    paragraphs: the text no longer jumps between reading and editing.

### Edges
12. **Line style / arrowheads:** select an edge → toolbar "Line style" (dotted/dashed) and
    "Arrowheads" (start/end: diamond, circle, outline…).
13. **Route:** toolbar "Route" → Straight / Right angles / Around cards (A*). Put a card between
    the two ends: the A* edge goes around it. Settings → default route for all edges.
14. **Floating edges:** drag from a card's connection dot and drop on the dashed zone in the middle
    of another card. Move the cards around: the edge always attaches to the facing sides.
15. **Flip / highlight / select:** select an edge → "Flip edge direction". Select a card → its edges
    are highlighted; right-click → *Select incoming edges*.

### Footprint
16. Settings → turn every module off → console: `app.plugins.plugins["overpowered-canvas"].patcher.list()`
    is `[]`, no `opc-` classes on `<body>`, canvases look exactly like vanilla.

## Manual — Phase 2 (vault integration)

1. **Metadata:** open a canvas with a card linking `[[Some note]]` and a `#tag`. The outgoing-links
   pane lists the link, the tag pane lists the tag; Some note's backlinks show the canvas (core).
2. **Properties:** click the ⓘ button in the canvas header → add `tags: project`, `aliases: Board`,
   `cssclasses: wide-board` → Save. Ctrl+Z undoes it. The quick switcher finds the canvas by
   "Board"; search `tag:#project` finds it; a snippet `.wide-board .canvas-wrapper { … }` applies.
   The core *File properties* pane shows and edits the same properties.
3. **Auto edges:** in note A add `canvas-edges: ["[[B]]"]`; put note cards A and B on a canvas → an
   edge appears. Remove the line from A → the edge disappears. Manual edges are never removed.
4. **Card links/embeds:** right-click a card → *Copy link to card*. Paste into a note: clicking it
   opens the canvas zoomed to the card. `![[file.canvas#<id>]]` renders the card in the note.
5. **Search:** in a canvas press Ctrl/Cmd+F → type → matches are outlined, Enter / Shift+Enter jump,
   Esc closes. Hebrew with or without niqqud matches.
6. **Read-only:** settings → lock panning/zooming → toggle the canvas read-only (lock button):
   scrolling and Ctrl+scroll don't move it, the toolbar over selections is hidden, Shift+1 still
   zooms to fit.
7. **Export:** Command palette → *Export canvas as image…* → PNG/SVG, whole canvas or selection,
   transparent background, privacy mode, watermark. Open the file: it matches the canvas.

## Manual — Phase 3 (interaction)

1. **Presentation:** right-click a card → *Set as start slide* (▶ badge). Connect slides with edges;
   give a slide two outgoing edges labelled `1` and `2`. Command *Start presentation*: full screen,
   read-only; → / PageDown / Space advance (following `1` first, then back to `2`), ← goes back,
   Esc ends. *Continue presentation* resumes where you stopped. Bottom bar → *Add slide*.
2. **Portals:** add a note card for another `.canvas` → select it → toolbar *Open portal*: its cards
   appear inside (dotted, not movable or editable). Connect a card of this canvas to one inside.
   Close and reopen the file: the edge still points into the portal. In vanilla Obsidian the edge
   points at the portal card.
3. **Collapsible groups:** chevron at a group's top corner → contents and their edges hide; Ctrl+Z.
4. **Focus mode:** select a card → command *Toggle focus mode* → the rest blurs.
5. **Encapsulate:** select cards → right-click → *Move selection to new canvas* → a card linking to
   the new canvas takes their place; outside edges now attach to it; Ctrl+Z restores the cards.
6. **PDF:** command *Insert PDF for annotation…* → one pinned card per page (aspect ratio locked).
   Right-click a regular PDF card → *Pin PDF page* pins the page it shows.
7. **Style attributes:** create a snippet with an `/* @opc-node-style … */` block (see the module
   description) and enable it → a new toolbar button sets `data-<key>` on the card.
8. **Events:** see docs/EVENTS.md; in the console:
   `app.workspace.on("overpowered-canvas:node-created", (c, n) => console.log(n.id))`, then add a card.

## Manual — Phase 4 (mind map)

1. Select a card → **Tab** adds a child to the right (left in an RTL canvas) and opens it for
   typing; **Esc**, then **Enter** adds a sibling under it. **Alt+Arrows** move between cards;
   **Ctrl/Cmd+Arrows** add a floating card; **Ctrl/Cmd+Shift+Arrows** add a child in that direction.
2. Right-click a card with children → *Select subtree*, *Color outgoing edges like the card*.
3. Hover a parent card: a small badge appears on the children's side; click it → the branch folds
   and the badge shows the number of hidden cards; Ctrl+Z unfolds.
4. Select the root → command *Auto layout: balanced mind map*, or *Auto layout…* for direction
   (forward/backward/down/up/radial/balanced), flowchart (layered) or grid; whole canvas or
   selection. The cards animate into place; one Ctrl+Z restores the previous arrangement.

## Manual — Phase 5 (drawing, shapes, stickies)

1. **Drawing:** open a canvas, press **P** (or the pen button in the bottom bar). Draw with the
   pen, pencil, marker and highlighter; change color and size. With a stylus, pressure changes
   the width; touch while the pen is down is ignored. Esc or ✕ leaves drawing mode.
2. **Shape recognition:** draw a rough rectangle / ellipse / triangle / line and **hold still**
   at the end for half a second: a dashed preview appears; release → a clean shape (or line).
3. **Eraser:** whole-stroke mode removes touched strokes; *More options → Eraser → Partial*
   cuts them. The pen's eraser end erases too. Each erase gesture is one Ctrl+Z.
4. **Lasso:** select tool → circle some strokes → drag inside the box to move, drag the corner
   to scale, Delete removes, the lock button locks them (the eraser skips locked strokes).
5. **Lines and arrows:** arrow tool → drag from one card to another: the arrow attaches to both
   and follows them when they move. Select it → drag an end handle onto a third card (or into
   empty space to detach). Toolbar → line style (arrowheads, width) and *Reverse direction*;
   the regular color button recolors it.
6. **Shapes:** bottom bar → shapes button → pick a star. Select it → *Shape style*: change the
   shape, fill (light / solid / none), outline width, opacity and rotation. Type text into it:
   the text stays upright when rotated.
7. **Sticky notes:** bottom bar → sticky button (right-click for a color). Type a short word —
   big text; a long paragraph — the text shrinks. Esc, then **Tab** → the next sticky appears
   beside it (to the left in an RTL canvas); **Ctrl/Cmd+Arrows** add one in that direction.
   Settings → *Sticky notes* → enable the author and date footer, set your name, add a note.
8. **Image crop:** select an image card → *Crop image* → drag the box or its handles, try 1:1;
   Apply. Resize the card: it keeps the cropped proportions. Close and reopen the file: still
   cropped. Right-click → *Reset crop*.
9. **Edge editing:** select an edge → drag the small dot in its middle to add a bend; drag
   the new bend; double-click it to remove it. With a label, drag the diamond above the label to
   slide it along the edge (double-click centers it).
10. **Lock:** select cards → toolbar lock button (or right-click → *Lock*): they can't be dragged,
    resized or edited; a lock badge shows on hover. Unlock the same way.
11. **Footprint:** disable all Phase 5 modules in settings → no `data-opc-kind`, handles,
    badges or overlays remain; ink cards show ✏️ and lines/shapes/stickies show as plain cards.

### Stylus

**iPad + Apple Pencil** (Obsidian for iPadOS)
1. Open a canvas, tap the pen button in the bottom bar. Draw with the Pencil: pressing harder
   makes the line thicker; with the *Pencil* tool, tilting the Pencil widens the stroke.
2. Rest your palm on the screen while drawing: no stray marks (touches are ignored while the
   Pencil is active and for a moment after).
3. *More options* → *Pen only*: the Pencil draws, one or two fingers pan and pinch-zoom.
4. Hover the Pencil above the screen (M2 iPad and newer): a circle previews the brush.
5. Double-tapping the Pencil (if set to *switch to eraser* in iPadOS) is not reported to web
   apps; use the eraser button.

**Windows / Android pen** (Surface Pen, Wacom, Samsung S Pen)
1. Draw with pressure as above. Flip the pen to its eraser end (Surface/Wacom) → it erases
   without changing tools; flip back → the previous tool continues.
2. Hold the barrel button while drawing → it erases (where the hardware reports it as the
   eraser button).
3. With a finger on a touchscreen: *Pen only* off → the finger draws; on → the finger pans.
4. Devices that don't report pressure or tilt (mouse, some pens) draw an even line.

## Manual — Phase 6 (navigation)

1. **Minimap:** open a canvas with content → a map in the top-start corner shows cards, groups,
   shapes, lines, strokes and the current view (accent rectangle). Click a spot → the view jumps
   there; drag the rectangle → the view follows. Press **M** (or the map button in the canvas
   controls) to hide/show it. Settings → *Minimap* → change the corner and width. In an RTL
   canvas "start" is the right side.
2. **Frames panel:** canvas controls → frame button (or command *Open frames panel*) → the right
   sidebar lists the groups in reading order. Type in the search box to filter. Click a frame →
   the canvas zooms to it and selects it. Drag a frame up or down in the list → the order is
   stored in the canvas (Ctrl+Z in the canvas restores it; reopen the file → order kept).
3. **Present frames:** panel → presentation button (or command *Present frames*): full screen,
   read-only; → / Space / PageDown next, ← / PageUp back, Home / End, Esc ends. Right-click a
   frame in the panel to start from it.

## Manual — Phase 7 (data features)

1. **Templates:** command *New canvas from template…* → choose *Kanban* → a new canvas with
   To do / Doing / Done opens (in Hebrew UI: Hebrew labels; in an RTL UI the columns run right
   to left). Try SWOT, Retrospective, Weekly plan (week starts on Sunday in Hebrew), Mind map,
   Flowchart. In an existing canvas: bottom bar → template button (or *Insert template…*) →
   the template lands in the middle of the view, selected; one Ctrl+Z removes it.
2. **Your own templates:** select some cards → right-click → *Save selection as template*
   (or *Save canvas as template*) → a canvas file appears in *Canvas templates*; it is listed
   first in the template picker. Right-click a folder → *New canvas from template…* creates
   the canvas there.
3. **Kanban:** create notes with `status: todo`. In the Kanban board, drag them from the file
   explorer into *To do*. Drag a card to *Doing* → the note's `status` becomes `doing`. Edit a
   note's status to `done` in the note → the card moves to *Done*. Ctrl+Z in the canvas → the
   card goes back and the note follows. Right-click a group → *Kanban: bind to property…* to
   bind your own columns (any property). Rules: docs/KANBAN.md.
4. **Query groups:** create a group → right-click → *Query group: set filter…* → tags
   `project` → Apply → cards for every note tagged #project (or #project/…) appear in a grid,
   and the group grows to fit. Remove the tag from a note → the refresh button on the group's
   badge (or *Refresh all query groups*) removes its card; cards you add by hand stay. With
   *Refresh automatically*, changes apply by themselves.

## Manual — Phase 8 (hardening)

1. **RTL canvas:** command *Canvas direction: right to left* → the controls and card bar move
   to the left side, the minimap to the right, cards stay where they were. Select a card →
   Tab: the mind map child appears on the left. Insert the *Kanban* template: columns run right
   to left. Command *Canvas direction: follow settings* reverts (the setting is stored in the
   file, `x-opc.dir`). Settings → *Right-to-left support* → *Canvas direction* applies to all.
2. **Mixed text:** a card with `שלום world`, `Hello עולם`, a Hebrew bullet list and a task →
   each paragraph takes its own direction; bullets, numbers and checkboxes sit on the right for
   Hebrew lists. Toolbar → *Text direction* forces LTR/RTL for a card (also while editing).
3. **Hebrew UI:** Settings → language → Hebrew → reload the plugin: every command, menu,
   tooltip and setting is in Hebrew, consistent terms (קנבס, קשתות, כרטיס).
4. **Large canvas:** `npm run stress` → open `stress-1000.canvas` → zoom to fit: the canvas
   switches to the fast renderer (cards as simple boxes, group labels readable); panning and
   zooming are smooth. Click a card → it gets selected; drag it → it moves; zoom in past 25 % →
   normal cards return. Diagnostics → *Measure pan and zoom performance* gives the fps.
5. **Mobile:** open the vault on a phone/tablet → the plugin loads; drawing works with a finger
   (pen-only mode off) and with a stylus; image export saves into the attachment folder.

