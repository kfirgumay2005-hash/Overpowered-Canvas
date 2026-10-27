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
1. Set *Interface language* to Japanese (or Chinese / Hindi) → the settings tab redraws in that language.
2. Reload the plugin → command names are translated too. Set it back to "Same as Obsidian".

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
2. Command “Copy canvas internals report” (Diagnostics module). The report is copied; send it
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
5. **Layers:** see Round 3 below (they replace the old z-order commands).
6. **Custom colors:** add a CSS snippet with `body { --canvas-color-7: #ff0080; }` → the color
   picker gets an extra swatch; pick it → reopen the file → still colored.
7. **Card templates:** right-click a card → *Save card as template* → name + icon → a new button
   appears in the bottom bar; click it (adds at center) or drag it; right-click it → remove.
8. **Empty group:** bottom bar → group button (click or drag).
9. **Better defaults:** create a card by double-click → it lands on the grid and uses the default
   size from settings. Toggle *Disable label scaling* and zoom out: labels keep their size.
10. **Variable breakpoints:** right-click a card → *Set content zoom breakpoint…* → `0`; zoom out
    below 100%: only that card shows its placeholder.
11. **Stable text rendering** (always on, no setting): double-click a card with a heading and
    paragraphs: the text doesn't jump between reading and editing.

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
3. **UI languages:** Settings → language → Chinese / Japanese / Hindi → reload the plugin: every
   command, menu, tooltip and setting is translated. (The Hebrew UI was removed in 0.2.)
4. **Large canvas:** `npm run stress` → open `stress-1000.canvas` → zoom to fit: the canvas
   switches to the fast renderer (cards as simple boxes, group labels readable); panning and
   zooming are smooth. Click a card → it gets selected; drag it → it moves; zoom in past 25 % →
   normal cards return. Diagnostics → *Measure pan and zoom performance* gives the fps.
5. **Commands:** command palette → type "Overpowered Canvas": *Add text card / note card / web
   page card*, *Group the selected cards*, *Select everything*, *Duplicate selection*, *Move
   selection up/down/left/right* (one grid step, one undo each), *Zoom in/out/to 100%/to fit/to
   selection*, *Toggle read-only*, and *Selection: …* for every toolbar picker (shape, border,
   alignment, edge style, route, arrowheads, sticky color, crop…) as a searchable list. Assign
   hotkeys to any of them in Settings → Hotkeys.
6. **Mobile:** open the vault on a phone/tablet → the plugin loads; drawing works with a finger
   (pen-only mode off) and with a stylus; image export saves into the attachment folder.

## Manual — Round 2 (user requests, 2026-10-15)

1. **Drawing preview:** drawing mode → lasso, line, arrow and highlighter show their stroke /
   outline *while* dragging, not only after release.
2. **Hebrew while typing:** with the RTL Support plugin on, type Hebrew in a new text card and in
   a sticky → each line is right-aligned as you type, also after Enter Enter (new paragraph);
   English lines stay left. Same with *Text direction → Right to left* on the card.
3. **Selection toolbar position:** narrow window with the file sidebar open, canvas direction
   right-to-left → click a card at the left edge: the toolbar sits above the card, never under
   the sidebar; when it doesn't fit it wraps onto two rows. Settings → *Selection toolbar size*
   → change *Computer* (and *Phone and tablet* on mobile) → the toolbar scales.
4. **Sticky colors:** select a sticky → sticky color button → *Custom color…* → pick a color →
   the sticky takes it and the color appears under *Recent colors*; after 11 custom colors only
   the last 10 are kept. Settings → *Default color* → *Custom color* + picker.
5. **Vertical alignment:** text alignment button → *Top / Middle / Bottom* for any card
   (stickies default to middle) — in reading mode and while editing. Settings → *Text alignment*
   → *Center text in new cards* → *Horizontally and vertically* → double-click the canvas: the
   new card's text is centered both ways.
