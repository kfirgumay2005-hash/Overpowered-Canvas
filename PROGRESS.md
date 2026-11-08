# Feedback round 12: progress

Branch `feature/feedback-round-12` (from `main` at 0.18.2). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 11's notes are in git history: `git show 22f6de7:PROGRESS.md`.)

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Pages bar overlaps the color palettes | IMPROVEMENT (bug) | done |
| 2 | Gear in the side controls opens the plugin's settings | IMPROVEMENT | done |
| 3 | Emoji picker in the bottom toolbar | NEW | todo |
| 4 | Cropped images become invisible | IMPROVEMENT (bug) | done |
| 5 | Shortcuts window (replaces the shortcut settings) | NEW (replaces 2 settings + the core help list) | done |
| 6 | Context menu styling | NEW | todo |

## 1. Pages bar vs. palettes (done)

Root cause. Every bar that floats at the top of a board picked its own spot with no knowledge of
the others: the pages bar at the top start corner (`max-width: 100% - 120px`), the highlighter /
text color palette and the drawing toolbar centered at the same `top`, the search bar at the top
end, the minimap in a top corner (by default the same corner as the pages bar). On an iPad in
portrait (or any narrow window) the centered palette and a long breadcrumb share the row.

Fix: `src/ui/top-lane.ts`, one layout for all top bars of a host (the canvas wrapper, or the
column view). Each bar joins with a rank (pages 0, search 1, palettes 2, minimap 3); a bar that
would cover a bar of a lower rank moves just below it (`--opc-lane-offset` added to its `top`).
Re-placed on any size change of the host or a bar and when a bar comes or goes (ResizeObserver +
MutationObserver, one frame later). The host gets `--opc-lane-side` (the room the side controls
take), so centered palettes stay clear of the controls and wrap onto a second row instead.
The pages bar is one row: crumbs shrink with "…" (the current page keeps the most room).

Tested (test vault, 3 nested pages with long titles): 820 px wide (iPad portrait) — palette moved
to its own row under the breadcrumb (before: same row, overlapping); 430 px (phone) — breadcrumb,
search, drawing toolbar and minimap stacked without overlap, crumbs truncated on one row; 1500 px
— palette stays on the first row next to the breadcrumb (no needless move). Unit tests 733/733.
Notes with pages keep their static bar (no floating palettes there). No tutorial text changed:
the bars still look and work the same, only their position adapts.

## 2. Gear opens the plugin's settings (done)

Classification: IMPROVEMENT. The gear is the core "Canvas settings" button (`canvas.quickSettingsButton`),
which opened a small menu (Snap to grid, Snap to objects, Read-only, and our Customize the bars).
Now (better-defaults module, `settings-gear.ts`, new option "Settings button opens this plugin's
settings", on by default): a click or tap opens Obsidian's settings on this plugin's tab
(`app.setting.open()` + `openTabById(manifest.id)`, exposed to modules as
`ctx.openPluginSettings()`); right-click or a long press (500 ms, touch/pen) opens the canvas
options menu as before, so snap and read-only stay one gesture away. The tooltip says so. With the
option off the button behaves exactly as the core one.

Tested (test vault): mouse click → settings on the plugin's tab (this Obsidian opens settings in a
popout window; the popout showed "Overpowered Canvas"); touch tap (CDP touch events) → same; touch
long press → canvas options menu, no settings; right-click → canvas options menu; option off →
click opens the canvas options, label back to "Canvas settings"; on again → takeover back.
Tutorials updated (5 locales): "Your own bars" s1 (+ touch line), popup/image touch lines;
"A canvas as a file" s3/s4 (read-only via right-click / long press, + touch lines).
Run in English: Your own bars 7/7, A canvas as a file 4/4.

## 4. Cropped images invisible (done)

Root cause. A cropped card shows its picture by taking the `<img>` out of flow
(`position: absolute`, sized and shifted in % of the content box) inside a clipping
`.canvas-node-content`. In current Obsidian the card's `.canvas-node-container` is a flex row and
the content box is a `flex: 0 1 auto` item, i.e. exactly as wide as its content. With the only
child out of flow the content box shrank to **0 px wide** (height still stretched to 448 px), so
the image was `100% / w` of 0 = 0 px wide: only the card's border was left. Reproduced in the test
vault (content 0×448, img 0×448). Data, file and crop math were fine; nothing was "broken" in the
stored crop, which is why reloading didn't help.

