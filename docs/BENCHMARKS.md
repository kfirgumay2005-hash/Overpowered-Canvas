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

**Reading:** with everything zoomed out, vanilla Obsidian keeps all 1,120 cards as DOM nodes and
reaches ~9 fps; our modules add no measurable cost. Reaching 60 fps at this size needs a
level-of-detail renderer for zoomed-out views (planned for the performance pass, Phase 8).
