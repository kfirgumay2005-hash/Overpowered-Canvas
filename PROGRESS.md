# Feedback round 13: progress

Branch `feature/feedback-round-13` (from `main` at 0.19.1). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 12's notes are in git history: `git show 21b7dc9:PROGRESS.md`.)

| # | Item | Class | Status |
|---|------|-------|--------|
| A1 | Ghost marks after moving a branch / folding | IMPROVEMENT (bug) | done |
| A2 | Column mode: drawing bar over the breadcrumb | IMPROVEMENT (bug) | done |
| A3 | Live stroke under the card (regression) | IMPROVEMENT (bug) | todo |
| A4 | Column mode: stroke flicker on pen-up | IMPROVEMENT (bug) | todo |
| A5 | Column mode: no vertical finger scroll with a pen tool | IMPROVEMENT (bug) | todo |
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
