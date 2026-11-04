# Feedback round 9: progress

Branch `feature/feedback-round-9` (from `main` at 0.16.2). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Auto layout keeps sibling order | IMPROVEMENT (bug) | done |
| 2 | Markdown mode: page indicator arrows (top right) | IMPROVEMENT (bug) | done |
| 3 | Markdown mode: Pages button (top left) | IMPROVEMENT (bug) | done |
| 4 | Header cards → real Markdown headings | NEW | done |
| 5 | First outline level without a bullet (setting) | NEW | done |
| 6A | Radial layout: connector overlaps | IMPROVEMENT (bug) | done |
| 6B | Condensed radial layout | NEW | done |

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

## 4. Header cards (done)

NEW (the export kept a card's heading marks inside its bullet; no header option existed).
x-opc node `header` (0 = automatic, 1–6 = own level); text starting with `## ` counts too.
`canvas-markdown/headers.ts` (pure: extractHeaders after pages are placed), `header-ui.ts` (popup
button **H** with a picker: automatic, levels 1–6, not a header; card menu *Header card…*;
commands *Header card: on / off* and *Header card…*; badge H / H4 on the card). Import: nested
headings become header cards, a plain line where a header fits unmarks it, marks in text kept.
Rules: heading only under a heading (map root or header), up to H6, else stays in the outline;
plain lines before sub-headings. Works in one long note and in notes with pages (one level below
the page heading). Tests in roundtrip.test.ts; live test hdr.sh (real clicks). Tutorial
"Canvas ⇄ Markdown": new step `header` (+ touch text), 6/6 in all 5 languages.

## 5. First level without bullets (done)

NEW. Setting `canvas-markdown.plainFirst` (Settings → Canvas ⇄ Markdown → First level without
bullets, off by default). writeOutline/parseOutline `plain` option; NoteData `plain` so each note
is read the way it was written (clean notes re-parse after loading their data file); copy /
paste outline follow the setting. Blank lines inside such text are written as `<br>`. Tests in
roundtrip.test.ts (shape, ids, escapes, full note round trip); live export with header cards.
Tutorial "Canvas ⇄ Markdown": step `plain` (setting on for the practice board only, restored),
7/7 in all 5 languages.

## 6A. Radial connectors (done)

Not reproduced on any harness map (crossings / connectors under cards measured from the
rendered SVG paths with overlap.js, old and new build, single runs, repeated runs, after drops).
The likely old cause was fixed in item 1 (radial branches near 12 o'clock flipped their children on
every run, so a map drifted between runs). Made into guarantees anyway: the classic radial layout
grows its rings while any parent → child line crosses another or passes under a card
(`radial.ts clashingPairs / connectorsClash`), and after the sides are chosen, a curved connector
of a radial map whose drawn curve still crosses, grazes another (< 8 px) or touches a card is drawn
straight (`sides.ts troubledEdges`, applied in `arrange.ts styleRadialEdges`, committed with 6B).

## 6B. Condensed radial (done)

NEW layout direction `condensed` ("Condensed radial", next to Radial in the Auto layout dialog;
command *Auto layout: condensed radial mind map*; recorded in mapLayouts, so drops re-arrange it).
`auto-layout/condensed.ts`: branches get sectors of the full turn by what their subtree needs;
each branch's levels spaced by its own cards; a crowded branch moves out only the level that gains
most; then a compaction pass pulls every card (with its branch) toward its parent as far as it
stays clear (14 px clearance between connector lines and around cards). Sibling order from
radialKids (item 1). Setting *Connectors of radial maps*: curved (default) / straight (applies to
both radial layouts; only routes the layout set itself). Measured on the 159-card map: fill 0.066
vs 0.027 for classic radial, 0 overlaps / crossings / connectors under cards (also 4 other maps, RTL
canvas). Tests: condensed.test.ts (no overlaps or clashes at 12/60/150 cards, ≤ 80 % of radial's
area, order, stable). scen.mjs condensed: 0 order failures. Tutorial "Mind maps": step `condensed`,
11/11 in all 5 languages.
