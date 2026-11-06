# Feedback round 11: progress

Branch `feature/feedback-round-11` (from `main` at 0.17.2). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 10's notes are in git history: `git show 4b81deb:PROGRESS.md`.)

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Page navigation in notes with pages (4th report) + Debug mode | IMPROVEMENT (bug) + NEW setting | done |
| 2 | No blank lines between a heading's plain lines | IMPROVEMENT (bug) | done |
| 3 | Text options only for selections with text | IMPROVEMENT (bug) | done |
| 4 | Shape text rotates with the shape | IMPROVEMENT | to do |
| 5 | Highlighter: "Neutral" option | ALREADY EXISTS → IMPROVEMENT (discoverability) | to do |

## 1. Page navigation in notes with pages (done)

Root cause. In a note the pages bar was a plain, static block (`position: static`, no z-index)
squeezed between the tab header and the note; on the board the same bar is
`position: absolute; z-index: var(--layer-popover) - 1`. Any positioned element that overlaps the
note's bar — a transparent strip of the app's tablet layout, a theme, or another plugin's toolbar
layer — sits above a static block, so it receives every tap while the bar under it still looks
and reads correctly (counter and crumbs are right). Reproduced on 0.17.2 (tablet emulation) with
an invisible layer over the bar: ‹, ›, crumbs and the index button all did nothing, by touch and
by mouse — exactly the report — while the board's bar kept working. All four earlier fixes
changed *how the button listens* (click → pointerup → touchend + late-click swallow), each
verified by events delivered straight to the button in the harness; none could help when the
events never reach the button. Also, every button had its own listeners, so a bar redrawn while
the finger was down (the note changes and the crumbs are rebuilt) relied on browser-specific
pointer-capture behaviour.

Fix (one mechanism for board, note and text pages: `src/ui/nav-controls.ts`):
- Controls are marked with `navControl(el, run)`; one set of listeners per window, in the
  window's capture phase (before anything else on the page), resolves presses: by
  `target.closest(".opc-nav-control")`, else by position (the control whose box holds the point,
  unless a menu, dialog, drawer or popover covers it). A press is resolved again at release, so a
  control redrawn mid-press still answers; its action reads the page shown when it runs.
- Touch/pen: runs on release over the control, no mouse events and no click follow (the late
  click that used to close the index drawer), presses never reach the pane below.
- Every page-change action calls `source.show()` → `PagedNotes.show()` in notes (the function the
  note's links use) or the board's `show()`.
- The note's bar is now `position: relative; z-index: calc(var(--layer-cover) - 1)` (above the
  note and the header's overflow, below the drawers and their backdrop).
- `src/ui/press.ts` (the per-button listener) is gone; text pages use navControl too.
- The bulleted-list button was "Show the whole note" with an unclear icon: kept (it is the only
  way to see every page at once in the note) with icons unfold-vertical / fold-vertical and a
  label that follows its state ("Show the whole note" / "Show one page at a time").
- Crumbs: `display: inline-block`, so a long title ends in "…" instead of being cut on both sides.

Debug mode (global setting under the language, off by default, `settings.debug`,
`src/core/debug.ts`): a Notice for every press on a page-navigation control (which control,
whether it got the press directly or through which covering element, or that it is disabled /
the finger left it / it failed), for every page change ("page shown: X (n / total) in file"),
and 0.8 s after opening the index whether the side panel actually stayed open. Debug notices are
click-through (`.opc-debug-notice`), because they appear over the top corner where ‹ › are.

Tested (test vault, `matrix.sh` / `mini.sh`): tablet emulation, CDP touch, 3 rounds of note ⇄
canvas switching with crumbs / ‹ / › / whole note / index each round, then another note in a new
tab and back: 46/46 twice. Reading view and editing view; debug on and off; desktop with real
mouse events (note bar, canvas crumbs from a sub-page, index), keyboard activation. Old build vs
new under an invisible layer over the bar: old = nothing works, new = all work (mouse via
position fallback). Crumb redrawn by a real note edit while the finger is down: still runs.
Tutorial "Big maps in pages" (step noteLinks text updated in 5 locales): 14/14 in en, zh, ja,
hi, ru. Unit tests 722/722, typecheck, store lint clean.
**Needs confirmation on the iPad**: turn on Debug mode; each tap must show a message.

## 2. No blank lines between a heading's plain lines (done)

Cause: the "first level without bullets" writer put a blank line before every first-level line
except the first under a heading (0.17.2 only removed the one right after the heading). Markdown
needs those blank lines: without them a plain line right after a bullet is read as the lazy
continuation of that bullet, and two plain lines in a row are one paragraph. Measured in Obsidian
1.15 (Reading view vs Live Preview): no separator → Live Preview right, Reading view puts the
siblings inside the last bullet; `%%%%` / `<!-- -->` separator lines or prefixes → no help in
Reading view and visible lines in Live Preview; blank lines → right structure but a ~15 px gap.

Method: the note is written packed — no blank line anywhere between one heading and the next,
every first-level item on one line (a card's own further lines joined with `<br>`, like
headings), its bullets right below; blank lines only before headings. The parser reads every
line at the start of a line that is no bullet or heading as a first-level item (data
`packed: true`; notes from 0.17.2 and older are read the way they were written). Live Preview
shows the lines as they are. Reading view (one note and notes with pages): a post-processor
(`packed-view.ts`, pure part `packed.ts`) draws each block section of a packed note again from a
copy with a blank line before each plain line, and every block section gets class
`opc-md-packed` (no paragraph/list margins), so each line is on its own line with no gaps. Only
notes whose data says packed are touched.

Tested: unit tests (the reported layout written exactly as requested and read back; 0.17.2
notes read as before; packed splitter); live, test map with the reported structure (header card
"Esami del laboratorio" with three plain children): source has a blank line only before the
heading; Reading view and Live Preview both 25–26 px per line from "Esami ematici" to "Prelievi
bioptici"; note → canvas unchanged, a typed plain line + bullet became a new sibling and its
child; Flu with 7 pages in pages mode: same spacing, one page shown. Setting description and
tutorial step `plain` updated in 5 locales. Tutorial "Canvas ⇄ Markdown": 7/7 in en, zh, ja, hi, ru.

## 3. Text options only where there is text (done)

Cause: the text buttons of the selection toolbar (text size, alignment, direction, growing with
the text, header) asked `onlyTextBoxes()`, and `isTextBox()` counts every file card as a text box;
an image (or PDF, or any other file) on the board is a file card. They also hid themselves for a
mixed selection, since every selected item had to qualify.

Fix: `hasFormattableText()` / `textCardsIn()` in `modules/shared.ts`: text cards (not ink, lines
or infinite lines) and note file cards (`.md`) only. Each text button shows when the selection
holds at least one such card and acts on those only; images, other files, arrows and groups in the
selection are left alone. `isTextBox()` itself is unchanged (ink sticking to cards and dropping
note blocks onto cards still work with image cards). `onlyTextBoxes()` removed (no users left).

Tested (test vault, real selection toolbar): text card → 5 text buttons; image → none; note file
card → 4 (header is for text cards only); image + text card and image + note → shown; text size
24 and right-to-left from a selection of image + text card + note card changed the text card and
the note card, not the image. Tutorial "Basics" step s5 (the toolbar) says so, in 5 locales; 7/7 in en, zh, ja, hi, ru.
