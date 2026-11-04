# Design decisions

Choices made where the spec left room. Newest section first.

## Smart groups, paragraph indents, font size per note

1. **Smart groups are a field on each card** (`x-opc.smartGroup`, shared id), not a node. No
   frame means nothing to draw and nothing that vanilla Obsidian could show or drop; the file
   stays JSON Canvas 1.0 and the cards are plain cards elsewhere.
2. **Selection is widened inside `canvas.updateSelection`**, the one path every selection takes
   (click, box, lasso, the drag's own `selectOnly`). The core then drags the whole selection by
   itself, so moving needs no code of ours and snapping, undo and Ctrl/Alt-drag copies behave as
   for any multi-selection.
3. **Only pointer selections are widened.** Commands, mind map keys, search results and other
   modules select exactly what they ask for; otherwise Alt+arrow navigation and every "one card
   selected" feature would stop working on grouped cards. A shift/ctrl-click that takes a card
   out drops its whole group; a selection box that shrinks while dragged never drops cards (it
   would flicker).
4. **Entering a group (Miro's double-click)**: the first double-click on a card of a closed group
   picks that card instead of editing it (the core's `startEditing` is intercepted only right
   after a pointer press, so programmatic edits are untouched); the second double-click edits.
   Touch: double-tap, or long-press → "Select only this card". Leaving: select anything outside
   the group, or nothing.
5. **Groups never nest**; grouping cards from several groups makes one new group. Copies (paste,
   duplicate, Ctrl/Alt-drag, board and card templates, the copy a page move leaves) get a fresh
   group id per copied group, and a group with one copied card is dropped.
6. **Pages and hidden layers split groups by visibility**: only members shown on the board are
   picked, so a group spread over pages acts separately on each page and joins again when the
   pages are merged. No data is rewritten when cards move between pages.
7. **Ctrl/Cmd+G** is a canvas-scope key, so it never reaches the global hotkey while a canvas
   has the focus. With nothing to group it runs whatever command Settings → Hotkeys binds to
   that combo (the graph view by default), because a scope that matched a key keeps it. A
   setting turns the canvas key off; the commands themselves have no default hotkey.
8. **Paragraph indent = EM SPACE (U+2003)**, not tabs, ASCII spaces or `&emsp;`: Markdown strips
   leading spaces/tabs and makes four of them a code block, HTML collapses them, and an entity
   shows as code in Source mode. An em space is plain text that is never collapsed, 1em wide in
   every mode and every app. Obsidian's *editor* (not Reading mode) counts any Unicode space as
   indentation, so four em spaces after a blank line would look like indented code while
   editing; a WORD JOINER (U+2060, invisible, zero width, not whitespace) after every third
   leading em space keeps that run under four. Measured: 2/4/8 em indents are 32/64/128 px in
   Live Preview, Source mode and Reading mode alike.
   The editor also gives any line that starts with whitespace a hanging indent (inline
   `text-indent`/`padding-inline-start`), which shifted and reflowed the whole paragraph while
   editing; lines starting with an em space get the class `opc-indent-line` and the module's CSS
   cancels it, so only the first row is indented, as in Reading mode. The editor's
   `white-space: break-spaces` made a word that just fits wrap early (the trailing space takes
   room); `pre-wrap` restores Reading mode's breaks (always in canvas card editors, in notes
   while the module is on). In a right-to-left canvas the card's reading view kept its
   scrollbar gutter on the left while the editor iframe keeps it on the right, a 12px jump; the
   reading scroller now stays LTR and only its content follows the card direction. A note's
   font size also scales `--p-spacing`. Measured: every word lands on the same pixel in edit and
   reading mode for indented, plain, multi-paragraph, sized and right-to-left cards. Obsidian's
   own blank-line vs paragraph-margin gap between note paragraphs (8px at 16px) remains.
9. **Where Tab stays the app's**: lists, tables (including Live Preview's cell editors), code
   and math blocks, inline math/code, frontmatter, indented lines, multi-line selections, open
   suggestion popups and vim normal mode. The keymap has `Prec.high`: above the app's own Tab,
   below plugins that bind Tab at the highest precedence (snippet tab stops, math tab-out,
   outliners), which still get it first.
