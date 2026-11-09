# Feedback round 13: progress

Branch `feature/feedback-round-13` (from `main` at 0.19.1). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 12's notes are in git history: `git show 21b7dc9:PROGRESS.md`.)

| # | Item | Class | Status |
|---|------|-------|--------|
| A1 | Ghost marks after moving a branch / folding | IMPROVEMENT (bug) | done |
| A2 | Column mode: drawing bar over the breadcrumb | IMPROVEMENT (bug) | done |
| A3 | Live stroke under the card (regression) | IMPROVEMENT (bug) | done (with A4) |
| A4 | Column mode: stroke flicker on pen-up | IMPROVEMENT (bug) | done (with A3) |
| A5 | Column mode: no vertical finger scroll with a pen tool | IMPROVEMENT (bug) | done |
| A6 | Column mode: wide cards run into the next column | IMPROVEMENT (bug) | done |
| B1 | Resize cards in column mode | NEW | done |
| C1 | Vertical column mode | NEW (orientation of the column view) | done |
| C2 | Table of Contents mode | NEW | done |
| D1 | Automatic header rules | IMPROVEMENT (headers) | todo |
| E1 | Handwriting performance + Ink-style features | IMPROVEMENT + NEW | todo |
| E2 | Page format mode | NEW | todo |

## A1. Ghost marks (done)

Root cause. The far-zoom renderer (performance module, `LodLayer`) paints the board on a bitmap
once a large canvas is zoomed out past its threshold. It skipped cards on other pages / hidden
layers (`isHiddenNode`), but:
- it painted **every arrow**, including the arrows of other pages (their `d` is still set), so the
  other pages' maps showed as brace-like curves and dashes next to the current page; zooming in
  past the threshold hides the bitmap, which is why they came and went with the zoom (context 1);
- it painted cards and arrows inside **folded branches and folded groups** (`opc-hidden-by-branch`,
  `opc-hidden-by-collapse`): moving a folded card away left the whole folded map visible at its old
  place when zoomed out, and the minimap drew straight lines from the moved card back to the
  hidden children (context 2);
- its cached scene was keyed only by card data, so switching pages or folding (no data change)
  could keep showing the old scene.

Fix: `isOffBoard(node)` / `isEdgeOffBoard(edge)` in `src/modules/shared.ts` (one list of every class
that takes something off the board). The far-zoom renderer, the minimap and image export use them
for cards, arrows, group labels and the content bounds; the cached scene is also keyed by the set
of off-board cards (`hiddenKey`) and invalidated on page / fold events.

Tested (harness, real 159-card map copy, far-zoom renderer forced on):
- context 1: move a branch to a new page, zoom out to -3: pixels painted outside the shown page
  7186 → 0 (screenshot showed the same braces and dashes as the report before the fix);
- context 2: fold the root, move it 3000 px right, zoom out to -4: painted pixels 58435 (the
  whole folded map + lines back in the minimap) → 360 (only the folded card).
Unit tests 773/773. No tutorial text changes (behavior is what the user expected all along).

## A2. Column mode: tool bars over the breadcrumb (done)

Root cause. Round 12's `src/ui/top-lane.ts` keeps top bars apart per host element. The pages
bar lives in the canvas wrapper, but in column mode the pen rack, highlighter and text color
palettes live in the column view (`.opc-columns`, a child of the wrapper): two hosts, two lanes,
so they never saw each other.

Fix: a lane now belongs to the board. `joinTopLane` resolves the host to its `.canvas-wrapper`
(`laneRoot`), so bars of any view inside the board share one layout; the lane also watches each
bar's own parent so a bar leaving a nested view leaves the lane. Same mechanism for both modes,
so they can't drift apart again.

Tested (harness, 820 px window = iPad portrait, 5 nested pages with long titles, column view on
the deepest page): pen rack before: same row as the breadcrumb (overlap); after: moved below it
(breadcrumb 125-154, rack 161-222). Highlighter palette in columns: below the breadcrumb.
Canvas mode drawing bar: still below the breadcrumb (regression check).

## A3 + A4. Live stroke under cards / flicker on pen-up (done, one commit: same code path)

