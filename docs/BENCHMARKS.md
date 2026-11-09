# Benchmarks

Pan/zoom benchmark on `OPC Tests/stress-1000.canvas` (1,000 cards, 2,000 strokes in 100 ink
carriers, ~1,500 edges, 20 groups = 1,120 nodes), started from *zoom to fit*, 300 frames of a
fixed pan + zoom path. Target: ≥ 60 fps average on a mid-range laptop.

Measured in an isolated Obsidian 1.14.4 instance (Windows 11, RTX 4070 Ti SUPER, 144 Hz,
window focused and visible) driven through the DevTools protocol (`scripts/` + diagnostics
benchmark logic). "slow" = frames slower than 18.3 ms.

| Date | Phase | Configuration | avg fps | p95 ms | slow frames |
|---|---|---|---|---|---|
| 2026-10-14 | Phase 1 | all modules off (vanilla canvas) | 8.9 | 215 | 298 / 300 |
| 2026-10-14 | Phase 1 | Phase 1 modules on | 8.8 | 201 | 298 / 300 |
| 2026-10-14 | Phase 8 | all modules off (vanilla canvas) | 8.6 | 222 | 297 / 300 |
| 2026-10-14 | Phase 8 | **all modules on (level-of-detail renderer)** | **92.8** | **20.9** | 34 / 300 |
| 2026-10-14 | Phase 8 | all modules on, *Fast rendering* module off | 7.2 | 250 | 298 / 300 |

**Reading:** zoomed out, vanilla Obsidian keeps every card as a DOM element and reaches ~9 fps.
The *Fast rendering for large canvases* module (Phase 8) takes over below zoom −1.7 on canvases
with 300+ cards and reaches ~90 fps (60+ fps target met), with the cards still clickable.

What it took (each step measured with the CPU profiler over the same path):

| Step | avg fps |
|---|---|
| All modules on, no LOD | 7.5 |
| LOD bitmap, cards `opacity: 0` (still styled and laid out every frame) | 5.3 |
| + `content-visibility: hidden` on card contents, edges/labels `display: none` | 24 |
| + theme colors and canvas size cached (no `getComputedStyle`/`clientWidth` per frame) | 26.7 |
| + whole scene cached as one bitmap, redrawn sharp 150 ms after the view settles | 28.6 |
| + `ctx.font` set only when it changes (setting it forces a style pass) | 29.5 |
| + core `virtualize()` deferred while the view moves | 27.7 (p95 better) |
| + cards `display: none` while the view moves, back (clickable) when it settles | **110** |

Without LOD our modules cost ~15 % on this extreme canvas (7.2 vs 8.6 fps), mostly per-card
elements (branch toggles, now left out of the layout when zoomed out) and styles.

## Handwriting at scale (feedback round 13, 2026-11-09)

Board: 12 "lecture pages", 3,024 handwritten words, each its own drawing as the pen makes them
(3,036 cards, 2.9 MB). Zoom path: 240 frames, zoom −1.2 … 0.4 around a page with a small pan
(pinch-like: the view changes every frame). Harness Obsidian 1.12.7 / Electron 39, window
visible. Builds alternated (old, new, old, new) on the same board.

| Measure | before (0.19.1) | after | |
|---|---|---|---|
| Zoom, avg fps | 15.8 / 15.3 | 51.7 / 53.2 | ×3.4 |
| Zoom, p95 frame | 140 ms | 18–35 ms | |
| Pan (180 frames), avg fps | 33.5 | 57.2 | |
| Wheel zoom (core animation), avg fps | 49.3 | 57.3 | |
| Pen-up (commit one stroke) | 38 ms | 5 ms | ×7.6 |

Where the time went (CPU profile + timeline trace), and the fixes:

| Cause | Share before | Fix |
|---|---|---|
| The core writes `--zoom-multiplier` on the wrapper after every completed viewport change — every frame with pinch-zoom. An inherited custom property: every element of every attached card is restyled. | 84 % of main-thread time (`Document::recalcStyle`) | performance module: writes in a stream wait until the view settles (150 ms); a single change applies at once |
| Each drawing card mounted a Markdown view for its empty text: re-mounted when zoom crosses the content breakpoint, `onRender` reading `offsetParent` | ~9 s of forced layout per run | drawing module: a drawing's content stays unmounted (`updateBreakpoint(false)`), its placeholder is `display: none` |
| `preDetach()` saves scroll/focus of a card's content before detaching it: one forced layout per card leaving the view | ~8 s | skipped for drawings (nothing to save) |
| Undo-step check stringified the whole board twice per stroke | 28 ms per stroke | structural comparison (`sameSnapshot`, reference-equal values first) |
| Every read of a card's data re-validated all its stroke points | 5 ms per stroke | validated reads cached per stored object (stored data is replaced, never changed in place) |
| The live stroke layer read the wrapper's size (forced layout) on each press/move | 9 ms per stroke | the core's cached view size |

Pen samples closer than half a screen pixel to the last kept point now replace it (the live preview
and the stored stroke use the same points), so slow writing stores fewer points.
