# Development

The source lives directly in the plugin folder of the main vault:
`<vault>/.obsidian/plugins/Overpowered-Canvas` (plugin id `overpowered-canvas`).

> **LiveSync:** hidden-file sync already ignores `node_modules/` and `.git/`. The source
> (`src/`, `docs/`, `scripts/`) is small and will sync to other devices; that is harmless.
> To skip it as well, add `\/Overpowered-Canvas\/(src|docs|scripts)\/` to
> *Self-hosted LiveSync → Hidden file sync → Ignore patterns*.
> The `OPC Tests/` folder created by the test scripts is a normal vault folder and syncs too —
> delete it when you're done testing.

## Setup

```bash
npm install
npm run build        # typecheck + production build → main.js, styles.css, scripts/console/probe-internals.js
```

Then enable **Overpowered Canvas** in *Settings → Community plugins*.

## Everyday loop

```bash
npm run dev          # esbuild watch: rebuilds main.js / styles.css on every save (inline source maps)
npm test             # vitest: unit tests for all pure logic
npm run typecheck
```

### Reloading the plugin in Obsidian

`npm run dev` rewrites `main.js` in place, but Obsidian only runs the new code after a reload.

- **Manual:** Command palette → *Reload app without saving* (Ctrl+R in the dev tools window),
  or toggle the plugin off/on in *Community plugins*.
- **Automatic (optional):** the community *Hot Reload* plugin (by pjeby) reloads a plugin whenever
  its `main.js` or `styles.css` changes, for plugin folders that contain a `.git` folder (this one
  does). It is a dev tool for your vault, not a dependency of this project; install it only if
  you want it.

## Tools

| Command | What it does |
|---|---|
| `npm run stress` | Writes `OPC Tests/stress-1000.canvas`: 1,000 cards, 2,000 ink strokes, ~1,500 edges, 20 groups. Options: `-- --nodes 3000 --strokes 5000 --edges 4000 --groups 40 --seed 7 --out <file>`. |
| `node scripts/roundtrip.mjs create` / `check` | Unknown-property preservation test — see TESTING.md, Phase 0. |
| `scripts/console/probe-internals.js` | Paste into the developer console with a canvas open; prints and copies a report of the canvas internals. See INTERNALS.md. |
| *Diagnostics* module (Settings → Developer) | Commands: copy internals report, copy list of active patches, run pan/zoom benchmark. |

## Benchmarks

Before and after each phase: open `OPC Tests/stress-1000.canvas`, zoom to fit, run
*Overpowered Canvas: Run pan/zoom benchmark*, and record the copied JSON in `docs/BENCHMARKS.md`.
Run it with the same window size each time and with no other canvas plugins enabled.

## Architecture in one screen

- `src/main.ts` — boots the core, registers modules, settings tab, coexistence check.
- `src/core/` — module system (`module.ts`, `module-manager.ts`), patcher (monkey-around),
  canvas tracker, history transactions, public events, coexistence.
- `src/internals/` — the only place that knows Obsidian's undocumented canvas shapes.
- `src/data/` — `x-opc` schema, validators, migrations, typed access (see SCHEMA.md).
- `src/i18n/` — `t()` and the en/he string tables (a missing Hebrew key is a compile error).
- `src/settings/` — settings model (pure) and the settings tab.
- `src/modules/<id>/` — one folder per feature: `index.ts` (definition), `patches.ts` (all of
  its patches), `styles.css` (scoped under `body.opc-mod-<id>`), tests.

A module registers everything through its `ctx`, which undoes it all on disable — patches,
listeners, commands, status-bar items and the body class. `Diagnostics → Copy list of active
patches` shows what is installed right now.

## Commits

One commit per completed feature, English messages, imperative mood.

## Runtime harness (how the plugin was verified without touching your vault)

An isolated Obsidian instance can be started with its own user-data folder and a throw-away
vault, then driven over the Chrome DevTools protocol:

```bash
"%LOCALAPPDATA%/Programs/Obsidian/Obsidian.exe" --user-data-dir=<empty dir> --remote-debugging-port=9333
```

Put `obsidian.json` (`{"vaults":{"<16 hex id>":{"path":"<test vault>","ts":0,"open":true}},"updateDisabled":true}`)
and a copy of `obsidian-<version>.asar` in the user-data folder first. Copy `main.js`,
`manifest.json` and `styles.css` into the test vault's plugin folder, then evaluate code in the
page (`Runtime.evaluate`) or take screenshots (`Page.captureScreenshot`). Reload the plugin with
`app.plugins.disablePlugin(id)` / `enablePlugin(id)`.
