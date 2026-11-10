# Feedback round 14: progress

Branch `feature/feedback-round-14` (from `main` at 0.20.1). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 13's notes are in git history: `git show 193375b:PROGRESS.md`.)

"Grid mode" in the feedback is the **Table of contents** view (`presentation/toc.ts`).

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Column mode: finger tap on a card with a drawing tool on | IMPROVEMENT (bug) | done |
| 2 | Drawing: embed selected strokes into a card / take them out | IMPROVEMENT | done |
| 3 | Drawing: palm rejection with Scribble on (iPad) | IMPROVEMENT (bug) | done |
| 4 | Raw HTML/Markdown in grid titles and other card-text labels | IMPROVEMENT (bug) | done |
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

## 3. Palm rejection with Scribble on (done)

Classification: IMPROVEMENT (bug) of the existing palm rejection.

What was wrong (read from the code and the core's own touch handler, reproduced with mixed
touch + pen input in one CDP session, `palm.mjs`):
- The old rejection only refused a touch that **started** within 800 ms after a pen event. A
  palm usually lands **before** the pen. With palm navigation on, that touch went to the board:
  the core's `onTouchdown` pans with it for as long as it stays down (and after 600 ms still it
  turns into a long press: drag-select box, card drag, context menu on release). Nothing ended
  that gesture when the pen came, so the board slid under the pen while writing. Without palm
  navigation the palm started a stroke of its own, and the pen's press "finished" it (committed).
- With Scribble on, WebKit decides per pencil contact whether it is handwriting for a text
  field: pen `touchstart`s were not claimed by the page (only pointer events were handled), so
  the system could hold back, cancel or take pen input — the pen's first events come late or a
  stroke gets a `pointercancel`, which makes the 800 ms window open late and the palm win more
  often. Writing on cards felt fine because the hand usually rests off the card; on the open
  board it rests on the drawing surface. Editable things near the pen are Scribble targets: the
  drawing bar's exact-size box (`<input type=number>`) and a focused text field.

Fix: `src/ui/palm-guard.ts` (`PalmGuard`), used by the drawing session and the highlighter / text
color session, on the board and in the column view:
- pen `touchstart`/`touchmove` over the tool's overlay are `preventDefault`ed (non-passive
  listeners; `touchType === "stylus"`): the page claims the pencil, so Scribble, scrolling,
  selection and the loupe stay out; touches while the pen is active are claimed too;
- strict pointer types: a touch while a pen is down or within 800 ms of its last event (hover
  included) is refused; a palm-sized contact (> 64 px) is refused once a pen was seen; a lost
  pen release stops counting after 3 s (fingers can't be locked out);
- touches let through to the view (palm navigation) are remembered; when the pen lands while
  they are still down they are palms: their gesture gets a `pointercancel` (the core ends its
  pan / long press / selection drag, the column view its drag), their later events are
  swallowed, a long-press menu from them is dropped, and the view goes back to where it was when
  the palm touched (`InkSurface.view` / `MarkSurface.view`: board viewport, column view zoom +
  pan + level shifts);
- a touch that was drawing when the pen lands was a palm: its stroke is discarded, not committed;
- no editable element under the pen: focused text fields are blurred when a tool starts and when
  the pen lands; the exact-size box is read-only until pressed or focused (Scribble ignores
  read-only fields); overlays have `user-select: none` and no touch callout (touch-action was
  already `none`).

Tested (harness, palm.canvas / deep.canvas; a palm = a CDP touch that lands, drags 60 px, rests,
then stays down while a CDP pen writes; before = main build, after = this build):
- board, palm navigation on: view drift during the stroke 120 × 50 board units → 0 (rest 100 ms
  and 900 ms), pen stroke drawn (1 drawing);
- board, palm navigation off: 2 drawings (palm's + pen's) → 1 (pen's);
- column view with the pen tool: the column under the palm moved 120 px during the stroke → 0,
  stroke drawn;
- regressions: finger pan with no pen moves the board; 1.2 s after the pen a finger pans again;
  a touch 100 ms after the pen is refused (no pan, no ink); a synthetic stylus `touchstart` is
  claimed, a finger one is not; the size box is read-only until pressed.
Not reproducible here: real Scribble (needs an iPad with an Apple Pencil). Please test on the
iPad with Scribble on and off: writing on the open board with the hand resting, on cards, in the
column view, and (after item 6) in the table of contents.
Tutorial "Drawing" → "Draw!": a paragraph on palm rejection (5 locales). Show me in English:
Drawing 11/11, Column view 12/12. Tests 836/836, lint clean.

## 4. Raw HTML / Markdown in titles (done)

Classification: IMPROVEMENT (bug). Root cause: every label made from a card's text used
`titleOf()` (pages/logic.ts), a plain-text cleanup that removed `#`, `*_~=` and links but not
HTML, so the `<mark style=…>` the highlighter writes (and `<span style="color…">` of the text
color tool) showed as text; formatting was lost everywhere. (In the user's screenshot the
breadcrumb looked right only because that card had no highlight: with one it showed the same raw
tag, reproduced below.)

Fix: one shared path, `src/ui/card-title.ts` + `src/ui/title-text.ts` (pure, 3 unit tests):
- `titleMarkdown(text)`: the first non-empty line without heading / list / task / quote marks,
  embeds turned into links;
- `renderTitle(app, el, md, path)`: rendered by Obsidian's `MarkdownRenderer` (the cards' own
  renderer), the paragraph unwrapped, one line with an ellipsis (`ui/card-title.css`), `dir=auto`
  (the title's own direction, as on the card), links inert inside controls; plain text shows
  until the render is done;
- `plainTitle(text)` for notices / tooltips / debug: also strips HTML tags and decodes entities
  (`titleOf` now delegates to it); `escapeMarkdown` for file and group names.
Every place a card's text is shown outside the card, and what was found:
- table of contents (grid) title: raw → formatted (`toc.ts renderTitle`);
- pages bar breadcrumb (board, notes with pages, text pages): raw HTML when the page's card had a
  highlight → formatted (`renderPagesBar` takes the app; `PagesSource.title` is now one line of
  Markdown);
- pages index (side panel): raw → formatted;
- text pages: page links, back links, previous / next buttons: raw → formatted (book titles are
  Markdown now);
- note-link hover preview header (`node-links`): marks stripped only partly → formatted;
- canvas search: no labels, but it matched the raw HTML (a phrase across a highlight wasn't
  found, "background" matched highlighted cards) → tags removed before matching;
- notices naming a page ("moved to page…", placing banner) and debug notices: plain text, tags
  now stripped;
- checked, nothing to fix: column view (shows the cards themselves, rendered), minimap (no text),
  tutorials (their own strings), walk hints (no text), table of contents cells (rendered cards).
Tested (harness, titles.canvas: a page whose first card is the screenshot's text):
before: grid title and crumb text `…è <mark style"background: #ffd43b80;">più grande</mark>`;
after: `(📖)se il calcolo invece è più grande` with a real `<mark>` (background
rgba(255, 212, 59, 0.5)), one line, ellipsis; pages index entry and text-pages crumbs the same.
Tutorials "Big maps in pages" 14/14 and "Table of contents" 8/8 (no text change needed: the
behavior is what they describe). Tests 839/839, lint clean.
