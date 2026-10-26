# Design decisions

Choices made where the spec left room. Newest section first.

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