10. **Font size per note is a frontmatter property** (default `font-size`, configurable),
    because notes already have properties: synced with the note, visible and editable in the
    Properties panel, no plugin data to lose. The size redefines `--font-text-size` and
    `--font-preferred-size` on the note view (both are resolved on `<body>`, so redefining one
    is not enough) and sets `font-size` on both the editor and the reading view, so all modes
    compute the same size (measured identical on desktop and emulated mobile). Canvases keep
    using CSS classes in their properties for this.

## Canvas ⇄ Markdown (issue #1)

1. **Separate note, not the canvas stored as Markdown.** The canvas stays a `.canvas` file (JSON
   Canvas 1.0, opens in vanilla Obsidian); the note is a sibling `<canvas name>.md` that mirrors
   it. Storing the canvas *as* a note would need a custom view replacing the core canvas view —
   far more fragile, and it would break every other tool that reads `.canvas` files.
2. **Stable ids are hidden comments at the end of the first line** (`%%n:a4f2%%` card,
   `%%g:…%%` group, `%%free%%` for the free-cards heading). Obsidian hides them in reading
   view, assistants usually keep them, and losing one only means "new card" — never data loss.
   Ids are the shortest unique prefix (≥ 4 chars) of the canvas id; the data block maps them
   back. A duplicated id (a copied line) becomes a new card instead of stealing the original.
3. **Content and layout are separate.** The outline holds text and hierarchy only; everything
   visual (positions, sizes, colors, `x-opc` styles, edge data, drawings, root data, node order)
   is in one fenced JSON block inside `%% ## canvas-data %%` at the end of the note, one entry
   per line so diffs stay readable.
4. **When updating an existing canvas, the canvas is the base, not the data block.** Known cards
   keep their *current* position and style (they may have moved since the export); the data block
   is used only for cards the canvas no longer has and when building a canvas from scratch.
   Cards the note never knew about (added on the canvas after the export) are left alone.
   Cards known to the export but missing from the note are deleted.