Fix (image-crop CSS): the content box of a cropped card fills the card by itself
(`flex: 1 1 auto; width: 100%; height: 100%; min-width/min-height: 0`). The column view ignored
crops in its default mode (it rendered `![[image]]` in full): a cropped image card now shows only
its crop there too (`.opc-crop-view`, same CSS, at the column's width). Actual-size column mode
copies the card (and its crop) and works with the CSS fix.

Tested (test vault; PNG 1200×400, JPG 300×900, WebP 64×64, SVG 400×300): crop through the crop
dialog with 4:3, 1:1, 16:9 presets and a touch drag of a corner handle → each card shows its crop
right away; closed and reopened the canvas → same; re-crop 1:1 → 3:4 (editor opens on the current
crop) → updated; "Reset crop" → full picture, attribute gone; column view (default and actual
size) → crop shown; PNG export → all crops right. Canvas ⇄ Markdown keeps the crop data (the note
itself shows the whole picture: Markdown has no crop). Tutorials run in English: Images 4/4,
Column view 11/11 (no text change needed: the feature works as the tutorial already describes).

## 5. Shortcuts window (done)

Classification: NEW window, replacing what existed: the core "Canvas help" list (the ? button) and
the two options that chose keys (mind map "Key for a sibling card", smart groups "Ctrl/Cmd+G in
canvases"). No parallel feature is left: those options are gone, the ? button opens the window.

Inventory (every key the plugin handles, now all in `src/core/shortcuts/catalog.ts`): tools on the
board (Ctrl/Cmd+F search, P drawing, H highlighter, L lasso, M minimap, Ctrl/Cmd+G / Shift+G
smart groups — the latter were missing from any list before); while a tool is on (drawing Esc and
Delete/Backspace, highlighter Esc, lasso Esc); mind maps (Tab, Enter, Alt/Ctrl/Ctrl+Shift+arrows
= 14 keys); sticky notes (Tab, Ctrl+arrows); presentations and frame shows (next, previous, first,
last, end); walking and the column view (arrows, Home, + / =, -, Esc, Tab, Enter, F2); pages (Esc
while placing a branch); editing (Ctrl+Enter / Esc in column view and text pages editors, Esc while
dragging a note block); plus Obsidian's own canvas keys (read-only, from the old help list).

How it works:
- `core/shortcuts/keys.ts`: combos as text ("Mod+Shift+G"), letters read by key position (any
  layout), Shift dropped from typed symbols, Mac/Windows display.
- `core/shortcuts/store.ts`: current keys = catalog defaults + `settings.shortcuts` (id → combos,
  `[]` = off; absent = default). Live: modules read keys on every press.
- `CanvasUi.addCanvasKey` now takes a shortcut id; one catch-all handler per canvas view, first in
  its scope, runs the bound shortcuts and lets unhandled keys through (so Obsidian hotkeys and the
  canvas' own keys still work — Ctrl+G with nothing to group reaches the graph view naturally; the
  old `runHotkeyCommand` workaround is no longer needed there).
- In-mode keys (presentation, frames, walk, drawing, lasso, highlighter, pages, note blocks,
  editors) use `ctx.isShortcut` / `ctx.shortcutOf`.
- Window (`ui/shortcuts-modal.ts`): search (action, situation, category, key — "ctrl+g" works),
  categories, per row: key chips with ×, + to record (Esc cancels), ↺ to default, warning when two
  plugin shortcuts share a key; Reset all (two clicks). Recording a taken key shows who has it
  (other canvas shortcut, built-in canvas key, any Obsidian hotkey) with Replace / Keep both /
  Cancel ("Use it anyway" when only a built-in key has it).

Migration: `sanitizeSettings` — when data.json has no `shortcuts` yet, "Shift+Enter" as sibling
key becomes `mindmap.sibling: ["Shift+Enter"]`, smart groups keys off become `groups.group: []`,
`groups.ungroup: []`. Once `shortcuts` is saved it wins (no second migration). Unit-tested, and
tested live (old data.json → keys migrated and saved, Shift+Enter adds the sibling, Enter doesn't).

Obsidian's Hotkeys (decision): canvas shortcuts can't be Obsidian hotkeys (single letters, only
when a card is selected, only while presenting…), so they live in the plugin. The plugin's
commands keep their hotkeys in Obsidian (hotkeys.json): the window's "Commands (Obsidian hotkeys)"
section reads and writes them through `app.hotkeyManager` (same data, no copy) and links to
Settings → Hotkeys filtered to the plugin. One store per kind of key, no duplicate.

Entry points: the ? button of every canvas, command "Shortcuts", a "Shortcuts" row at the top of the
plugin settings (and "Keys" rows in Mind maps and Smart groups that open it). Opening from the
settings closes them first (they may be a popout window). Touch: list, ×, ↺, Reset all work by
touch; a line tells that recording needs a keyboard on phones/tablets; bigger targets on touch.

Tested (test vault, real key events over CDP): + then Shift+D on Drawing → saved, P removed → P
does nothing, Shift+D toggles drawing, Esc ends it; recording M on Drawing → "M is already in use:
Show or hide the minimap (canvas shortcut)" → Replace → minimap key off; Ctrl+P on Lasso → "Command
palette: Open command palette (Obsidian hotkey)" → Cancel; search "ctrl+g" → Group the selected
cards; Alt+M on the Toggle minimap command → in hotkeys.json, Alt+M in a canvas toggles the minimap
(Obsidian hotkeys still pass through); Reset all → `{}` and the command hotkey removed; Ctrl+G with
two cards → smart group, with nothing selected → graph view; Tab/Enter in a mind map; walk arrows
and Esc. Phone width 430 px: layout fits, no horizontal scroll. Unit tests: 759.
Tutorials: new "Your shortcuts" (5 steps, touch lines, the user's keys restored when it ends —
`restoreShortcuts`); Mind maps s2 and Smart groups s2 point to the window (5 locales). Run in
English: Your shortcuts 4/4, Mind maps 11/11, Smart groups 5/5, Drawing 10/10, Presentations 5/5,
Column view 11/11.
