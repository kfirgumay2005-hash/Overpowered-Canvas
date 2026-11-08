/**
 * The emoji list, bundled with the plugin (built from emojibase-data at build time, see
 * scripts/emoji-data.mjs): no network. It ships as plain strings and is only read when the picker
 * first opens; names in the UI language are unpacked then too.
 */
import data from "emoji-data";
import { addNames, parseEmoji, type Emoji } from "./logic";

let list: Emoji[] | null = null;
let names = "en";

export async function loadEmoji(lang: string): Promise<Emoji[]> {
	list ??= parseEmoji(data.core, data.en);
	const pack = data.packs[lang];
	if (lang !== names && pack) {
		try {
			addNames(list, await inflate(pack));
			names = lang;
		} catch {
			// No DecompressionStream on this system: English names still find everything.
		}
	}
	return list;
}

async function inflate(base64: string): Promise<string> {
	const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Response(stream).text();
}
