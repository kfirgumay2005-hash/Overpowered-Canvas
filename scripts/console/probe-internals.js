/* Overpowered Canvas — canvas internals probe. Paste into Obsidian's developer console with a canvas open. Generated from src/internals/probe.ts. */
"use strict";
(() => {
  // src/internals/probe.ts
  var PROBE_KEY = "x-opc-probe";
  var CANVAS_MEMBERS = [
    "app",
    "view",
    "nodes",
    "edges",
    "selection",
    "data",
    "history",
    "requestPushHistory",
    "readonly",
    "x",
    "y",
    "zoom",
    "tx",
    "ty",
    "tZoom",
    "scale",
    "wrapperEl",
    "canvasEl",
    "cardMenuEl",
    "menu",
    "nodeIndex",
    "edgeIndex",
    "edgeFrom",
    "edgeTo",
    "moved",
    "dirty",
    "config",
    "options",
    "getData",
    "setData",
    "importData",
    "requestSave",
    "pushHistory",
    "applyHistory",
    "undo",
    "redo",
    "markDirty",
    "markMoved",
    "requestFrame",
    "setViewport",
    "panTo",
    "panBy",
    "zoomBy",
    "zoomToFit",
    "zoomToSelection",
    "zoomToBbox",
    "getViewportBBox",
    "getViewportNodes",
    "createTextNode",
    "createFileNode",
    "createLinkNode",
    "createGroupNode",
    "addNode",
    "removeNode",
    "addEdge",
    "removeEdge",
    "getEdgesForNode",
    "selectOnly",
    "deselectAll",
    "updateSelection",
    "setReadonly",
    "render",
    "rerenderViewport",
    "virtualize",
    "getSelectionData",
    "handlePaste",
    "handleCopy",
    "onContextMenu",
    "onSelectionContextMenu",
    "posFromEvt",
    "posFromClient",
    "domFromPos"
  ];
  var NODE_MEMBERS = [
    "id",
    "canvas",
    "x",
    "y",
    "width",
    "height",
    "color",
    "unknownData",
    "nodeEl",
    "contentEl",
    "zIndex",
    "isEditing",
    "getData",
    "setData",
    "render",
    "getBBox",
    "moveTo",
    "resize",
    "moveAndResize",
    "setColor",
    "updateBreakpoint",
    "startEditing",
    "showMenu",
    "child"
  ];
  var EDGE_MEMBERS = [
    "id",
    "canvas",
    "from",
    "to",
    "color",
    "label",
    "unknownData",
    "lineGroupEl",
    "lineEndGroupEl",
    "path",
    "labelElement",
    "getData",
    "setData",
    "render",
    "updatePath",
    "getBBox",
    "setColor",
    "setLabel",
    "showMenu"
  ];
  var VIEW_MEMBERS = ["canvas", "file", "getViewData", "setViewData", "requestSave", "getViewType"];
  function typeOf(value) {
    if (value === null) return "null";
    if (value instanceof Map) return "Map";
    if (value instanceof Set) return "Set";
    if (Array.isArray(value)) return "array";
    if (typeof HTMLElement !== "undefined" && value instanceof HTMLElement) return "HTMLElement";
    if (typeof SVGElement !== "undefined" && value instanceof SVGElement) return "SVGElement";
    return typeof value;
  }
  function members(obj, names) {
    const out = {};
    const rec = obj;
    for (const name of names) out[name] = typeOf(rec[name]);
    return out;
  }
  function protoMethods(obj) {
    const levels = [];
    let proto = Object.getPrototypeOf(obj);
    while (proto && proto !== Object.prototype) {
      levels.push(
        Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor" && typeof Object.getOwnPropertyDescriptor(proto, n)?.value === "function").sort()
      );
      proto = Object.getPrototypeOf(proto);
    }
    return levels;
  }
  function patchedMethods(obj, prefix) {
    const out = [];
    let proto = Object.getPrototypeOf(obj);
    while (proto && proto !== Object.prototype) {
      for (const n of Object.getOwnPropertyNames(proto)) {
        const fn = Object.getOwnPropertyDescriptor(proto, n)?.value;
        if (typeof fn === "function" && Object.getPrototypeOf(fn) !== Function.prototype) out.push(`${prefix}.${n}`);
      }
      proto = Object.getPrototypeOf(proto);
    }
    return out;
  }
  function attempt(fn) {
    try {
      return fn();
    } catch (error) {
      return `threw: ${String(error)}`;
    }
  }
  function probeCanvasInternals(app) {
    const a = app;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const enabled = a.plugins?.enabledPlugins;
    const report2 = {
      probeVersion: 1,
      obsidianVersion: /obsidian\/([\d.]+)/i.exec(ua)?.[1] ?? null,
      isMobile: typeof a.isMobile === "boolean" ? a.isMobile : null,
      enabledPlugins: enabled instanceof Set ? [...enabled].sort() : [],
      canvasFound: false,
      problems: []
    };
    const ws = a.workspace;
    const leaves = [ws?.getMostRecentLeaf?.(), ...ws?.getLeavesOfType?.("canvas") ?? []];
    const view = leaves.map((l) => l?.view).find((v) => {
      const getType = v?.getViewType;
      return typeof getType === "function" && getType.call(v) === "canvas" && !!v?.canvas;
    });
    if (!view) {
      report2.problems.push("No open canvas found. Open a canvas (and click into it) first.");
      return report2;
    }
    report2.canvasFound = true;
    const canvas = view.canvas;
    report2.view = { members: members(view, VIEW_MEMBERS), protoMethods: protoMethods(view) };
    report2.canvas = {
      members: members(canvas, CANVAS_MEMBERS),
      protoMethods: protoMethods(canvas),
      nodeCount: canvas.nodes instanceof Map ? canvas.nodes.size : null,
      edgeCount: canvas.edges instanceof Map ? canvas.edges.size : null,
      zoom: canvas.zoom,
      history: {
        length: canvas.history?.data?.length ?? null,
        current: canvas.history?.current ?? null,
        max: canvas.history?.max ?? null,
        methods: protoMethods(canvas.history ?? {})[0] ?? []
      },
      requestPushHistory: {
        type: typeOf(canvas.requestPushHistory),
        run: typeOf(canvas.requestPushHistory?.run),
        cancel: typeOf(canvas.requestPushHistory?.cancel)
      },
      dataKeys: Object.keys(canvas.data ?? {})
    };
    const nodeList = canvas.nodes instanceof Map ? [...canvas.nodes.values()] : [];
    report2.nodes = {};
    for (const node of nodeList) {
      const data = attempt(() => node.getData());
      const type = typeof data === "object" ? String(data.type) : "unknown";
      if (report2.nodes[type]) continue;
      report2.nodes[type] = {
        members: members(node, NODE_MEMBERS),
        protoMethods: protoMethods(node),
        unknownDataKeys: Object.keys(node.unknownData ?? {}),
        getDataKeys: typeof data === "object" ? Object.keys(data) : data
      };
    }
    if (nodeList.length === 0) report2.problems.push("Canvas has no nodes; add a text card and a group, connect two cards, then run again.");
    const edge = canvas.edges instanceof Map ? [...canvas.edges.values()][0] : void 0;
    report2.edge = edge ? {
      members: members(edge, EDGE_MEMBERS),
      fromMembers: members(edge.from, ["node", "side", "end"]),
      protoMethods: protoMethods(edge),
      unknownDataKeys: Object.keys(edge.unknownData ?? {}),
      getDataKeys: Object.keys(edge.getData())
    } : null;
    report2.roundTrip = {
      node: nodeList[0] ? roundTripItem(nodeList[0]) : "no nodes",
      edge: edge ? roundTripItem(edge) : "no edges",
      root: attempt(() => {
        const saved = canvas.data;
        try {
          canvas.data = { ...saved, [PROBE_KEY]: { ok: 1 } };
          const out = canvas.getData();
          return out[PROBE_KEY]?.ok === 1;
        } finally {
          canvas.data = saved;
        }
      }),
      historyIsShallow: attempt(() => {
        const snap = canvas.getData();
        const first = snap.nodes?.[0];
        const live = nodeList.find((n) => n.id === first?.id);
        if (!first || !live) return "no nodes";
        const saved = live.unknownData;
        try {
          const marker = { ok: 1 };
          live.unknownData = { ...saved, [PROBE_KEY]: marker };
          const again = live.getData();
          return again[PROBE_KEY] === marker;
        } finally {
          live.unknownData = saved;
        }
      })
    };
    report2.patchedMethods = [
      ...patchedMethods(canvas, "canvas"),
      ...patchedMethods(view, "view"),
      ...nodeList[0] ? patchedMethods(nodeList[0], "node") : [],
      ...edge ? patchedMethods(edge, "edge") : []
    ];
    if (report2.patchedMethods.length > 0)
      report2.problems.push("Some canvas methods are patched by a plugin \u2014 run this with other canvas plugins disabled for a clean baseline.");
    return report2;
  }
  function roundTripItem(item) {
    return attempt(() => {
      const getData = item.getData;
      const setData = item.setData;
      const savedUnknown = item.unknownData;
      const original = getData.call(item);
      try {
        setData.call(item, { ...original, [PROBE_KEY]: { ok: 1 } });
        return getData.call(item)[PROBE_KEY]?.ok === 1;
      } finally {
        setData.call(item, original);
        item.unknownData = savedUnknown;
      }
    });
  }

  // src/internals/probe-console.ts
  var report = probeCanvasInternals(globalThis.app);
  var json = JSON.stringify(report, null, 1);
  console.log(json);
  if (typeof copy === "function") {
    copy(json);
    console.log("%c[overpowered-canvas] Report copied to the clipboard \u2014 paste it back to Claude.", "font-weight:bold");
  }
})();
