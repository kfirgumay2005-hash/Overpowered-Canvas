# Overpowered Canvas

An Obsidian plugin that turns the core Canvas into a full whiteboard: shapes and sticky notes,
freehand drawing with stylus support, mind maps with automatic layout, presentations, kanban
boards synced with your notes, a minimap, a frames panel, a background grid, hands-on tutorials, and
first-class right-to-left support — while every canvas stays a standard JSON Canvas file that
vanilla Obsidian opens cleanly.

Every feature is a **module** you can switch off in the settings. A disabled module leaves no
patches, listeners or styling behind.

Includes all the features from both advanced canvas and canvas mindmap plugins , and far more , built by the goat claude code this is the perfected form of ultra instinct.

## Features

**Cards and edges** — flowchart and basic shapes on cards, border styles, start/center/end and
top/middle/bottom text alignment (new cards can be centered automatically), cards that fit
their text up to a maximum width (new cards do by default) or grow downwards or sideways as you
type, layers like in image editors (a Layers panel to create,
rename, reorder, hide, lock and delete them; new items go to the active layer; move the
selection to a layer or one layer up or down), custom colors from CSS, card templates in the bottom bar, empty groups, card
content at any zoom level (always, below your own zoom, or per card), text that doesn't jump between reading and editing; edge line styles and
arrowheads, routing (curved, straight, right-angle, A\* around cards), floating edge ends, flip /
highlight / select connected edges, draggable bend points and labels.

**Drawing** — pen, pencil, marker and highlighter with pressure and tilt (perfect-freehand),
palm rejection, pen-only mode, the pen's eraser end, whole-stroke and partial eraser, lasso to
move / scale / delete / lock strokes, recent colors, smoothing, and shape recognition (hold at
the end of a stroke). Marks drawn on a card stick to it: they move, copy and delete with the card.
Highlight words inside a card without editing it (swipe or tap with a pen or the mouse; the
highlight goes into the card's text). Free lines and arrows whose ends stick to cards and that
keep the corners you draw; bend points keep the route's shape when cards move (square routes stay
square), drawn above the cards (or under them). Standalone shapes with
fill, outline, opacity and rotation. Sticky notes in any color (the last 10 custom colors are
kept) whose text shrinks to fit. Floating text without a card around it. Infinite
lines at any angle (turn them live with a slider from the selection toolbar) with their own
color and thickness. Non-destructive image crop.
Lock items in place.