A3 root causes (two paths left after the earlier max z-index fix):
- Board: the live stroke's layer was a 1x1 px SVG at the board origin with `overflow: visible`.
  On iPad (WebKit) a card whose text scrolls has a compositing layer of its own; WebKit decides
  whether a later element must be layered above it by the element's box, and a 1x1 box at (0,0)
  "covers" nothing, so the stroke was painted into the board's layer, beneath those cards. Only
  some cards (long text, scrolling content) and only on iPad, hence "rare but real".
- Column view: the live layer sits inside the card drawn on; every column card has an opacity
  (a stacking context), so a stroke running onto the next card or column went under it.
Fix: the board's live layer now has its real size (`coverView`: twice the visible board, viewBox
in board coordinates, re-placed on every press/hover; last child of the board). The column card
drawn on and its column get `is-inking` (z-index above the others).
A4 root cause: on pen-up the live path was removed at once, and the column view redrew ink 80 ms
later (debounce), so the stroke vanished for a few frames. Fix: `InkSession.holdUntilSettled`
moves the finished stroke's preview into a copy of the layer that stays until the surface
reports the committed ink is painted (`InkSurface.settled`: the board after two frames, the
column view after its ink refresh + two frames; 1.5 s fallback). The copy does not follow the
preview, so writing fast (next stroke on another card) is fine. Ink-only refreshes in the column
view now run after 16 ms instead of 80.

Tested (harness): column view, pen stroke on a card, every frame recorded from pen-down to
700 ms after pen-up: blank frames after the stroke started 3 (old) → 0 (new, three runs); the copy
is gone afterwards (one path left). Board: no blank frames, live layer covers the whole view,
strokes land on the same words as drawn.

## A5. Column mode: fingers scroll in every direction with a pen tool on (done)

Root cause. With a tool on, its overlay covers the column view and receives every press. The
column view chose the column to drag up/down from the element pressed (`closest(column)`), which
is the overlay, so no column moved; only the sideways part (all columns) worked.
Fix: `columnAtPoint` finds the column under the finger by position when the press is not on a
column element; a vertical drag between columns moves the whole view. Pen/stylus input still
draws (the drawing module keeps it); touches pan as before when palm navigation is on.
Tested (harness, CDP touch with the pen tool on, palm navigation on): finger drag down 150 px on
the children's column: before 0 px, after the column moved 150 px; no ink created by the finger.
Tutorial "Column view" → "Write on the cards" gained a paragraph about palm navigation (5 locales).

## A6. Column mode: wide cards run into the next column (done)

