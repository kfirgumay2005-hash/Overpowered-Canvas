/**
 * Custom style attributes declared in CSS snippets (pure, unit-tested).
 *
 *   /* @opc-node-style
 *   key: pattern
 *   label: Pattern
 *   icon: grid
 *   options:
 *     - label: None
 *       value: null
 *     - label: Dots
 *       value: dots
 *       icon: circle-dot
 *   *\/
 *
 * The value is stored in x-opc.styles and exposed as `data-<key>` on the node (or edge)
 * element and on the editor iframe's body, so the snippet can style it.
 */

export interface StyleOption {
	label: string;
	value: string | null;
	icon?: string;
}

export interface StyleAttribute {
	target: "node" | "edge";
	key: string;
	label: string;
	icon?: string;
	options: StyleOption[];
}

const BLOCK = /\/\*\s*@opc-(node|edge)-style\b([\s\S]*?)\*\//g;
const KEY = /^[a-z][a-z0-9-]{0,40}$/;

export function extractStyleBlocks(css: string): { target: "node" | "edge"; yaml: string }[] {
	return [...css.matchAll(BLOCK)].map((m) => ({ target: m[1] as "node" | "edge", yaml: m[2] ?? "" }));
}

export function validateAttribute(raw: unknown, target: "node" | "edge"): StyleAttribute | null {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	const r = raw as Record<string, unknown>;
	const key = typeof r.key === "string" ? r.key.trim() : "";
	if (!KEY.test(key) || key.startsWith("opc-")) return null;
	if (!Array.isArray(r.options)) return null;
	const options: StyleOption[] = [];
	for (const o of r.options) {
		if (!o || typeof o !== "object") return null;
		const opt = o as Record<string, unknown>;
		const value = opt.value === null || opt.value === undefined ? null : String(opt.value);
		if (value !== null && !/^[\w-]{1,60}$/.test(value)) return null;
		options.push({ label: typeof opt.label === "string" ? opt.label : String(value ?? "—"), value, ...(typeof opt.icon === "string" ? { icon: opt.icon } : {}) });
	}
	// Exactly one option means "unset".
	if (options.filter((o) => o.value === null).length !== 1) return null;
	return { target, key, label: typeof r.label === "string" ? r.label : key, ...(typeof r.icon === "string" ? { icon: r.icon } : {}), options };
}

/** Parses all blocks of all snippets; later declarations of the same target+key win. */
export function parseStyleAttributes(cssFiles: string[], parseYaml: (yaml: string) => unknown): StyleAttribute[] {
	const out = new Map<string, StyleAttribute>();
	for (const css of cssFiles) {
		for (const block of extractStyleBlocks(css)) {
			let raw: unknown;
			try {
				raw = parseYaml(block.yaml);
			} catch {
				continue;
			}
			const attr = validateAttribute(raw, block.target);
			if (attr) out.set(`${attr.target}:${attr.key}`, attr);
		}
	}
	return [...out.values()];
}
