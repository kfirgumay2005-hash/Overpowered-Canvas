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
}

interface OpcNode {
  kind?: "sticky" | "shape" | "line" | "ink";  // absent = ordinary node
  shape?: FlowchartShape | StandaloneShape;
  border?: "solid" | "dotted" | "dashed" | "none";
  align?: "start" | "center" | "end";
  dir?: "ltr" | "rtl" | "auto";
  autoResize?: boolean; locked?: boolean; breakpoint?: number; collapsed?: boolean;
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

## Open decision: where strokes live (Phase 5)

Version 1 stores strokes on ink carrier nodes (`kind: "ink"`, a `text` node with empty text).
Source reading showed that root data is also part of undo snapshots, so a root-level stroke
layer is possible too. The trade-offs (vanilla Obsidian shows an empty card for a carrier;
a `group` carrier would drag the cards inside it; culling and z-order) are decided in Phase 5,
with a migration if the storage changes.

## Existing Advanced Canvas data

Files edited by Advanced Canvas contain its own keys (root `metadata`, edge `fromFloating`, …).
They are left untouched: we neither read nor convert them, and our writes never remove them.
