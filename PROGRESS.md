# Feedback round 12: progress

Branch `feature/feedback-round-12` (from `main` at 0.18.2). One commit per item.
When resuming: read this file and `git log`, then continue with the first item that is not done.
(Round 11's notes are in git history: `git show 22f6de7:PROGRESS.md`.)

| # | Item | Class | Status |
|---|------|-------|--------|
| 1 | Pages bar overlaps the color palettes | IMPROVEMENT (bug) | done |
| 2 | Gear in the side controls opens the plugin's settings | IMPROVEMENT | done |
| 3 | Emoji picker in the bottom toolbar | NEW | todo |
| 4 | Cropped images become invisible | IMPROVEMENT (bug) | todo |
| 5 | Shortcuts window (replaces the shortcut settings) | NEW (replaces settings) | todo |
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
