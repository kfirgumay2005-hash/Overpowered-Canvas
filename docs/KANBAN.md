# Kanban sync — rules

A group becomes a kanban column when it is bound to a frontmatter property value
(right-click the group → *Kanban: bind to property…*), for example `status: doing`. The binding
is stored in the group's `x-opc.kanban` (`{ "key": "status", "value": "doing" }`).

Only **note cards** (file nodes of `.md` files) take part. A card belongs to the innermost bound
group that contains its center.

## Canvas → note

- Dropping a note card into a column sets the column's property on the note
  (`processFrontMatter`), right after the drag ends.
- Dropping a card outside every column leaves the note unchanged.
- Undo/redo in the canvas counts as a canvas action: cards that the undo moved into another
  column update their notes. Cards the undo did not move are not written.
- Binding (or re-binding) a column writes its value to the notes already inside it.

## Note → canvas

- When the canvas opens, on the command *Sync kanban from notes*, and — with *Sync while the
  canvas is open* (default on) — whenever a note changes, each card that sits in a column is
  checked: if the note's property now names another column **of the same property**, the card
  moves there (placed in the first free grid slot; the column grows if it is full).
- Cards outside every column are never moved, so notes elsewhere on the canvas stay put.
- A value that matches no column, or a missing property, leaves the card where it is.

## Conflicts

- **Last action wins.** A drop writes the note immediately; a later edit of the note moves the
  card back on the next sync. There is no merge.
- **Two columns with the same key and value:** the first in reading order (top to bottom,
  then start to end — mirrored in RTL) wins.
- **List properties** (`status: [doing, blocked]`) match any column whose value is in the list;
  the card stays if its current column is one of them.
- **Comparison** is case-insensitive and trims spaces; numbers and booleans compare as text.
- **Several boards for different properties** (e.g. `status` and `priority`) don't affect each
  other: a card only moves between columns of the property of the column it is in.
- A read-only canvas is never changed by a sync.
