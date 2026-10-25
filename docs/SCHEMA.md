# The `x-opc` data schema

Canvas files stay **JSON Canvas 1.0**. Everything this plugin adds lives in one namespaced
property, `"x-opc"`, on nodes, edges and the file root. Types: `src/data/schema.ts`.
Validation: `src/data/validate.ts`. Current version: **1**.

## Rules

1. **Standard node types only.** Sticky notes, shapes, free lines and ink are stored as `text`
   (or `group`) nodes with `x-opc.kind`. Vanilla Obsidian drops nodes of unknown types on save
   (see INTERNALS.md → `importData`), so a custom type would lose data.
2. **Only non-default values are stored.** Defaults are listed in `NODE_DEFAULTS` /
   `EDGE_DEFAULTS`; writing a default removes the field, and an empty `x-opc` removes the key.
3. **Immutable writes.** Never mutate an `x-opc` object in place — undo snapshots share it.
   All writes go through `ctx.data.node(n).set(patch)` / `.edge(e)` / `.root(canvas)`.
4. **Validated both ways.** Reads drop invalid fields (modules only see clean data). Writes
   throw on invalid values, which rolls back the whole transaction.
5. **Unknown fields are kept.** A field this version doesn't know (written by a newer version)
   is never removed by a write.
6. **Graceful fallback in vanilla Obsidian.** Where a standard field can approximate our data,
   we write it too — e.g. a custom arrow style also sets `fromEnd`/`toEnd` to `arrow`/`none`.
   Text alignment is logical (`start`/`center`/`end`) so it stays correct in RTL.
7. **Mind-map structure is not stored**; parent/child is derived from edge direction.

## Versioning and migrations

- The root carries `"x-opc": { "v": <n> }` once any root data exists. A file with no root
  object is treated as the current version.
- A migration upgrades a whole file from `v` to `v + 1` (`src/data/migrations/`), is pure,
  and has unit tests. Files are migrated in memory on load and written back on the next save.
- A file from a **newer** version is read but never written: every write is refused and the
  user gets a notice (data safety).

## Types (version 1)

```ts
interface OpcRoot {                       // file root "x-opc"
  v: 1;
  frontmatter?: Record<string, unknown>;  // canvas properties (tags, aliases, cssclasses, …)
  dir?: "ltr" | "rtl" | "auto";           // overrides the global direction
  presentation?: { start?: string; last?: string };
  frameOrder?: string[];                  // group ids, Frames panel order
  layers?: { id: string; name: string; hidden?: boolean; locked?: boolean }[];  // bottom to top
  activeLayer?: string;                   // layer id that new items go to
}

interface OpcNode {
  kind?: "sticky" | "shape" | "line" | "ink" | "text" | "guide";  // absent = ordinary node
  shape?: FlowchartShape | StandaloneShape;
  border?: "solid" | "dotted" | "dashed" | "none";
  align?: "start" | "center" | "end";
  valign?: "top" | "middle" | "bottom";   // absent = top (stickies: middle)
  dir?: "ltr" | "rtl" | "auto";
  autoResize?: boolean;                   // grow in height with the text
  autoWidth?: boolean;                    // grow in width (no wrapping) and height
  locked?: boolean; breakpoint?: number; collapsed?: boolean;
  styles?: Record<string, string>;        // custom style attributes → data-* attributes
  fill?: string; stroke?: string; strokeWidth?: number; opacity?: number; rotation?: number;
  line?: { points: [number, number][]; from?: Attach; to?: Attach; startArrow?: ArrowStyle; endArrow?: ArrowStyle };
  sticky?: { author?: string; created?: number; footer?: boolean };
  crop?: { x: number; y: number; w: number; h: number };   // normalized 0–1
  pdf?: { pinned: boolean };              // the page itself is the standard `subpath`
  portal?: { open: boolean };
  kanban?: { key: string; value: string };
  query?: { tags?: string[]; folder?: string; properties?: { key: string; value?: string }[]; linksTo?: string[]; auto?: boolean };
  queryOwner?: string;
  strokes?: Stroke[];                     // only on kind: "ink"
  guide?: { axis: "h" | "v"; angle?: number; width: number };  // only on kind: "guide"; angle 0–180°, clockwise
  layer?: string;                         // layer id; absent or unknown = bottom layer
  slide?: boolean;                        // a presentation slide (group)
}

interface OpcEdge {
  path?: "solid" | "dotted" | "short-dashed" | "long-dashed";
  arrows?: { from?: ArrowStyle; to?: ArrowStyle };
  route?: "bezier" | "straight" | "orthogonal" | "astar";
  waypoints?: [number, number][];         // absolute; override `route`
  labelT?: number;                        // 0–1 along the path
  floating?: { from?: boolean; to?: boolean };
  order?: number;                         // presentation order
  portalTarget?: { end: "from" | "to"; nodeId: string };
  styles?: Record<string, string>;
}

interface Stroke {
  id: string; tool: "pen" | "pencil" | "marker" | "highlighter";
  color: string; size: number; opacity?: number; smoothing?: number; locked?: boolean;
  pts: number[];   // flat [x, y, pressure, …] relative to the carrier node
  tilt?: number[]; // flat [tiltX, tiltY, …], one pair per point
}
```

