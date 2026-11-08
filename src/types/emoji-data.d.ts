/** The emoji picker's data, built from emojibase-data by scripts/emoji-data.mjs (see esbuild.config.mjs). */
declare module "emoji-data" {
	const data: {
		/** One line per emoji: emoji \t group \t five skin tones, comma-separated (or empty). */
		core: string;
		/** One line per emoji: label \t keywords. */
		en: string;
		/** The same for other UI languages, deflate-raw compressed, base64. */
		packs: Record<string, string>;
		version: string;
	};
	export default data;
}