5. **Text is never rewritten.** If the note's text equals the card's text apart from trailing
   spaces and outer blank lines (which Markdown can't carry), the card keeps its exact text.
6. **What a "map" is.** A connected set of text/file/link cards (edges in either direction).
   Root: a card with no incoming edge that reaches the most cards, ties → top-left. The outline
   follows a spanning tree: along edge directions first, then against them. Edges outside the
   tree (cycles, second parents, links between maps, edges to groups or drawings) are stored as
   `crossEdges` in the data block only — not shown inline, since inline `[[#^id]]` refs would
   change card text.
7. **Sibling order** follows the board: top→bottom when children sit beside the parent, along
   the reading direction when below/above it, clockwise from 12 o'clock otherwise
   (counter-clockwise in right-to-left canvases). "Beside" is judged by card edges, not
   centers, because wide trees reach far across.
8. **Groups become headings** wrapping the maps whose root lies inside them (smallest containing
   group; nesting kept, capped at heading level 6). Free cards in a group are bullets right under
   the group heading; free cards outside groups go under a `# Free cards %%free%%` heading at
   the end. Group membership on import is geometric: new cards under a group heading are placed
   inside the group, which grows to fit. Groups can't be created from the note (no geometry);
   a group heading whose group is gone is dropped and its content kept.
9. **Drawings** (ink, free lines, infinite lines) are not text: kept in the data block
   (`drawings`) and never touched by an update.
10. **Multi-line card text**: continuation lines are indented to the bullet's text column; blank
    lines stay blank. A continuation line that would read as a bullet, heading, fence or escape is
    prefixed with `\`. Fenced code is written untouched when every fence in the card closes.
    A heading card's extra lines follow the heading unindented; plain paragraphs elsewhere are
    cards of the enclosing heading. (The old script's `join("")` gluing bug cannot happen:
    lines are always joined with `\n`.)
11. **File and link cards** are written as `![[path#subpath]]` and the bare URL. New lines that
    are exactly an embed of an existing vault file / a web URL become file / link cards; an
    existing text card never changes type.
12. **Layouts.** Directional (forward, backward, down, up) and balanced maps are laid out by our
    own order-preserving tidy tree (`tidy.ts`): ELK's tree algorithm reorders siblings, which
    broke "outline → canvas → outline is identical". Radial, layered and grid still use ELK
    (sibling order not guaranteed — documented). Default for new maps: forward.
13. **Re-layout rule**: a map is re-arranged only when its structure changed (a card added,
    removed or moved to another parent) *and* it has a recorded auto layout (`x-opc.mapLayouts`,
    written by Auto layout and by this module for maps it builds; editable in the data block's
    `maps`). Hand-arranged maps keep every position; new cards go beside their parent after its
    existing children.
14. **Direction**: canvases are opened before being built or updated, because the canvas's text
    direction (global or per canvas) decides which way maps grow and can only be read from an
    open view. Updating through the live canvas also makes the update one undo step.
15. **Exporting next to an existing, unlinked note asks first** (Replace / Separate note /
    Cancel): converting a note to a canvas and back must not silently overwrite the original.
    Front matter of the replaced note is kept.
16. **Pasting** nested bullets or headings onto the board (focus on the board, not in a card)
    builds a mind map when there are at least two parent/child links; anything else is left to
    the normal paste. A setting turns this off.
17. **"Drag a note onto the canvas"** is covered by a context-menu entry on note cards
    ("Convert note to mind map here") and an "Insert note as mind map…" command, instead of
    hijacking the core drop behavior (which creates a note card many people rely on).
18. **Empty cards** are skipped when an outline is turned into a *new* map (an empty bullet
    carries nothing); in the round trip they are kept because their id resolves.
19. **Mobile**: only the vault/workspace API and `navigator.clipboard`; the converters are pure
    TypeScript with no Obsidian or Node imports.
20. **Switch button** in the view header of canvases and notes (setting: notes and canvases /
    canvases only / hidden). It is shown on every note, because any outline note can become a
    board. When the other side is already open in another tab, that tab is shown instead of
    replacing the current one.
21. **A linked note is rewritten after it updates its canvas** (ids for new lines, fresh data
    section, outline in the board's order), so switching twice never adds lines twice. A plain
    note that was never linked is not touched (converting it doesn't rewrite your original).
22. **Ids are found anywhere in the first line.** In editing mode the hidden id is shown at the
    end of the line, so text typed after it is common; the text on both sides is the card's text.
23. **Tutorial**: the note opens in a split beside the practice board (the coach panel lives in
    the board's tab, which must keep its file). Typing in a note doesn't hold the coach back the
    way typing in a card does. The note is deleted with the board, also after a crash.
24. **Clean notes by default** (asked for after daily use: the `%%n:…%%` ids and the JSON section
    were noise in editing mode). The data moves to one JSON file per note in a visible vault
    folder (synced like any file; a dot-folder or the plugin folder would not be), named after
    the note plus a hash of its path. Without ids, lines are matched to cards against the outline
    last written (kept in that file): text alignment first, then position-based pairing for
    edits, then text search for moves. Ids win when a note still has them, so old notes keep
    working and convert on their next write. Trade-off: a line that is both heavily rewritten
    and moved at the same time becomes a new card (the old one is deleted) — the in-note format
    stays available for anyone who needs exact identity.
25. **Sibling order is stored, not read off the board** (root `x-opc.childOrder`, see
    `src/modules/mindmap/order.ts`). Positions were a poor record of order: a card dropped as a
    child landed between others, cards both beside and above their parent were read along the
    wrong axis, a radial branch at 12 o'clock flipped on every run, and RTL canvases read up / down
    maps one way when laid out and the other way when recorded. Every action that gives a card its
    place writes the list; every layout and outline reads it. The board still decides for children
    the list doesn't name (arrows drawn by hand, pastes), read along the axis of the map's recorded
    layout. A note's outline wins on Markdown → canvas, and is stored only where the board alone
    would read it differently, so untouched round trips stay byte for byte.
