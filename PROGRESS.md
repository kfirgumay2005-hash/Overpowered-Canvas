# Feedback round 9: progress

Branch `feature/feedback-round-9` (from `main` at 0.16.2). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Auto layout keeps sibling order | IMPROVEMENT (bug) | done |
| 2 | Markdown mode: page indicator arrows (top right) | IMPROVEMENT (bug) | done |
| 3 | Markdown mode: Pages button (top left) | IMPROVEMENT (bug) | done |
| 4 | Header cards → real Markdown headings | NEW | not started |
| 5 | First outline level without a bullet (setting) | NEW | not started |
| 6A | Radial layout: connector overlaps | IMPROVEMENT (bug) | not started |
| 6B | Condensed radial layout | NEW | not started |

## 1. Sibling order (done)

Root cause: the order of siblings was read back from card positions on every layout, and
positions are ambiguous:
- a card dropped on "Add as child" landed between existing children instead of last;
- children both beside and above / below their parent were read along the wrong axis;
- in radial maps a branch near 12 o'clock flipped its children on every run (angle measured from
  12 o'clock around the parent instead of from the way back to the parent);
- in RTL canvases the menu's auto layout read and placed up / down / balanced / radial maps
  left to right, while drops and relayouts used right to left.

Fix: a stored ordered outline, root `x-opc.childOrder` (parent id → child ids), in
`src/modules/mindmap/order.ts` (pure) and `order-store.ts` (live canvas). Written by drops (child:
last, sibling: right after the target), Tab / Enter, the column view's + buttons, a hand move among
siblings (auto-layout patches `handleSelectionDrag`), radial layouts and Markdown → canvas. Read by
auto layout (all directions), relayout after drops, walk, column view and the Markdown export.
Pages split / merge carry the list; template copies remap it. The RTL sibling target of up / down
maps now sits on the reading side (left).

Tested: `scen.mjs` (random sibling / child drops on a copy of the 159-card real map, checks the
order after every drop and every layout) in right, left, down, up, balanced and radial on the RTL
harness canvas: 0 failures. `t_order.sh`: reorder, all six directions in a row, reload (order in
the .canvas file), Enter, Tab, hand drag, undo. Unit tests in `order.test.ts`, `layout.test.ts`
(stored order wins, RTL, radial stability), `roundtrip.test.ts`. Tutorial "Mind maps" got step
`order` (+ touch text for the layout step); ran by Show me in en, zh, ja, hi, ru: 10/10 each.

## 2–3. Notes with pages: bar arrows and Pages button (done, one commit)

Not reproducible in the harness: mouse, CDP touch and Obsidian's mobile emulation all worked
with the old build, in editing and reading view (the harness even has the user's editing
toolbar). The canvas bar works for the user and the note bar doesn't, and the difference is where
the press lands: inside a note, the pane's own touch gestures and the editor can take a tap's
synthesized `click`, which is how the buttons were wired. Fix: `src/ui/press.ts` `onPress`: a touch
or pen press runs on release over the button (pointerup), keeps the editor's focus (so a tablet's
keyboard doesn't close mid-tap), stops the pane's gestures from seeing it, and drops the
follow-up click; mouse and keyboard keep the click. Used by the pages bar (canvas, notes, text
pages: index button and crumbs), the note's prev / next / whole-note buttons and the text-pages
nav. Prev / next now follow the index's order exactly (`structure.ts pageOrder`, which the sections already used).
Tested: mdbar.sh (mouse) and mdtouch.sh (touch, editor focused or not), editing and reading view.
Tutorial "Big maps in pages" (noteLinks step mentions the index button and taps), run in all 5
languages: 14/14; "Big boards" 2/2. **Needs confirmation on the user's iPad.**
