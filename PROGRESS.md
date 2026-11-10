# Feedback round 14: progress

Branch `feature/feedback-round-14` (from `main` at 0.20.1). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 13's notes are in git history: `git show 193375b:PROGRESS.md`.)

"Grid mode" in the feedback is the **Table of contents** view (`presentation/toc.ts`).

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Column mode: finger tap on a card with a drawing tool on | IMPROVEMENT (bug) | done |
| 2 | Drawing: embed selected strokes into a card / take them out | IMPROVEMENT | done |
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

## 2. Strokes into a card and back out (done)

Classification: IMPROVEMENT. Already there: ink stuck to a card (`x-opc.anchor`, round 2: moves,
copies, deletes with the card, shows in the column view and the table of contents) and two
commands, "Stick drawn marks to the cards under them" / "Unstick drawn marks from their cards",
which only took whole drawings selected on the board and only cards already under them. Extended
instead of adding a parallel feature (same command ids, so hotkeys stay):
- `drawing/embed.ts`: works on the strokes picked with the drawing bar's **lasso** (single strokes
  out of a drawing are split off), else on the drawings selected on the board (and the ink of
  selected cards). **Embed drawing into a new card** (new, `embed-ink-new`): an empty text card is
  made around the strokes (their box + the drawing padding), marked `drawingCard: true` (schema,
  validator, SCHEMA.md), and the strokes are stuck to it without moving. **Embed drawing into the
  card under it** (`attach-ink`): the selected card, else the topmost card holding most of the
  strokes' points (`cardUnderMost`, pure + tested); with nothing picked it keeps its old
  behavior (every free stroke over a card sticks to it). **Take drawing out of its card**
  (`detach-ink`): frees the picked ink; a drawing card left empty is removed. One undo step each;
  events `ink-embedded`, `ink-taken-out` (EVENTS.md, tutorial runner).
- UI: a **Put into a card** button in the drawing bar while the lasso holds strokes (menu: new
  card / card under it (disabled when there is none) / take out); the same items in the context
  menu (long press) of a drawing or of a card with ink; command palette.
- Resizing: `anchors.ts` stretches the ink of a `drawingCard` with the card (`stretchStrokes`,
  pure + tested: points keep their place relative to the card, widths scale by the smaller
  factor). Live while dragging, always computed from the strokes at the start of the resize (no
  rounding drift), ends after a 500 ms pause. Text cards with handwriting keep the old behavior
  (ink stays on the words). The column view's resize handle stretches it too (same event).
- Column view / table of contents: at real size the ink was already drawn; below real size a
  card that is only a drawing (no text, ink on it) now shows its drawing scaled to the cell
  (`CardFaces.isDrawing`, `drawInk(..., fit)`), instead of an empty card.

Tested (harness, emb.canvas): two free pen strokes → lasso → Put into a card → new card:
card 132×102 around them, both drawings anchored, every stroke point at the same board position
(compared before/after), ink drawn above the card, lasso emptied; resize by the bottom-right
handle to 250×135 → strokes stretched (widths 7 → 9.3), one undo step restored 132×102 and widths
7; linked under Card B: the column view shows the drawing (2 paths, 314×170 px) and the table of
contents too (214×116 px); Take out → strokes back on the board at the same positions, empty card
removed, notice. A stroke over Card A → lasso → "card under it" → anchored to A, moved with A.
Unit tests: stretch, cardUnderMost. Tutorial "Drawing": new step "Put a drawing into a card"
(touch line, command alternative; 5 locales) and the marks step names the renamed command; Show
me in English 11/11. README updated. Tests 836/836, lint clean.
