# Feedback round 10: progress

Branch `feature/feedback-round-10` (from `main` at 0.17.1). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 9's notes are in git history: `git show 79e077b:PROGRESS.md`.)

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Notes with pages: bar buttons on iPad (3rd report) | IMPROVEMENT (bug) | done |
| 2 | Nested header cards get the right level at any depth | IMPROVEMENT (bug) | |
| 3 | Headers from card text leave the outline like header cards | IMPROVEMENT (bug) | |
| 4 | No blank line between a heading and its content | IMPROVEMENT | |

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
