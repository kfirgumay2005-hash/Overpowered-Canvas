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
| 5 | Grid mode: nested sub-groups | IMPROVEMENT | done |
| 6 | Grid mode: handwriting tools | NEW (tools in the grid view) | |
| 7 | Grid mode: lock layout toggle | NEW | done |
| 8 | Group customization (thickness, colors, style, radius) | IMPROVEMENT | done |

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

## 5. Table of contents: nested sub-groups (done)

Classification: IMPROVEMENT of the existing cell groups (round 13, C2).
Model (`toc-layout.ts`, pure): a split of a group's tree may carry `group: { id, color }` (schema
`TocSplit` / `TocSubGroup`, validator, SCHEMA.md): a sub-group, never merged into its parent when
directions match, dissolved when it holds one cell, folded into the group when it holds all of
it (one outline, not two). New drop `{ kind: "sub" }` (wrap the target cell and the dropped one
into a new sub-group where the cell was) and new moving kind `{ kind: "sub" }` (the sub-group as a
unit: beside a cell, into another sub-group, or out to a grid slot where it becomes a group of
its own keeping its color). `recolor` / `ungroup` take a group's or a sub-group's id (a dissolved
sub-group leaves its cells in place). New groups/sub-groups get automatic colors different from
every outline around them. Helpers `findSub`, `subGroupsOf`, `groupsAround`. Nesting is recursive
(the validator already allowed 12 levels).
View (`toc.ts`): sub-groups render with their own outline and a small handle (free mode); drag
by the handle or the outline moves it; a tap on the handle opens the same menu as a group
(colors, Ungroup the cells). Drop rule: the middle half of a cell of the **same group** → new
sub-group (dashed box around the cell); its edges → move within the group; a cell of another
group → join it; a lone cell → new group; between rows → new row. The guide carries a label
saying which (New sub-group / Join this group / New group / Move here / New row; 5 locales);
joining is drawn in the accent color, moves muted. Each change is one undo step, stored with the
canvas like groups.
Tested: 4 new unit tests (make, nest with three distinct colors, move as a unit in and out,
dissolve / one cell left) — toc-layout 12/12. Harness (toc5.canvas, real mouse drags): C beside B
→ "New group"; D beside C → "Join this group"; D on C's middle → "New sub-group", stored
`{dir: col, items: [c, d], group: {id, color: "6"}}` inside group color 5; B on D's middle →
nested sub-group; the sub-group dragged by its handle to a new row → a group of its own, color
kept; undo restored both levels; tap on a sub-group handle → menu with colors + Ungroup → cells
back in place. Tutorial "Table of contents": new step "Groups inside groups" (touch line; 5
locales); Show me in English 9/9. Tests 843/843, lint clean.

## 7. Table of contents: lock the layout (done)

Classification: NEW (nothing locked the grid; the canvas's read-only mode only applies to the
board). In `toc.ts`: a lock button in the view's controls (free arrangement, editable boards) and
the command "Table of contents: lock / unlock the layout" (palette, `presentation:toc-lock`).
Locked: the view renders without the free arrangement's handles and drag targets, so a drag on a
cell or group pans the view; going into cells, back, zoom, links, editing and (item 6) the pen,
highlighter and text color tools still work. Stored per canvas in the canvas root (`tocLocked`,
schema + validator + SCHEMA.md), so it is the same on every device, written as a view setting:
no undo step, and the flag is written into the existing undo snapshots too, so undoing an
earlier change never unlocks it. Event `toc-locked` (EVENTS.md, tutorial runner).
Column view: not added on purpose — a drag there only ever pans (cards are never moved by a
drag; the only size change is the explicit resize handle), so there is nothing to lock.
Tested (harness, toc5.canvas): lock → class is-locked, no is-free, button active with the unlock
label; a drag of C onto B's edge panned the view and stored nothing; closed the tab, reopened the
canvas and the table of contents: still locked; the command unlocked it and the same drag made a
group; lock toggled with a pending grouping: history length unchanged (6/7 → 6/7), undo removed
the grouping and kept the lock; the file on disk has `"tocLocked":true`. Tutorial "Table of
contents": new step "Lock the layout" (touch line, command alternative; 5 locales); Show me in
English 10/10. Tests 843/843, lint clean.

## 8. Group customization (done)

Classification: IMPROVEMENT of the cell groups' color menu (round 13 had 6 canvas colors + ungroup).
- Stored per group and sub-group (`TocGroupStyle`: `color`, `width`, `line`, `radius`; schema,
  validator, SCHEMA.md). Colors reuse the plugin's color system: canvas colors "1"–"6", the
  theme's extra slots "7"–"32" (the custom-colors module's), or "#rrggbb". Kept through every
  move, sub-group → group, reload (`styleOf`, `restyle`, `styleOfGroup`; unit test).
- Settings (Presentations): default outline thickness (1–12 px, 2), line (solid / dashed /
  dotted), corners (0–48 px, 12), and **your group colors** (swatches, click to remove, color picker
  to add; max 24). Defaults are CSS variables on the view; a group's own values win via classes
  (no inheritance into nested sub-groups).
- Handle menu: **Color ▸** (canvas colors, theme slots that exist, your colors — each with its swatch —,
  **Pick a color…** (system picker; the color is added to your colors), **Automatic color**),
  **Outline ▸** (thickness default/1/2/3/4/6/8 px, line default/solid/dashed/dotted, corners
  default/0/4/8/16/24 px), **Ungroup the cells**. Submenus where the app has them, else inline.
- Light and dark: "#rrggbb" colors render identically; canvas colors follow the theme as on the
  board; the handle's icon is black or white by the color's luminance, so it stays readable.
Tested (harness): menu shows Color ▸ / Outline ▸ / Ungroup; Outline → 6 px, Dashed, 0 px and
Color → Purple stored as `{color: "6", width: 6, line: "dashed", radius: 0}`, computed border
dashed / 0 px corners; light theme: purple follows the theme (rgb(168,130,255) → rgb(120,82,238)),
handle icon black → white; Pick a color… #e8590c → stored, added to the palette setting, same
rgb(232,89,12) in both themes; settings render the 4 new rows with the swatch and picker. Unit
test (style through moves/sub-groups/reload/defaults) — tests 844/844. Tutorial "Table of
contents": the color step became "The group's look" (menu, outline, settings; 5 locales; its demo
updated for the submenu); Show me in English 10/10. Lint clean.
