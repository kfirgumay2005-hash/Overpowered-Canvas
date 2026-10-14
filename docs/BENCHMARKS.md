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
