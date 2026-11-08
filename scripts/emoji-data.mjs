/**
 * Builds the emoji picker's data from emojibase-data (MIT, https://emojibase.dev) at build time:
 * the "emoji-data" virtual module (see esbuild.config.mjs). Nothing is fetched at run time.
 *
 * - core: one line per emoji, in emojibase's order: emoji \t group \t five skin tones (comma-separated, or empty)
 * - en: one line per emoji: label \t keywords (space-separated)
 * - packs: the same for the other UI languages, deflate-raw compressed and base64 encoded
 *   (decoded only when the picker opens in that language)
 *
 * Emoji newer than MAX_VERSION are left out: most systems can't draw them yet.
 */
import { createRequire } from "node:module";
import { deflateRawSync } from "node:zlib";

const require = createRequire(import.meta.url);
export const MAX_VERSION = 16;
const LANGS = ["zh", "ja", "hi", "ru"];

export function buildEmojiData() {
	const all = require("emojibase-data/en/data.json");
	// Group 2 is "component" (skin tone and hair swatches): not emoji to insert on their own.
	const list = all.filter((e) => typeof e.group === "number" && e.group !== 2 && (e.version ?? 0) <= MAX_VERSION);
	const clean = (s) => String(s ?? "").replace(/[\t\n]/g, " ");
	const core = list
		.map((e) => {
			const tones = (e.skins ?? []).filter((s) => typeof s.tone === "number" && (s.version ?? 0) <= MAX_VERSION).sort((a, b) => a.tone - b.tone);
			return [e.emoji, e.group, tones.length === 5 ? tones.map((s) => s.emoji).join(",") : ""].join("\t");
		})
		.join("\n");
	const words = (entries) => {
		const byHex = new Map(entries.map((x) => [x.hexcode, x]));
		return list
			.map((e) => {
				const x = byHex.get(e.hexcode);
				return x ? `${clean(x.label)}\t${(x.tags ?? []).map(clean).join(" ")}` : "";
			})
			.join("\n");
	};
	const en = words(all);
	const packs = {};
	for (const lang of LANGS) packs[lang] = deflateRawSync(words(require(`emojibase-data/${lang}/compact.json`)), { level: 9 }).toString("base64");
	const version = require("emojibase-data/package.json").version;
	return { core, en, packs, version, count: list.length };
}

/** esbuild plugin: `import data from "emoji-data"`. */
export const emojiDataPlugin = {
	name: "emoji-data",
	setup(build) {
		build.onResolve({ filter: /^emoji-data$/ }, () => ({ path: "emoji-data", namespace: "emoji-data" }));
		build.onLoad({ filter: /.*/, namespace: "emoji-data" }, () => {
			const { core, en, packs, version } = buildEmojiData();
			return { contents: `export default ${JSON.stringify({ core, en, packs, version })};`, loader: "js" };
		});
	},
};
