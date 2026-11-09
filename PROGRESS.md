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
| A6 | Column mode: wide cards run into the next column | IMPROVEMENT (bug) | todo |
| B1 | Resize cards in column mode | NEW | todo |
| C1 | Vertical column mode | NEW (orientation of the column view) | todo |
| C2 | Table of Contents mode | NEW | todo |
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
