# Feedback round 12: progress

Branch `feature/feedback-round-12` (from `main` at 0.18.2). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 11's notes are in git history: `git show 22f6de7:PROGRESS.md`.)

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Pages bar overlaps the color palettes | IMPROVEMENT (bug) | done |
| 2 | Gear in the side controls opens the plugin's settings | IMPROVEMENT | done |
| 3 | Emoji picker in the bottom toolbar | NEW | done |
| 4 | Cropped images become invisible | IMPROVEMENT (bug) | done |
| 5 | Shortcuts window (replaces the shortcut settings) | NEW (replaces 2 settings + the core help list) | done |
| 6 | Context menu styling | NEW | done |

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

## 3. Emoji picker (done)

Classification: NEW (no emoji feature existed; the icon picker of card templates is for Lucide
icons and stays as it is). Module `emoji-picker` (group Cards, on by default).

- Data: emojibase-data 18 (MIT, in THIRD_PARTY_NOTICES.md), read at build time by
  `scripts/emoji-data.mjs` (esbuild virtual module "emoji-data"): 1,906 emoji up to Emoji 16 (newer
  ones are left out because most systems can't draw them yet), 9 categories, 5 skin tones where
  they exist, English names and keywords as plain text, names and keywords in the other UI
  languages deflate-compressed (~350 KB in all, main.js 4.76 → 5.17 MB with this round). No network.
  Parsed only when the picker first opens (~35 ms); the UI language's names are unpacked then
  (DecompressionStream; English search still works without it).
- Picker (`panel.ts`, in the shared popover above the bottom bar): search (UI language + English,
  best matches first, Enter picks the first), category tabs that scroll the list and follow it,
  Recently used (36, stored in the module settings), skin tone (hand button, remembered), preview
  with the name, large touch targets, `content-visibility` for the long list. Stays open for
  several picks; Esc / outside tap closes.
- Insertion: editing a card → at the cursor (the button keeps the editor's focus; after the picker
  closes the cursor is right after the emoji); a text card selected → at the end of its text,
  after a space (the existing words stay intact and it lands where typing would continue; several
  selected text cards each get it, one undo step); nothing (or no text card) selected → a new
  120×80 card in the middle of the view, which stays selected, so the next emoji join it.
  Read-only canvas → notice. Command "Insert emoji" too (assignable in the Shortcuts window).

Tested (test vault, real mouse/touch/keyboard over CDP): nothing selected → typed "pizza", Enter →
new card "🍕"; clicked 😀 → same card "🍕 😀"; editing "Hello world" with the cursor after "Hello"
→ clicked the button and 🐵 → "Hello🐵 world", still editing, Esc → typing "!" lands after the emoji;
"Lunch" selected, by touch: tap button, tone 3, "thumbs up" → "Lunch 👍🏽", one undo restores
"Lunch"; recent list updates at once; search "ピザ" (UI in Japanese) and "пицца" (Russian) find
🍕, "pizza" still works. Unit tests (logic) 7. Tutorial "Sticky notes and text": new step
"Emoji" (touch line, 5 locales), run in English: 8/8.

## 6. Right-click menu style (done)

Classification: NEW (nothing styled menus before; `ui/menu-fit.ts` only keeps long canvas menus on
screen and is unchanged). Module `menu-style` (group Interaction, on by default but changes nothing
until an option is set).

- Options: text size, space between items, item side padding, menu width (at least), corner radius,
  icon size, space after the icon, shadow (theme / none / soft / strong), colors — background, text
  and icons, item under the pointer, border and separators — separately for light and dark mode
  (one color can't suit both), "Apply to the whole vault", "Reset to default", and ↺ per option.
  Every option starts at "theme" (-1 / empty): only what the user changes is written, so themes and
  other plugins' items keep their look; warning items (Delete…) keep their color.
- Scope: `Menu.prototype.showAtPosition` is patched to mark menus opened in a canvas (the point or
  the menu's parent control is in a canvas view) with `opc-menu-styled`; the generated CSS targets
  `.menu.opc-menu-styled`, or every `.menu` with the whole-vault switch. Mobile menus (long press)
  go through the same call; on phones the width option is left out (they are bottom sheets).
- CSS (`logic.ts`, unit-tested) is written into a `<style>` of every window: main, popouts and the
  settings window (which may be a popout). The settings show a live preview: a menu built with
  Obsidian's own classes, so the same CSS styles it (one item shown "under the pointer").
  Native system menus can't be styled (said in the description).

Tested (test vault, dark theme): text 20, spacing 9, width 300, radius 14, dark background, red
hover, light background → right-click on a card: styled (rgb(16,32,48), 20 px, 9 px, 300 px, 14 px);
light mode: light background used; tab header menu: unstyled, with "Apply to the whole vault":
styled; touch long-press on a card: styled; another plugin's item (AI Tools ›) and the red
"Remove" intact; settings (popout window): preview follows each change, slider 2 px → preview 2 px,
Reset to default → all theme, preview back to theme values. Unit tests 5. Tutorial "Your own bars":
new step "Style the right-click menu" (touch line, settings restored at the end), summary updated,
5 locales; run in English 8/8.

## Follow-up (owner's feedback on items 2 and 6)

- Gear: back to the core menu (Snap to grid, Snap to objects, Read-only, Customize the bars); its
  last item is now "Overpowered Canvas settings" (added right before the menu shows, own section,
  so it comes after every other item). The click takeover and its option were removed; tutorial
  texts back to "the settings button's menu" (with touch lines). Show me passes: Your own bars 9/9,
  A canvas as a file 4/4.
- `core/menu-kinds.ts`: tells right-click menus (a `contextmenu` just before, or the canvas
  node/edge/selection menu events) from the ⋮ menu (a press on the view header's ⋮, or `file-menu`
  with source "more-options") and whether they belong to a canvas; classes `opc-menu-in-canvas`,
  `opc-menu-context`, `opc-menu-more`; listeners get the menu before it shows.
- Customize the bars: sections "Right-click menu" and "More options menu (⋮)": an "Apply to the
  whole vault" switch each, and a switch per item the menu has shown (items are known by their
  title; the list fills as menus open). Taken-off items are removed before the menu shows; stray
  separators are tidied. Restore defaults clears both.
- Menu style: its own "whole vault" switch is gone (it was never released): it styles every menu
  opened in a canvas, and right-click / ⋮ menus everywhere when their switch is on.
- Tested: gear → menu → "Overpowered Canvas settings" opens the plugin's tab; Zoom to selection and
  Edit taken off → gone from a card's right-click menu; "Split down" taken off the ⋮ menu → gone in
  a canvas, still in a note until "Apply to the whole vault" is on, then gone there too; "Paste" in a
  note's right-click menu the same, and the menu style (21 px) followed the switch. New tutorial
  step "Choose the right-click menu's items" (5 locales).

## Follow-up 2

- Gear menu: 8 px between each icon and its name (`opc-gear-menu`, better-defaults CSS; it was 0).
- Customize the bars: a row of icons at the top (bottom bar, side bar, popup, image popup,
  right-click menu, ⋮ menu) that stays in view; a press scrolls to that section, the one in view is
  marked. The dialog (not its content) is the scroller: redrawing the list after a switch now keeps
  the scroll position too.
- Column view: a button in the side bar (presentation module, `opc-columns-control`, listed in
  Customize the bars → side bar) next to the existing command; the side bar is hidden while the
  column view is open, its × closes it.
- Tutorials: Your own bars s1 and Column view s1 mention them (5 locales); run in English: 9/9, 11/11.
