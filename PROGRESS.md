# Feedback round 9: progress

Branch `feature/feedback-round-9` (from `main` at 0.16.2). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Auto layout keeps sibling order | IMPROVEMENT (bug) | done |
| 2 | Markdown mode: page indicator arrows (top right) | IMPROVEMENT (bug) | not started |
| 3 | Markdown mode: Pages button (top left) | IMPROVEMENT (bug) | not started |
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
