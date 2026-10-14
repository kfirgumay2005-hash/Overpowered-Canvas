# Benchmarks

Pan/zoom benchmark on `OPC Tests/stress-1000.canvas` (1,000 cards, 2,000 strokes, ~1,500 edges,
20 groups), started from *zoom to fit*, 300 frames. Target: ≥ 60 fps average on a mid-range laptop.
Strokes are not rendered until Phase 5, so earlier numbers measure cards and edges only.

| Date | Phase | Obsidian | Machine | Other canvas plugins | avg fps | p95 ms | slow frames |
|---|---|---|---|---|---|---|---|
| | Phase 0 baseline | 1.14.4 | | none | | | |