**Mind maps** — Tab / Enter to add children and siblings (a sibling goes right after its card),
drag a card onto another card's "Add as child" / "Add as sibling" targets to move it with its
branch (the view follows dropped note blocks to the middle of the screen), Alt+arrows to move
between cards, walk through a map with the arrow keys at your zoom (or with on-screen arrows on
touch screens) without making slides,
collapsible branches with child counts, and automatic layout (mind map in any direction,
collision-free radial that respects every card's size, balanced, layered flowchart, grid) as one
animated undo step; groups move as rigid blocks and edges re-attach to the facing sides.

**Vault integration** — canvases get properties, tags, aliases and outgoing links in Obsidian's
metadata cache; edges from frontmatter links; links and embeds to a single card
(`[[file.canvas#card-id]]`); search inside a canvas (Ctrl/Cmd+F); read-only options; PNG/SVG
export.

**Interaction and navigation** — a lasso that selects anything on the canvas (cards, groups,
edges, ink strokes) and stays on: press inside the selection to move it, and once a pen has
been used, fingers move and zoom the board; on touch screens a selection moves right away,
without a long press; cut in one undo step and paste under the pointer, with Cut / Copy / Paste
buttons on tablets; coloring several cards colors the edges between them; presentations along edges or through frames
(click a slide's name to hide or show its frame), portals into
other canvases, collapsible groups, focus mode, move a selection to a new canvas, PDF pages as
cards for annotation, custom style attributes from CSS snippets, a public events API, a minimap,
a frames panel to search, reorder and present the groups of a canvas, a line grid behind the
content (a line every N dots), an adjustable selection toolbar size (separately for computers
and phones), and thirteen hands-on tutorials (at the top of the settings and in the canvas
controls). Each tutorial opens a temporary practice board with a coach panel: small tasks that
tick themselves off as you do them, a "Show me" button that does each task live on the board, and
highlights on the controls involved. The board is deleted when the tutorial closes. The settings page has its own search box and collapsible sections, a plain-language
explanation under every setting, and every module and option also shows up in Obsidian's
settings search. A double-click on the empty canvas creates a card at a speed you choose
(fast, regular, slow or your own); dragging never creates one.

**Data features** — board templates (your own, plus Kanban, SWOT, Retrospective, Weekly plan,
Mind map and Flowchart), kanban columns bound to a frontmatter property with two-way sync
(rules: [docs/KANBAN.md](docs/KANBAN.md)), and query groups that fill themselves with notes
matching tags, folders, properties or links. Drag a block from a note onto a canvas (hold a line,
or grab its handle): a bullet with its children, a heading with its section or a paragraph
becomes a card under the pointer, or a linked child or sibling of the card you drop it on;
inbox mode sends clicked blocks into a named group. The handle shows while a canvas is open
beside the note, and can be an emoji or an image of your own, cropped to a circle or a square.

**Canvas ⇄ Markdown** — copy a mind map (or any connected cards) as a Markdown outline; paste an
outline onto the board, insert a note, or convert a note card to get a laid-out mind map; and
switch a whole canvas to a normal Markdown note and back with one command. The note is a readable
outline (one section per map, groups as headings, links and block references untouched) and
nothing else: positions, styles, edges and drawings are kept in a separate data file (or, if you
prefer, in a hidden section of the note). Edit the note by hand or with an
assistant, switch back, and cards keep their place and look while new lines become new cards
([docs/canvas-markdown-summary.md](docs/canvas-markdown-summary.md)).

**Languages and right-to-left** — the UI is available in English, Chinese (Mandarin), Japanese
and Hindi. A canvas can be right-to-left (globally or per canvas): mind maps grow to the left,
templates and frames run right to left, menus and panels mirror — or, in "text only" mode, only
the text turns right-to-left and the canvas UI stays as it is. Card text takes its direction per
paragraph (also while typing), so right-to-left and left-to-right text mix naturally; it can also be fixed per
card.

**Large canvases** — below a zoom threshold, canvases with hundreds of cards switch to a
level-of-detail renderer: ~90 fps instead of ~9 fps on a 1,000-card stress canvas, with cards
still clickable ([docs/BENCHMARKS.md](docs/BENCHMARKS.md)).

## Keys inside a canvas

| Key                                   | Action                                                    |
| ------------------------------------- | --------------------------------------------------------- |
| P                                     | Drawing mode on/off (Esc leaves it)                       |
| L                                     | Lasso on/off (Esc leaves it)                              |
| H                                     | Highlight words in cards on/off (Esc leaves it)           |
| M                                     | Minimap on/off                                            |
| Ctrl/Cmd+F                            | Search the canvas                                         |
| Tab                                   | Mind map: add a child (on a sticky note: the next sticky) |
| Enter / Shift+Enter                   | Mind map: add a sibling (configurable)                    |
| Alt+Arrows                            | Move between connected cards                              |
| Ctrl/Cmd+Arrows                       | Add a card (or sticky) in that direction                  |
| Ctrl/Cmd+Shift+Arrows                 | Add a child in that direction                             |
| → / Space / PageDown, ← / PageUp, Esc | Presentations                                             |
| Arrows, + / −, Home, Esc              | Walking through a map: child, parent, siblings; zoom      |

Every toolbar action is also in the command palette ("Selection: …"), so you can assign your
own hotkeys to any of them.

## Install

The plugin is not in the community catalog. Download `main.js`, `manifest.json` and
`styles.css` from the [latest release](https://github.com/kfirgumay2005-hash/Overpowered-Canvas/releases/latest)
(or install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat)). To build from source:

```sh
npm install
npm run build        # type-check + bundle → main.js, styles.css
```

Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/overpoweredcanvas/`
and enable _Overpowered Canvas_ under _Settings → Community plugins_. Requires Obsidian 1.14 or
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

| Command          |                                        |
| ---------------- | -------------------------------------- |
| `npm run dev`    | Rebuild on change                      |
| `npm run build`  | Type-check and production build        |
| `npm test`       | Unit tests (vitest) for all pure logic |
| `npm run stress` | Generate the 1,000-card stress canvas  |

Docs: [DEV](docs/DEV.md) (architecture and module API) · [INTERNALS](docs/INTERNALS.md) (the
Obsidian canvas internals the plugin relies on) · [SCHEMA](docs/SCHEMA.md) · [EVENTS](docs/EVENTS.md)
(public events for other plugins) · [TESTING](docs/TESTING.md) (manual test steps per phase) ·
[BENCHMARKS](docs/BENCHMARKS.md) · [KANBAN](docs/KANBAN.md).

## Third-party code

Bundled, unmodified: [elkjs](https://github.com/kieler/elkjs) (EPL-2.0),
[monkey-around](https://github.com/pjeby/monkey-around) (ISC) and
[perfect-freehand](https://github.com/steveruizok/perfect-freehand) (MIT). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
