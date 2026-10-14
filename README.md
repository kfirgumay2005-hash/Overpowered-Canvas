# Overpowered Canvas

An Obsidian plugin that turns the core Canvas into a full whiteboard: shapes and sticky notes,
freehand drawing with stylus support, mind maps with automatic layout, presentations, kanban
boards synced with your notes, a minimap, a frames panel, and first-class right-to-left and
Hebrew support — while every canvas stays a standard JSON Canvas file that vanilla Obsidian
opens cleanly.

Every feature is a **module** you can switch off in the settings. A disabled module leaves no
patches, listeners or styling behind.

## Features

**Cards and edges** — flowchart and basic shapes on cards, border styles, start/center/end text
alignment, auto-resize to fit text, z-order, custom colors from CSS, card templates in the
bottom bar, empty groups, per-card zoom breakpoints, stable text rendering; edge line styles and
arrowheads, routing (curved, straight, right-angle, A* around cards), floating edge ends, flip /
highlight / select connected edges, draggable bend points and labels.

**Drawing** — pen, pencil, marker and highlighter with pressure and tilt (perfect-freehand),
palm rejection, pen-only mode, the pen's eraser end, whole-stroke and partial eraser, lasso to
move / scale / delete / lock strokes, recent colors, smoothing, and shape recognition (hold at
the end of a stroke). Free lines and arrows whose ends stick to cards. Standalone shapes with
fill, outline, opacity and rotation. Sticky notes whose text shrinks to fit. Non-destructive
image crop. Lock items in place.

**Mind maps** — Tab / Enter to add children and siblings, Alt+arrows to move between cards,
collapsible branches with child counts, and automatic layout with elkjs (mind map in any
direction, radial, balanced, layered flowchart, grid) as one animated undo step.

**Vault integration** — canvases get properties, tags, aliases and outgoing links in Obsidian's
metadata cache; edges from frontmatter links; links and embeds to a single card
(`[[file.canvas#card-id]]`); search inside a canvas (Ctrl/Cmd+F); read-only options; PNG/SVG
export.

**Interaction and navigation** — presentations along edges or through frames, portals into
other canvases, collapsible groups, focus mode, move a selection to a new canvas, PDF pages as
cards for annotation, custom style attributes from CSS snippets, a public events API, a minimap,
and a frames panel to search, reorder and present the groups of a canvas.

**Data features** — board templates (your own, plus Kanban, SWOT, Retrospective, Weekly plan,
Mind map and Flowchart), kanban columns bound to a frontmatter property with two-way sync
(rules: [docs/KANBAN.md](docs/KANBAN.md)), and query groups that fill themselves with notes
matching tags, folders, properties or links.

**Right-to-left and Hebrew** — the whole UI is available in English and Hebrew. A canvas can be
right-to-left (globally or per canvas): mind maps grow to the left, templates and frames run
right to left, menus and panels mirror. Card text takes its direction per paragraph, so Hebrew
and English mix naturally; it can also be fixed per card.

**Large canvases** — below a zoom threshold, canvases with hundreds of cards switch to a
level-of-detail renderer: ~90 fps instead of ~9 fps on a 1,000-card stress canvas, with cards
still clickable ([docs/BENCHMARKS.md](docs/BENCHMARKS.md)).

## Keys inside a canvas

| Key | Action |
|---|---|
| P | Drawing mode on/off (Esc leaves it) |
| M | Minimap on/off |
| Ctrl/Cmd+F | Search the canvas |
| Tab | Mind map: add a child (on a sticky note: the next sticky) |
| Enter / Shift+Enter | Mind map: add a sibling (configurable) |
| Alt+Arrows | Move between connected cards |
| Ctrl/Cmd+Arrows | Add a card (or sticky) in that direction |
| Ctrl/Cmd+Shift+Arrows | Add a child in that direction |
| → / Space / PageDown, ← / PageUp, Esc | Presentations |

Every toolbar action is also in the command palette ("Selection: …"), so you can assign your
own hotkeys to any of them.

## Install

The plugin is not in the community catalog. To install from source:

```sh
npm install
npm run build        # type-check + bundle → main.js, styles.css
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/overpowered-canvas/`
and enable *Overpowered Canvas* under *Settings → Community plugins*. Requires Obsidian 1.14 or
newer; works on desktop and mobile.

If Advanced Canvas or Canvas MindMap is installed, the plugin offers to switch off its own
overlapping modules. Existing Advanced Canvas data in your files is left untouched.

## Data format

Everything is stored inside the canvas file under a namespaced `x-opc` key on the root, nodes
and edges ([docs/SCHEMA.md](docs/SCHEMA.md)). Shapes, stickies, lines and drawings are ordinary
`text` nodes, colors use the standard `color` field, and unknown properties are always
preserved — so files stay valid JSON Canvas 1.0 and open in vanilla Obsidian and other apps.
The schema is versioned, with tested migrations.

## Development

| Command | |
|---|---|
| `npm run dev` | Rebuild on change |
| `npm run build` | Type-check and production build |
| `npm test` | Unit tests (vitest) for all pure logic |
| `npm run stress` | Generate the 1,000-card stress canvas |

Docs: [DEV](docs/DEV.md) (architecture and module API) · [INTERNALS](docs/INTERNALS.md) (the
Obsidian canvas internals the plugin relies on) · [SCHEMA](docs/SCHEMA.md) · [EVENTS](docs/EVENTS.md)
(public events for other plugins) · [TESTING](docs/TESTING.md) (manual test steps per phase) ·
[BENCHMARKS](docs/BENCHMARKS.md) · [KANBAN](docs/KANBAN.md).

## Third-party code

Bundled, unmodified: [elkjs](https://github.com/kieler/elkjs) (EPL-2.0),
[monkey-around](https://github.com/pjeby/monkey-around) (ISC) and
[perfect-freehand](https://github.com/steveruizok/perfect-freehand) (MIT). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
