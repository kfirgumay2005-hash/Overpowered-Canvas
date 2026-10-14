/**
 * Deterministic stress-test canvas generator (pure — see gen-stress-canvas.mjs for the CLI).
 * Produces text cards, sticky notes, shapes, groups, edges and ink strokes using the "x-opc"
 * schema from docs/SCHEMA.md. No link nodes: they would load web pages (network).
 */

/** mulberry32 — small seeded PRNG so every run produces the same file. */
function prng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const SHAPES = ["terminal", "process", "decision", "database", "ellipse", "hexagon", "star", "cloud"];
const COLORS = ["1", "2", "3", "4", "5", "6", "#7c3aed", ""];
const INK_COLORS = ["#1e1e1e", "#e03131", "#1971c2", "#2f9e44", "#f08c00"];
const WORDS_EN = ["idea", "plan", "risk", "goal", "task", "note", "draft", "review", "launch", "budget"];
const WORDS_HE = ["רעיון", "תוכנית", "סיכון", "מטרה", "משימה", "הערה", "טיוטה", "סקירה", "השקה", "תקציב"];

const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

export function generateStressCanvas({ nodes = 1000, edges = 1500, strokes = 2000, groups = 20, strokesPerCarrier = 20, seed = 1 } = {}) {
	const rand = prng(seed);
	const pick = (arr) => arr[Math.floor(rand() * arr.length)];
	const id = (prefix, i) => `${prefix}${i.toString(16).padStart(6, "0")}`;

	const cols = Math.ceil(Math.sqrt(nodes));
	const cellW = 320;
	const cellH = 220;
	const outNodes = [];
	const cardIds = [];

	// Groups first so they render beneath their cards (array order = z-order).
	const groupSpan = Math.max(1, Math.floor(cols / Math.ceil(Math.sqrt(groups))));
	for (let g = 0; g < groups; g++) {
		const gx = (g % Math.ceil(Math.sqrt(groups))) * groupSpan;
		const gy = Math.floor(g / Math.ceil(Math.sqrt(groups))) * groupSpan;
		outNodes.push({
			id: id("g", g),
			type: "group",
			label: `Group ${g + 1} · קבוצה ${g + 1}`,
			x: gx * cellW - 40,
			y: gy * cellH - 60,
			width: groupSpan * cellW + 40,
			height: groupSpan * cellH + 60,
			color: pick(COLORS) || undefined,
		});
	}

	for (let i = 0; i < nodes; i++) {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const kindRoll = rand();
		const hebrew = rand() < 0.4;
		const words = Array.from({ length: 2 + Math.floor(rand() * 10) }, () => pick(hebrew ? WORDS_HE : WORDS_EN)).join(" ");
		const node = {
			id: id("n", i),
			type: "text",
			text: kindRoll < 0.15 ? `## ${words}\n\n- [ ] ${pick(WORDS_EN)}\n- [x] ${pick(WORDS_HE)}` : words,
			x: col * cellW,
			y: row * cellH,
			width: 250,
			height: kindRoll < 0.15 ? 160 : 80,
		};
		const color = pick(COLORS);
		if (color) node.color = color;
		if (kindRoll >= 0.7 && kindRoll < 0.8) {
			node.width = node.height = 180;
			node["x-opc"] = { kind: "sticky", sticky: { created: 1760400000000 + i * 60000 } };
		} else if (kindRoll >= 0.8 && kindRoll < 0.9) {
			node["x-opc"] = { kind: "shape", shape: pick(SHAPES), ...(rand() < 0.5 ? { border: "dashed" } : {}) };
		} else if (kindRoll >= 0.9 && hebrew) {
			node["x-opc"] = { dir: "rtl" };
		}
		outNodes.push(node);
		cardIds.push(node.id);
	}

	// Ink carriers: empty text nodes holding strokes (storage is finalized in Phase 5).
	const carriers = Math.ceil(strokes / strokesPerCarrier);
	let strokeCount = 0;
	for (let c = 0; c < carriers; c++) {
		const cx = Math.floor(rand() * cols) * cellW + 40;
		const cy = Math.floor(rand() * Math.ceil(nodes / cols)) * cellH + 40;
		const w = 400;
		const h = 300;
		const list = [];
		for (let s = 0; s < strokesPerCarrier && strokeCount < strokes; s++, strokeCount++) {
			const pts = [];
			let x = rand() * w;
			let y = rand() * h;
			let angle = rand() * Math.PI * 2;
			const n = 30 + Math.floor(rand() * 50);
			for (let p = 0; p < n; p++) {
				angle += (rand() - 0.5) * 0.6;
				x = Math.min(w, Math.max(0, x + Math.cos(angle) * 6));
				y = Math.min(h, Math.max(0, y + Math.sin(angle) * 6));
				pts.push(round(x), round(y), round(0.3 + rand() * 0.6, 2));
			}
			list.push({ id: id("s", strokeCount), tool: pick(["pen", "pencil", "marker"]), color: pick(INK_COLORS), size: 2 + Math.floor(rand() * 6), pts });
		}
		outNodes.push({ id: id("k", c), type: "text", text: "", x: cx, y: cy, width: w, height: h, "x-opc": { kind: "ink", strokes: list } });
	}

	const outEdges = [];
	const sides = ["top", "right", "bottom", "left"];
	for (let e = 0; e < edges && cardIds.length > 1; e++) {
		const from = Math.floor(rand() * cardIds.length);
		// Mostly local connections, like a real board.
		const offset = rand() < 0.8 ? 1 + Math.floor(rand() * 3) * (rand() < 0.5 ? 1 : cols) : Math.floor(rand() * cardIds.length);
		const to = (from + offset) % cardIds.length;
		if (to === from) continue;
		const edge = { id: id("e", e), fromNode: cardIds[from], fromSide: pick(sides), toNode: cardIds[to], toSide: pick(sides) };
		const roll = rand();
		if (roll < 0.1) edge.label = pick(WORDS_EN);
		if (roll > 0.85) edge["x-opc"] = { path: pick(["dotted", "short-dashed", "long-dashed"]), arrows: { to: pick(["diamond", "circle", "triangle-outline"]) } };
		outEdges.push(edge);
	}

	return {
		nodes: outNodes.map((n) => (n.color === undefined ? (({ color, ...rest }) => rest)(n) : n)),
		edges: outEdges,
		"x-opc": { v: 1 },
	};
}
