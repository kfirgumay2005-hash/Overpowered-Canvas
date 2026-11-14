# CLAUDE.md

Notes for working on Overpowered-Canvas (Obsidian plugin, id `overpoweredcanvas`; data key
`x-opc`, CSS prefix `opc-`, events `overpowered-canvas:*`).

## Writing rules (user-facing text)

- **Never mention a specific language by name** (e.g. "Hebrew") in user-facing text. Say
  "right-to-left text" / "RTL languages" instead.
- Apply this rule to every locale (`src/i18n/locales/*.ts` and
  `src/i18n/locales/tutorials/*.ts`), not just English. A string change in `en.ts` must be
  mirrored in `hi.ts`, `ja.ts`, `ru.ts` and `zh.ts`.

## Feature requests

- Before implementing any feature request, search the codebase and classify it as ALREADY
  EXISTS / IMPROVEMENT / NEW. Never create duplicate or overlapping features, commands or
  settings. Extend existing features instead of building parallel ones, and report the
  classification.
- Every new user-facing feature must ship with an interactive tutorial, and every change to an
  existing feature must update the relevant existing tutorial(s). Before finishing any task,
  verify that the tutorials cover all features touched in that task, with touch-friendly
  alternatives for keyboard shortcuts.
- Every new user-facing feature, and every change to what an existing one can do, must also
  update `README.md` (the Features section and the keys table below "You don't have to read…").
  Never edit the part of the README above that line.
- Testing tutorials: run the created or changed tutorials ("Show me") in **English only**. Still
  write and update every tutorial text in all locales, but do not run them in the other languages;
  the owner trusts they behave the same. Run a tutorial in another language only when that
  language itself is new or its locale is what changed. Never run all tutorials as a sweep.

## Code and commits

- Code, comments, commit messages and docs are in English.
- All UI strings go through the i18n layer; no hard-coded user-facing text.
- Features live in `src/modules/<feature>/`; see `docs/INTERNALS.md`, `docs/SCHEMA.md`,
  `docs/EVENTS.md` for architecture, data schema and events.
- Mobile-safe APIs only (`app.vault`, `app.fileManager`…), never Node `fs`/`path`: users run
  the plugin on iPad.
- Conversions and edits never rewrite card text beyond what they are for. Links (PDF++ page
  links, block refs, embeds) must survive untouched. See `docs/canvas-markdown-summary.md` for
  the Canvas ⇄ Markdown format.

## Commands

- `npm run build` — typecheck + production bundle (`main.js`)
- `npm run dev` — watch build
- `npm test` — vitest
- `npm run typecheck`

## Releases

- Standing approval from the owner: when asked to push or release a version, merge the PR into
  `main` (no review needed), bump the version, push and create the GitHub release without
  asking for confirmation.

## Lessons learned (bugs that cost real time)

### Module code
- **Registration runs callbacks at once.** `ctx.onCanvas`, `ctx.decorateNodes` (and the tracker
  behind them) call the callback synchronously for canvases and cards that are already open, still
  inside `enable()`. Everything the callback reaches, directly or through helpers, must be declared
  *above* the registration, or startup with a canvas open throws "Cannot access 'x' before
  initialization" (minified names). Register these at the end of `enable()` or after the helpers.
- **Never size from what the DOM shows when the size changes the measurement.** Shape insets
  depend on the card size (a parallelogram's slant), so "new size = size + shortfall / current
  share" swung back and forth every frame: the card trembled and its floating menu could not be
  clicked. Solve the size from the geometry (`sizeForTextRoom`). After any auto-size change,
  check that an idle card gets **0** resize calls per second.
- **A menu that opens but ignores clicks, or a card that trembles, points to a resize or render
  loop.** It does not mean the hit-testing is wrong.
- **State of new cards must be right from the first moment.** The core creates, moves and
  selects cards in the same tick: it calls `moveAndResize` before `addNode`, and a lasso makes an
  ink card and selects it at once. Interceptors and "which page is this on" must handle a card
  that is not fully added yet.
- **One code path per behavior.** Dropping into a map and Auto layout once re-arranged in two
  different ways (only one kept groups whole). Share the logic instead of adding a parallel path.
- **Event order in the core:** a click reaches a link before the card that holds it. Follow
  links after the click is over. Obsidian menus scroll on every mouse move, and a tap fires one,
  so with touch or pen a menu must stay still. Cap long menus to the visible area.
- **z-index:** cards on real maps go past 300, and higher in upper layers. Overlays (live
  stroke, bars) must sit above every card.
- **Text mapping:** to map rendered text back to Markdown, skip what is not shown (tags, link
  targets, comments) and never match greedily. Refuse an edit that would change more than the
  intended marks.
- **Settings sanitizing can eat user data.** Removing repeated values dropped a second highlight
  color the user had just added.
- **Navigation keeps the user's zoom** when the view is already in use. Only move to the target.

### Tablets and touch
- A pen or finger release may never arrive. A new press must drop or finish a gesture that lost
  its release, and tools must be exclusive (starting one ends the other), or a tool stays stuck.
- Every key-only action needs a touch path (card menu item, command, on-screen button), and
  tutorials show a "No keyboard?" line.
- Remote bugs: ask for the Diagnostics → *Debug log* note instead of guessing.

### Verifying in the test instance (see docs/DEV.md, checklist in docs/TESTING.md)
- Verify bugs on a copy of the real vault, canvases, settings and other installed plugins before
  calling them fixed. Unit tests alone are not enough.
- Use a copy of the real vault: the real canvases (the large right-to-left map), `data.json`, and
  the enabled community plugins **minus `obsidian-livesync`**, so the copy never syncs. A fresh
  user-data dir starts in restricted mode: run `app.plugins.setEnable(true)` once.
- **First reproduce with the old bundle,** then confirm the fix with the new one in the same
  script. Building the old bundle from `git checkout` of the touched files is fine; restore them
  afterwards.
- Recreate the user's exact steps. A card made with "Add card" and then given a shape starts in
  a different size mode than a shape from the bottom bar, and only the first one had the bug.
- CDP gotchas: call `Runtime.discardConsoleEntries` before `Page.reload`, or old errors replay.
  Set a large viewport with `Emulation.setDeviceMetricsOverride` (in a small window the card menu
  is off-screen and clicks can hit the window's close button). After a double-click to edit,
  click inside the card so the editor iframe has focus before `Input.insertText`. Use real
  `Input.dispatchMouseEvent` clicks, not `element.click()`.
- Console noise from other plugins (for example CSP font errors from Excalidraw loading fonts
  from unpkg) is not ours. Say so instead of "fixing" it.

### Reporting to testers
- For each round: a table of report → cause found → change, a short changelog in the tester's
  terms, and a numbered "what to check on the device" list for what could not be tested here
  (real iPad, Apple Pencil). Say what was verified and on what (copy of the real map, real
  settings, emulated pen or touch).
