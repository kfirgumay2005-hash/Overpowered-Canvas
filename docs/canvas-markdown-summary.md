# Canvas ⇄ Markdown — summary

Built for GitHub issue #1: the same content as a board and as a normal note, so it can be edited
as text (by hand or by an assistant inside the vault) and turned back into the board. Module id
`canvas-markdown` (settings group "Data features", on by default). Source:
`src/modules/canvas-markdown/`. Design choices: [decisions.md](decisions.md).

## What was built

| Phase | Feature | How to use it |
|---|---|---|
| 1 | Copy as Markdown outline | Select a card (its whole subtree is copied), several cards, or nothing (whole canvas) → command **Copy as Markdown outline**, or the selection / card context menu. Root → `#` heading, children → nested `-` bullets; text verbatim. |
| 2 | Outline → mind map | **Paste** nested bullets/headings onto the board (not into a card); command **Paste Markdown outline as mind map**; **Insert note as mind map…**; right-click a note card → **Convert note to mind map here**; in a note: **Create or update canvas from this note** (also in the file menu). Laid out by the plugin's own layout (setting *Layout of new mind maps*). |
| 3 | Whole canvas ⇄ note | In a canvas: **Export canvas to Markdown note**, **Update canvas from its Markdown note**. Anywhere: **Switch between canvas and Markdown note** (one command, both directions, same tab). |

Settings: outline indentation (tab / 4 / 2 spaces), layout of new mind maps (forward, backward,
down, up, balanced, radial), paste outlines as mind maps (on/off).

## The note format

````markdown
# Section A %%g:grp0%%
- a free card inside the group %%n:loos%%
## ADPKD %%n:root%%
- Gen %%n:kid1%%
	second line of the same card

	\- a line that starts with a dash, escaped
	- Epidemiologia %%n:kid3%%
- [[Nefro.pdf#page=4|p.4]] Terapia ^mark-1 %%n:kid2%%

# Free cards %%free%%
- an unconnected card %%n:fre1%%

%%
## canvas-data
```json
{
	"version": 1,
	"canvas": "Maps/ADPKD.canvas",
	"root": {"x-opc":{"v":1,"dir":"rtl"}},
	"maps": {
		"root": {"layout":"right"}
	},
	"nodes": {
		"root": {"id":"root0001…","type":"text","x":0,"y":200,"width":250,"height":60,"color":"4"},
		…
	},
	"edges": { "kid1": {…edge to its outline parent…} },
	"crossEdges": [ …edges outside the outline… ],
	"drawings": [ …ink, free lines, infinite lines… ],
	"order": [ …node ids in drawing order… ]
}
```
%%
````

- Each map is a section headed by its root; groups are headings around their maps; free cards
  are bullets (under their group heading, or under `Free cards`).
- `%%…%%` comments are hidden in reading view. Lines without an id are new cards.
- `maps.<id>.layout` can be edited: `free` (hand-arranged) or an auto layout
  (`right`, `left`, `down`, `up`, `balanced`, `radial`, `layered-right|left|down|up`, `grid`).

## What an update does

| In the note | On the canvas |
|---|---|
| Line with a known id | Card keeps position, size, color, shape, layer…; text updated if it changed (whitespace-only differences ignored) |
| Line without an id | New card, linked to its parent, placed beside it (after existing children); in a group section, inside the group |
| Id gone from the note | Card deleted (with its edges) |
| Line moved under another parent | Old link removed, new link created |
| Map with an auto layout whose structure changed | Whole map re-arranged with that layout, root stays in place |
| Group heading renamed / removed | Group renamed / group deleted (its cards stay) |
| Data section missing or broken | Canvas built from the outline alone with automatic layout, with a notice |
| Cards added on the canvas after the export, drawings | Untouched |

An update of an open canvas is one undo step. Updating a closed canvas opens it first.

## Verification

- `npm test`: 47 tests for the converters (in 340 total): parser/writer cases (multi-line text,
  escaping, fences, RTL text, ids, groups, paragraphs, front matter), the ADPKD note from the
  issue (`test-fixtures/adpkd-outline.md`, 158 items, 9 levels) — **outline → canvas → outline
  is identical** for forward, backward, down, up, balanced and right-to-left; text and nesting
  identical for layered and radial — and round trips of a board with groups, file/link cards,
  stickies, styled edges, labels, a cycle, ink and foreign root data: export → import with no edits
  rebuilds the canvas exactly (from the canvas or from the data block alone); edits (new, deleted,
  moved, changed lines, duplicated ids, group rename/delete) behave as in the table above.
- Live test in Obsidian 1.14.5 (copy of the vault's plugins and plugin settings, right-to-left
  canvases): note → canvas → note identical; assistant-style edits applied back with the map
  growing the right way and one undo step; four real canvases from the vault (Hebrew text,
  groups, ink, free lines, file cards) exported and imported back byte-identical; copy, paste
  interception (a plain sentence still pastes as one card), insert-note picker, note-card menu.

## Known limitations

- In hand-arranged maps the spatial arrangement carries meaning the outline can't show; it is
  kept only through the data section. New cards in such maps go after their siblings, wherever
  the line was inserted.
- Radial, layered and grid layouts may reorder siblings; re-exporting such a map can list
  siblings in a different order (text and nesting are kept).
- Edge labels, cross-links and drawings live only in the data section (not editable as text).
- Groups can't be created from the note; moving a map's section under another group heading
  doesn't move the map into that group.
- Card text: leading/trailing blank lines and trailing spaces can't be carried by Markdown
  (the canvas keeps its own text when only those differ). A card whose code fence never closes
  is written with escaped fence lines.
- Headings deeper than level 6 (groups nested more than five deep) are capped.
- The note links to its canvas by path; after renaming the canvas, export again.
- Empty cards are skipped when a note is inserted as a *new* map.
- The section-based outline format of other outliner plugins (`<!--section: 1.2-->`) is not read;
  convert those notes to a bullet outline first.
