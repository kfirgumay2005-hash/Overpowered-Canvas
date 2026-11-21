/**
 * ELK running in a Web Worker created from the bundled elkjs worker script (elkjs is used
 * unmodified; EPL-2.0). Created on first use and terminated when the module is disabled.
 *
 * The build ships the worker deflated and base64 encoded (see esbuild.config.mjs): it is
 * unpacked the first time a layout runs.
 */
import ELK from "elkjs/lib/elk-api.js";
import workerSource from "elk-worker-source";
import type { ElkLike } from "./layout";

type Elk = ElkLike & { terminateWorker(): void };

let elk: Promise<Elk> | null = null;
let url: string | null = null;
/** Bumped by disposeElk, so a worker still being unpacked is dropped once it is ready. */
let generation = 0;

async function unpack(): Promise<Blob> {
	const bytes = Uint8Array.from(atob(workerSource), (c) => c.charCodeAt(0));
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
	return new Blob([await new Response(stream).arrayBuffer()], { type: "text/javascript" });
}

async function create(): Promise<Elk> {
	const mine = generation;
	const blob = await unpack();
	if (mine !== generation) throw new Error("Layout engine was stopped.");
	url = URL.createObjectURL(blob);
	const workerUrl = url;
	return new ELK({ workerFactory: () => new Worker(workerUrl) });
}

export function getElk(): ElkLike {
	return {
		layout: async (graph) => {
			if (!elk) {
				const created = (elk = create());
				// A failed start is tried again on the next layout.
				created.catch(() => {
					if (elk === created) elk = null;
				});
			}
			return (await elk).layout(graph);
		},
	};
}

export function disposeElk(): void {
	generation++;
	const pending = elk;
	elk = null;
	void pending?.then(
		(e) => {
			try {
				e.terminateWorker();
			} catch {
				// already gone
			}
		},
		() => {},
	);
	if (url) URL.revokeObjectURL(url);
	url = null;
}
