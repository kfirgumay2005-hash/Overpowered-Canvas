# Feedback round 14: progress

Branch `feature/feedback-round-14` (from `main` at 0.20.1). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 13's notes are in git history: `git show 193375b:PROGRESS.md`.)

"Grid mode" in the feedback is the **Table of contents** view (`presentation/toc.ts`).

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Column mode: finger tap on a card with a drawing tool on | IMPROVEMENT (bug) | done |
| 2 | Drawing: embed selected strokes into a card / take them out | IMPROVEMENT | |
| 3 | Drawing: palm rejection with Scribble on (iPad) | IMPROVEMENT (bug) | |
| 4 | Raw HTML/Markdown in grid titles and other card-text labels | IMPROVEMENT (bug) | |
| 5 | Grid mode: nested sub-groups | IMPROVEMENT | |
| 6 | Grid mode: handwriting tools | NEW (tools in the grid view) | |
| 7 | Grid mode: lock layout toggle | NEW | |
| 8 | Group customization (thickness, colors, style, radius) | IMPROVEMENT | |

## 1. Column mode: finger tap on a card with a tool on (done)

Root cause. With the pen (or highlighter / text color) on, the tool's overlay covers the column
view. With palm navigation on, a finger press is not taken by the tool, so it reaches the column
view: dragging worked (A5 of round 13), but a tap's `click` lands on the overlay, and the column
view only treated clicks inside its cards (`.opc-columns-zoom`) as taps.

Fix (`presentation/columns.ts`): on pointer-up of a finger that did not move, if it was pressed
on a tool overlay (`TOOL_OVERLAYS`), the column view finds the card under the finger below the
overlays (`underOverlays`, `elementsFromPoint`) and runs the same tap logic as a click
(`tap()`: links, go to the card, tap the current card again to edit). The click that follows is
swallowed. The finger's `pointerdown` on an overlay is `preventDefault`ed so no emulated mouse
press follows it: that press used to take the focus away from a card just opened for editing by a
double tap. Pens still draw (the drawing session keeps their presses), finger drags still move
the view, palm rejection is unchanged (a touch right after the pen never reaches the view). Same
code for both orientations (left to right, top to bottom).

Tested (harness, deep.canvas, palm navigation on, CDP touch):
- pen tool, left to right and top to bottom: finger tap on a child card → it became the current
  card (before: unchanged), tool still on, no ink created;
- highlighter and text color, both orientations (after a pen was used, so fingers navigate):
  tap → card current, tool on, card text unchanged;
- pen stroke on the current card → 1 drawing; finger drag down 120 px → the column moved 120 px,
  no navigation; vertical mode: sideways drag moved the row 120 px;
- double tap on the current card with the pen on → editor opened and focused (before the
  preventDefault: opened and closed at once);
- no tool, mouse click on a child → navigates (regression).
Tutorial "Column view" → "Write on the cards": one sentence (tap = go, drag = move, pen = write),
5 locales; Show me in English 12/12. Typecheck, tests 834/834, lint clean.