Flowchart shapes: `terminal`, `process`, `decision`, `input-output`, `on-page-reference`,
`predefined-process`, `document`, `database`, `pill`.
Standalone shapes: `rectangle`, `rounded-rectangle`, `ellipse`, `diamond`, `triangle`,
`parallelogram`, `trapezoid`, `pentagon`, `hexagon`, `octagon`, `star`, `cross`, `heart`,
`cylinder`, `cloud`, `speech-bubble`, `callout`, `block-arrow-left|right|up|down|double`.
Arrow styles: `triangle`, `triangle-outline`, `halved-triangle`, `thin-triangle`, `diamond`,
`diamond-outline`, `circle`, `circle-outline`, `blunted`, `none`.

## Example

```json
{
  "nodes": [
    { "id": "a1", "type": "text", "text": "Start", "x": 0, "y": 0, "width": 240, "height": 80,
      "x-opc": { "shape": "terminal", "border": "dashed" } },
    { "id": "s1", "type": "text", "text": "Idea", "x": 300, "y": 0, "width": 200, "height": 200, "color": "#ffd43b",
      "x-opc": { "kind": "sticky", "sticky": { "created": 1760425200000 } } }
  ],
  "edges": [
    { "id": "e1", "fromNode": "a1", "fromSide": "right", "toNode": "s1", "toSide": "left", "toEnd": "arrow",
      "x-opc": { "arrows": { "to": "diamond" }, "route": "orthogonal", "labelT": 0.3 } }
  ],
  "x-opc": { "v": 1, "dir": "rtl", "frontmatter": { "tags": ["project"] } }
}
```

## Node kinds (Phase 5)

All kinds are `text` nodes, so vanilla Obsidian and other JSON Canvas apps still load them.

| kind | Stored | Without the plugin |
|---|---|---|
| `ink` | `strokes` (points relative to the node). Text is `✏️`. The node box always wraps its strokes (re-fitted after every edit). | A small card with ✏️ |
| `line` | `line.points` relative to the node, `from`/`to` attachments, arrowheads; `strokeWidth`; color in the standard `color` field. | An empty card where the line was |
| `shape` | `shape`, `fill` (`"solid"`, `"none"`, a hex color; absent = light tint), `strokeWidth`, `opacity`, `rotation`; color in `color`. | A card with the shape's text |
| `sticky` | Color in `color` (hex, any color), optional `sticky: { author, created, footer }`. | A colored card |
| `text` | Floating text: an ordinary text card drawn without background or border, usually with `autoWidth`. | An ordinary text card |
| `guide` | Infinite line: `guide: { axis, width }`, color in `color`. The node is a small handle on the line; the line itself is drawn across the whole board. | A small empty card |

Other Phase 5 fields: `crop` on image file nodes (normalized rectangle; the image file is never
changed) and `locked` on any node.

**Decision on stroke storage:** strokes live on ink carrier nodes, not on the root. Carriers
take part in z-order, culling, copy/paste, selection and undo like any card, and a drawing that
spans a large area is split into nearby carriers (a new stroke joins the topmost unlocked
carrier within 60 px, else gets its own), which keeps each node's data small.

## Existing Advanced Canvas data

Files edited by Advanced Canvas contain its own keys (root `metadata`, edge `fromFloating`, …).
They are left untouched: we neither read nor convert them, and our writes never remove them.