6. **Grow with text:** toolbar → *Grow to fit text* → *Grow downwards* / *Grow sideways* → type
   a long line: the card grows instead of scrolling (sideways: lines don't wrap).
7. **Floating text:** bottom bar → *T* button (or drag it) → type: no card around the text, it
   grows as you type; color it from the palette.
8. **Infinite lines:** bottom bar → infinite line button (right-click: vertical) → a line across
   the whole board under the cards. Select it (click anywhere on it) → thickness and *Angle*:
   the slider and number turn the line live, presets every 15°; each release is one undo step,
   Esc / clicking away without releasing restores it. Zoom far out and pan far along the line:
   it still crosses the view. Hovering the line shows no connection dots; no edge can start
   from it. Color from the palette; drag to move.
9. **Grid:** side controls → grid button → a line grid behind everything; right-click it → *A
   line every 2 / 4 / 5 / 10 dots* or *Other size…*; Settings → *Grid* → color.
10. **Text-only RTL:** Settings → *Right-to-left support* → *What right-to-left changes* → *Text
   only* → the canvas controls and toolbars stay left-to-right, card text is right-to-left.
11. **Settings search:** type "sticky" in the search box of Obsidian's settings window → the
   sticky-note module and its options are listed; click one to jump to it.
12. **Tutorials:** Settings → Overpowered Canvas → the *Tutorials* cards are at the top (also
   the cap in the canvas controls, or the *Tutorials* command). Click a
   card → settings close, a practice board opens in a new tab ("<files folder>/Tutorials/
   <name>.canvas") with the coach panel opposite the canvas controls (below the minimap when it
   shares the corner). Do each task by hand: it ticks off with confetti and moves on after a
   moment (not while a card is being edited). *Show me* does the task live; *Skip* / the dots
   move freely. Highlights follow the control of each step (bottom-bar button, toolbar, Layers
   panel eye, a card's branch badge…). Close with ✕ or close the tab → the board and the folder
   are deleted; minimap and grid go back to how they were. A finished tutorial shows *Done* on
   its card. Reload the plugin with a tutorial open → the leftover board is deleted on start; a
   canvas of your own in that folder is kept. Each board is left-to-right whatever the canvas
   direction setting. During *Presentations*, the panel stays usable in fullscreen.
13. **Phone controls bar:** on a phone open a canvas → the controls bar sits at the bottom, above
   Obsidian's navigation bar, and starts with the add buttons (card, note, media, text, group,
   sticky, shapes, line, drawing…). Swipe it sideways to reach zoom/undo/grid; tapping an add
   button adds the item at the center. Settings → *Toolbar size and layout* → *Controls bar on
   phones* → *Side of the screen* → one column on the right that scrolls up and down.
   *Controls bar* → *Phone and tablet* → the bar shrinks/grows. On a computer nothing moves;
   *Controls bar* → *Computer* scales the side controls.

## Manual — Round 3 (user requests, 2026-10-25)
1. **Double-click speed:** Settings → *Better defaults* → *Double-click speed for new cards* →
   Fast: two clicks 300 ms apart on the empty canvas create nothing, 150 ms apart create a card.
   *Custom* shows a milliseconds field. Click a card, then drag a selection box: no new card.
2. **Bottom-bar buttons:** hold the add-card button a moment and release on it: the card is
   added in the middle of the view (as a click), never under the bar. Dragging onto the board
   still places it where it's dropped.
3. **Layers:** overlap cards A, B, C; select A → toolbar *Layer* → *New layer with the selection*.
   Click B and C (the core lifts clicked cards): A stays on top. Side controls → layers button →
   the panel lists *Layer 2* (active) above *Layer 1* with item counts. Eye hides a layer (its
   cards and their edges), lock makes its cards unselectable (a selection box skips them).
   Right-click a row → rename, move the selection here, select everything on it, move the layer
   up/down, delete (its items go to the layer below; deleting the last extra layer removes all
   layer data). A new card goes to the active layer. *Move to the layer above / below* from the
   context menu or commands; undo works. A group moves with the items inside it; groups stay
   behind cards. Minimap, fast rendering and image export follow the layer order and skip
   hidden layers. Hide (or lock) the active layer, then add a card: the layer is shown and
   unlocked again with a notice, and the new card stays visible. With *Layer 1* hidden or locked
   and another layer active, a double-click or right-click → *Add card* makes the card where
   clicked (not at 0,0), in edit mode, and it stays after clicking away; undoing a deletion
   puts the card back in place. An infinite line hides with its layer and can't be picked up on a
   locked one. Quick clicks on a row's eye or lock don't open *Rename*; double-clicking the name
   does.
4. **Slides:** bottom bar → *Add slide*; click its name: the frame hides (and stays hidden after
   deselecting); click again: it shows. Double-click the name: rename, no toggle.
5. **Settings page:** the search box at the top filters the rows (in the current language and in
   English); the arrows in each section heading (or the heading itself) collapse it; the two
   buttons next to the search collapse / expand all; the state is remembered.
6. **No "Stable text rendering" setting:** the behavior is always on.

## Manual — Canvas ⇄ Markdown

1. Open a note with a bullet outline → command **Switch between canvas and Markdown note** → a
   canvas beside the note opens with a laid-out mind map (growing left in right-to-left canvases).
2. Run the command again → if a note with the canvas's name exists and isn't linked, a dialog
   offers Replace / Separate note / Cancel. The note shows only the outline (no `%%` marks); a
   JSON file appears in the files folder (default `Overpowered Canvas data/`). With the setting "Inside the note", the note
   gets hidden `%%n:…%%` ids and a `canvas-data` section instead, and the JSON file is removed.
3. In the note, change a line, add a line without an id under some bullet, delete a line → switch
   back: the changed card keeps its place and look, the new card sits beside its parent, the
   deleted card is gone. Ctrl+Z undoes the whole update in one step.
4. On any canvas: export → update with no edits → the file is unchanged (compare before/after).
5. Select a card with children → **Copy as Markdown outline** → paste in a note: the subtree.
6. Click the empty board and paste a nested outline → a mind map appears at the view center.
   Paste a single sentence → one normal card.
7. Right-click a note card → **Convert note to mind map here** → a map beside the card.
8. The ⇄ button sits in the header of canvases and notes; Settings → Canvas ⇄ Markdown → Switch
   button: "Canvases only" removes it from notes, "Hidden" from both.
9. Tutorials → **Canvas ⇄ Markdown**: every step can be done by hand and with "Show me"; the note
   opens beside the board; closing the tutorial deletes the board, its note and its data file.
10. Clean note: rename the note, then the canvas → switching from the canvas still opens the
    renamed note (no new note appears). Delete the note → its data file is gone. Switch twice
    after adding a line → no duplicate cards.

## Manual — power-user feedback (0.7)

1. **Radial layout:** a map with cards of very different sizes → Auto layout → Radial: no card
   overlaps another; running it again keeps the arrangement.
2. **Groups in layouts:** a map whose child sits inside a group → Auto layout (whole canvas):
   the group moves as one block, its cards keep their places inside it, nothing overlaps it.
3. **Edge sides:** after any layout (grid too), edges attach on the sides facing each other.
4. **Note blocks:** note and canvas side by side. Hold a bullet with children ~0.35 s and drag it
   onto the board: one card with the whole block, sized to its text, under the pointer. With a
   mouse, the dotted handle left of a line drags at once. Over a card: "Add as child" / "Add as
   sibling" appear; dropping links the card. iPad: hold with a finger, then drag — the page must
   not scroll or start a text selection.
5. **Inbox:** a group named "Inbox" → command *Toggle inbox mode* → click lines in a note: cards
   stack inside the group, which grows.
6. **Convert to mind map:** right-click a note card or a text card holding bullets → *Convert to
   mind map…* → pick Radial: a map beside the card, rooted at the note's title.
7. **Lasso:** press L (or the bottom-bar button), draw around two cards, their edge and part of an
   ink drawing: exactly those are selected (the caught strokes become their own drawing). Move,
   delete, recolor and *Move to layer* work on the selection.
8. **Cut and paste:** select, Ctrl/Cmd+X (one undo step), point elsewhere, Ctrl/Cmd+V: the cards
   land under the pointer with their edges. Tablet: Cut / Copy in the selection toolbar, Paste
   in the bottom bar.
9. **Zoomed out:** Settings → Variable breakpoints → "Always show content": card text stays
   readable when zoomed far out; "Placeholder below my zoom level" follows the slider.
10. **Connectors:** select a drawn line attached to two cards: drag a segment's middle dot to add
    a bend, double-click a bend to remove it; move a card: the bends follow. The line is drawn
    above the cards (or under them, per the Free lines setting).
11. **Edge colors:** box-select three connected cards → pick a color: the edges between them
    change too; Ctrl+Z undoes both.
12. **Coexistence:** with the other canvas plugin that hides the core card bar, our card bar
    buttons stay visible.
13. **Tutorials:** *Lasso, cut and paste* and *Notes to the board* work by hand and with "Show me";
    closing them deletes the practice board and note.

## Manual — tester feedback, round 2 (0.8)

1. **Sibling order:** a parent with five children. Drag a note block (or press Enter on the first
   child) and drop it on the first child's "Add as sibling": the new card lands between the first
   and the second child; the others move down. Same on a map with an automatic layout.
2. **Lasso stays on:** L, draw a loop → selected, the tool is still on. Press inside the
   selection and drag → it moves. Tap a card → only it is selected; tap twice → editing (the tool
   turns off). Tap empty space → cleared. Esc / L / the button turn it off.
3. **iPad, pen + fingers:** lasso on, draw with the pen → selection; one finger drags the board,
   two fingers zoom; a resting palm does nothing.
4. **Quick move (iPad):** select several cards, put a finger on one and drag at once → they move
   without a long press. A second finger cancels the move. With the pen, a single selected card
   moves at once too.
5. **Drawn arrows:** drawing mode → Arrow tool → draw from a card down, across and up into
   another card: the arrow keeps the two corners, right angles exactly. Shift → straight. Move
   either card → the route stays square and attached. The arrow is above cards it crosses
   (setting *Free lines and arrows → Lines attached to cards*).
6. **Fit text:** a new card shrinks or grows to its text and wraps at the maximum width (Auto-
   resize setting). Try with a CSS class that enlarges the font. Command *Fit cards to their text*
   on old cards.
7. **Move a branch:** drag a card with children onto another card → targets appear; drop on "Add
   as child" → re-linked, its children follow, an auto-laid-out map re-arranges; one Ctrl+Z
   undoes all of it.
8. **Marks on cards:** drawing mode, underline a word inside a card, leave drawing mode. Move the
   card, auto-layout the map, cut + paste it, Alt-drag a copy: the marks follow every time.
   Delete the card → its marks go too; Ctrl+Z brings both back. Drag only the marks off the card
   → they come loose.
9. **Highlight words:** H (or the bottom-bar highlighter), pick yellow, swipe over words in a card
   → the card's text gets `<mark>` around them; theme color → `==…==`; across a bold word → the
   bold stays intact; tap one word → that word. Eraser → removes. Swipe over a highlight in
   another color → recolored, not nested. iPad: works with the pen; fingers pan once the pen was
   used.
10. **Tutorials:** *Lasso, cut and paste*, *Drawing*, *Mind maps*, *Sticky notes and text*: every
    "Show me" completes its step.

## Manual — tester feedback, round 3

1. **The view follows drops:** zoom in so a map's card is near the edge, drag a note block onto its
   "Add as sibling" → after the map re-arranges, the view glides so the new card is in the middle
   (zoom unchanged). Setting *Center the view on dropped cards*: every drop / never.
2. **Walk through a map:** select a card, bottom-bar route button (or right-click → *Walk through
   the map from here*). → goes to the first child (← in a map that grows to the left), back to the
   parent, ↑/↓ along the siblings and stop at the first and last; back at a parent, → returns to the
   child you came from. The zoom stays; + / − change it; Home goes back to the start; Esc ends,
   leaving the last card selected. Tapping a card jumps there. The canvas is read-only meanwhile.
3. **iPad:** the arrow pad in the corner works with a finger and the pen; one finger still pans.
4. **Tutorial:** *Mind maps* → "Walk through the map" → Show me completes the step.
5. **New tutorials** (by hand and with Show me, also in another UI language):
   - *Notes as cards*: practice notes appear in "<files folder>/Tutorials/vault/"; dragging a
     card to *Doing* sets its status; binding *Done*; changing a note's status moves its card; the
     packing group fills with the two tagged notes; a `canvas-edges` property draws an arrow.
   - *Style and reuse*: border, save the Task card as a template (button in the bottom bar), add a
     copy, floating arrow end. After closing, the practice template is gone from the bottom bar.
   - *Big boards*: open the Details portal; move the three Step cards to a new canvas.
   - *Right-to-left*: fix a card to right to left; the canvas command flips menus, controls and the
     coach panel to the other side; Tab on the map card adds a child on the left.
   - *PDF pages*: pin the practice PDF card (shows one page); insert it for annotation (two pinned
     pages beside it); draw a mark on a page.
   Closing each one deletes the board, its practice files and the canvas split off the board; a
   reload with a tutorial open cleans up on start.

## Manual — files folder

1. Settings → Overpowered Canvas: the first setting is *Location of the plugin's folder*. The folder
   button shows where it is now (*Vault root* by default) and the line below shows the plugin
   folder (`Overpowered Canvas data`). Apply is greyed out.
2. Click the folder button → every vault folder is listed (the vault root first, hidden folders and
   the plugin folder itself left out); typing searches them. Pick `real` → the line reads
   `real/Overpowered Canvas data` in the accent color; Apply → notice "… now in “real/Overpowered
   Canvas data” (N moved)"; the old folder is gone. A clean note still switches to its canvas.
3. Start a tutorial → its board and practice files are in `<plugin folder>/Tutorials/`; closing
   it removes them.
4. Move it back to the vault root → files return. A file whose name already exists in the target
   stays where it was, and the notice says how many.
5. An older settings file with the Canvas ⇄ Markdown *Data folder* option takes that folder over.
