# Feedback round 10: progress

Branch `feature/feedback-round-10` (from `main` at 0.17.1). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 9's notes are in git history: `git show 79e077b:PROGRESS.md`.)

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Notes with pages: bar buttons on iPad (3rd report) | IMPROVEMENT (bug) | done |
| 2 | Nested header cards get the right level at any depth | IMPROVEMENT (bug) | done |
| 3 | Headers from card text leave the outline like header cards | IMPROVEMENT (bug) | done |
| 4 | No blank line between a heading and its content | IMPROVEMENT | done |

## 1. Bar buttons of notes with pages (done)

Root cause (reproduced in Obsidian's tablet emulation, `app.emulateMobile(true)` on a maximized
window): round 9 made the bar buttons run on `pointerup` (`src/ui/press.ts onPress`) and only
ignored the late `click` *on the button itself*. The browser still makes up that click after the
touch ends, at whatever is under the finger at that moment. The index button opens the pages
index in the left drawer, whose full-screen backdrop is then under the finger: the click lands on
the backdrop, and the drawer's backdrop click handler closes the drawer at once. So the tap
looked like it did nothing (the index leaf was created, `leftSplit.collapsed` stayed true;
instrumenting `leftSplit.expand` showed the expand call). On the board the same button worked
because the canvas cancels touch defaults itself, so no click is made there. Earlier fixes
patched the button's own events (click, then pointerup) and were checked by "the index leaf
exists", never by "the drawer is open".

Fix: `onPress` now handles a touch press completely: it runs once on `pointerup` or, where
pointer events don't arrive, on `touchend`; the `touchend` is default-prevented (no mouse events
and no click are made from the tap, which also keeps the editor's focus without the old
`pointerdown` preventDefault), and any click still made within 700 ms is swallowed in the
capture phase before it reaches anything. Mouse and keyboard keep the plain click. Used by the
pages bar (board and note), the note's ‹ › and whole-note buttons, and text pages.

Tested (`tapbar.sh`, CDP touch in tablet emulation, events logged per tap): index button →
drawer stays open, no click event at all after the touch; ‹ › in reading view and editing view
(counter and crumbs follow, editor keeps focus), whole-note toggle, after switching canvas ⇄
note three times, and on a second note (Disease.md); board index button and crumbs still work.

## 2–3. Header cards at any depth; typed headings (done, one commit: one root cause)

Root cause, for both: `extractHeaders` only turned a header into a heading when it was a *direct*
child of a heading (round 9's rule "a heading only under a heading"). A header card two levels
into an H2's branch (under a plain line) was skipped: item 2. A card whose text is `## …` already
went through the same code (`headerOf` reads x-opc `header` or the text's marks), so a typed
heading under a plain line stayed a bullet with heading formatting, `- ## …`: item 3. The
reported repro for item 3 is most likely such a card below a plain line (a typed heading directly under the root or a header was already extracted).

Fix (`headers.ts`): each heading scans its whole outline; a header found under plain lines at
any depth is lifted out as a heading one below the nearest heading above it (own level only
deeper; past H6 it stays in the outline), sub-headings in outline order after the plain lines.
One path for both kinds (`liftLevel`). Import (`apply.ts`): a lifted header goes back under the
card it had when that card is still in the same heading's outline, at its old place among the
siblings; and a heading's children read back in the "plain lines first, headings after" split of
their old order keep their old order (before, every round trip through a note with headers
stored that split as a new `childOrder`, reordering the board).

Tested: unit tests (nesting at any depth, typed vs marked identical, lifted header returns to its
card and order, note → canvas → note identical). Live (`mkhdr.js`, test vault): Root → Alpha (H)
→ alpha line → Deep (H) and Root → Beta → `## Typed` gave `## Alpha … ### Deep … ## Typed`;
back to the canvas: same parents, positions and texts; new lines typed under `### Deep` and
under the typed heading's child became children of the right cards. Tutorial "Canvas ⇄
Markdown", step `header`, text updated in all 5 locales.

## 4. No blank line between a heading and its content (done)

Only the "first level without bullets" layout wrote a blank line after each heading (plain
lines are paragraphs, each written after a blank line, including the first). In the bullet
layout the bullets already followed the heading directly. Now the first plain line follows its
heading directly; blank lines only separate blocks and go before a heading. Since a line right
below a heading used to be read as the heading's own further text, a multi-line header card's
further lines now go onto the heading line joined with `<br>`. The note's data records the
layout (`tight: true`); plain notes from before (no `tight`) are read the old way, so they keep
going back to the board unchanged (`readOptions` in note.ts, used by notes, notes with pages and
clean notes). Same writer for one long note and notes with pages.

Tested: unit tests (layout, ids, multi-line headings, old notes read the old way, note ⇄ canvas
round trip unchanged). Live with the setting on: the header board (`# Root\nBeta\n- beta line\n\n##
Alpha\nalpha line…`) back to the canvas with the same parents, positions and texts; the Flu note
with pages in reading and editing view, arrows by touch. Setting description and tutorial step
`plain` updated in all 5 locales.

## Regression pass (all items)

- Full test suite, typecheck, store lint (changed files): clean.
- Tutorials changed or touched (Canvas ⇄ Markdown, Big boards, Big maps in pages), by Show me in
  en, zh, ja, hi, ru: 7/7, 2/2, 14/14 in every language. Only error logged: the Ink plugin's
  "Field is not present in this state" (not ours, known since 0.8).
- Desktop (no emulation), real mouse: ‹ › and the index button of a note with pages.
- **Needs confirmation on the user's iPad** (the harness has no real iOS touch).
