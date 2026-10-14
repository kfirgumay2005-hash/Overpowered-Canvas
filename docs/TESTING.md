# Testing

## Automated

`npm test` runs the vitest suite: i18n tables, settings sanitizing, module dependency order,
overlap detection, `x-opc` validators, file validation, migrations, history transactions (against
a fake canvas that mirrors Obsidian 1.14's behavior), benchmark statistics, and the generators.

## Manual — Phase 0

### 0.1 Plugin loads with zero footprint
1. `npm run build`, then *Settings → Community plugins* → enable **Overpowered Canvas**.
2. Open the developer console (Ctrl+Shift+I): no red errors mentioning `overpowered-canvas`.
3. In the console run:
   `app.plugins.plugins["overpowered-canvas"].patcher.list()` → `[]`
   `[...document.body.classList].filter(c => c.startsWith("opc-"))` → `[]`
4. Command palette, type "Overpowered": no commands (every module is off by default).

### 0.2 Settings tab and modules
1. *Settings → Overpowered Canvas*: a language dropdown, a **Developer** group with
   **Diagnostics**, and the "Overlap notice" row.
2. Turn **Diagnostics** on → its options appear under it; the command palette now has three
   "Overpowered Canvas: …" commands; `document.body.classList.contains("opc-mod-diagnostics")` → `true`.
3. Turn it off → the commands disappear, the class is gone, `patcher.list()` is `[]`.
4. Turn it on, change *Benchmark length* to 120, click ↺ (reset) → back to 300.
5. Restart Obsidian → the enabled state and settings are remembered.

### 0.3 Language
1. Set *Interface language* to Hebrew → the settings tab redraws in Hebrew (full RTL mirroring is Phase 8).
2. Reload the plugin → command names are in Hebrew too. Set it back to "Same as Obsidian".

### 0.4 Coexistence notice
1. With Advanced Canvas enabled there is **no** notice in Phase 0 (no module overlaps it yet).
   From Phase 1 on, enabling an overlapping module while Advanced Canvas is on shows the notice
   once on the next start.

### 0.5 Unknown-property preservation (vanilla Obsidian)
1. *Community plugins*: turn off **Advanced Canvas** and **Overpowered Canvas**, then Ctrl+R.
2. In a terminal in the plugin folder: `node scripts/roundtrip.mjs create`.
3. Open `OPC Tests/roundtrip.canvas`. Move the yellow card a little, Ctrl+Z, Ctrl+Shift+Z,
   move the shape card, wait two seconds, close the tab.
4. `node scripts/roundtrip.mjs check` → expect `PASS`: every extra property survives, and only
   `rt-custom` / `rt-e2` (non-standard node type) are dropped.

### 0.6 Internals probe
1. Same state as 0.5 (Advanced Canvas off). Open `OPC Tests/roundtrip.canvas`, click into it.
2. Console → paste `scripts/console/probe-internals.js` → Enter. The report is copied; send it
   back. Expect `problems: []`, `roundTrip.node/edge/root: true`, `historyIsShallow: true`.

### 0.7 Stress canvas and baseline benchmark
1. `npm run stress` → open `OPC Tests/stress-1000.canvas`; it opens without errors.
2. Enable **Diagnostics**, press Shift+1 (zoom to fit), run *Run pan/zoom benchmark*; don't touch
   anything until the notice appears. Paste the copied JSON into `docs/BENCHMARKS.md`.
3. Run it once with Advanced Canvas off and once with it on, for comparison.