Root cause. Each column starts after the card the next column continues from (`reach`: the
focused card's width at actual size), but the column itself is as wide as its widest card, and
nothing limited what it drew: a sibling (or a big image) wider than the focused card lay under
the next column, and faded cards are semi-transparent, so it showed through the children.
Fix (the proposed clip line, applied to every column): `columnClips` (pure, tested) gives each
column the distance to the next column's start; the column gets `clip-path` up to there
(`is-clipped`, `--opc-column-clip`). Siblings stay faded as before; the part past the line is
not drawn and not hit by taps. The children's column (last) is never cut, so children always
show whole. The "+" buttons of the focused card stay inside the gap before the line.
Tested (harness, actual size, focused card 250 px with a 700 px sibling): a point past the
children's column start inside the sibling's box hit `[eta, cls]` before, `[eta]` after;
screenshot shows the sibling cut at the line, children whole. Unit tests: column-layout 4/4.
Tutorial "Column view" → "Cards at their real size": one sentence added (5 locales).

## B1. Resize cards in column mode (done)

Classification: NEW (the column view had no way to change a card's size; the board's own resize
handles are untouched).
What: at actual card size, the current card gets a round handle at its bottom-right corner
(`addResizer` in columns.ts), next to the "+" buttons. Drag with finger, pen or mouse (pointer
capture; the card, its text layout and the children's column follow live), or focus it and use
the arrow keys (Shift: 50). On release the walker's `resizeCard` writes the size to the board
card (`moveAndResize`, top-left kept, one undo step), emits `column-card-resized`, and a map with
a recorded layout arranges itself again (`relayoutMap`). Pictures keep their aspect ratio.
Ink keeps its board position (anchored strokes are relative to the card's top-left corner, which
does not move), so it lands on the same place in every view. Hidden while a tool is on or a card
is edited, like the "+" buttons.
Tested (harness): drag +120/+90 px on a 250x60 card → 370x150, x/y unchanged, anchored ink
unchanged, children's column 32 px after the new right edge, one undo step. Tutorial "Column
view": new step "Make a card bigger to write on it" (touch line + keyboard alternative, 5
locales); Show me in English: 12/12 tasks.

## C1. Column view top to bottom (done)

Classification: NEW, built as an orientation of the existing column view (no second view).
`ColumnOptions.vertical` (setting `presentation.columnVertical`, command "Column view: toggle top
to bottom", a rows/columns button in the column view's tool bar, settings toggle). The same
`ColumnView` lays out levels as rows: `layoutRows` measures row heights (only known after the
text is laid out), places each row after the card it continues from, centers the children's row
under the current card, cuts each row where the next starts (A6 rule on the other axis). Drags
swap axes (along a row: that row; across: all rows). The walker remaps keys and pad arrows
(`DOWNWARD`: ↓ child, ↑ parent, ←/→ siblings). "+" buttons swap sides (child below, sibling
beside); resize handle, pen, highlighter, text color, editing all shared.
Tested (harness): flip → rows stacked top to bottom, children centered under the focused card,
wide sibling cut at the next row; keys ↓ inc, → gen, ↑ epi, → cls. New tutorial "Column view,
top to bottom" (4 tasks, touch lines, command alternatives; 5 locales): Show me in English 4/4;
"Column view" 12/12 again. Unit tests 780/780. README updated.

## C2. Table of contents (done)

Classification: NEW (no grid view existed; it reuses the column view's card rendering and the
walk's map model instead of duplicating them).
Where: `presentation/toc.ts` (TocView + enableToc), `toc-layout.ts` (pure arrangement model,
8 unit tests), `card-face.ts` (card rendering extracted from the column view: replica text,
images, crops, ink, colors; the column view uses it too), `map-model.ts` (the walk's model:
groups as cards, sibling order, one page). Root data `tocLayouts` (schema + validator +
SCHEMA.md); events `toc-shown`, `toc-arranged`, `toc-closed`.
What: command "Table of contents view", a grid button in the side controls. A box named after
the parent card holds its children as cells; a cell with children has an arrow (top-left) into
its own grid; back buttons (fixed top right, joined to the top lane so it stays clear of the
pages bar, and in the box's title) go up; Backspace too, Esc closes. Pinch / Ctrl+wheel / buttons
zoom, drag or wheel pans. Uniform cells (width setting) or real size with ink (button + setting).
Simple grid: N per row (setting). Free arrangement: drag a cell beside/below another to form a
cell group (split tree of rows/columns, so cells of different sizes stay tidy), guide lines show
the landing place, groups move by handle or outline, cells/groups can go between cells or into a
new row, tap the handle for colors / ungroup. Each change is one undo step, stored in the canvas,
restored after reopening and when switching modes. Pages: only the page shown; a page anchor's
arrow opens that page (breadcrumb follows), back returns. Double tap edits a text cell.
Exclusive with the walk/column view.
Tested (harness): board like the drawings (DIA → A, G, H, I; A → B…F): DIA grid rows [A*, G, H]
[I]; into A; C right of B, D below B, E right of D, F to a new row → group col[B, row[D,E]] beside
C + F below (as in "RESULTS"), 4 undo steps, saved to disk, same after closing and reopening;
real size: cells 260/100 px wide like the cards; group menu recolor; group moved after F; back
→ DIA; pages: anchor arrow opens the sub-page and back returns; simple/free switch; lint clean.
New tutorial "Table of contents" (8 tasks, touch lines; 5 locales): Show me 8/8; "Column view"
12/12 and "Column view, top to bottom" 4/4 re-run after the rendering refactor. Tests 794/794.
