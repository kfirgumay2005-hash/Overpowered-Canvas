/**
 * ELK running in a Web Worker created from the bundled elkjs worker script (elkjs is used
 * unmodified; EPL-2.0). Created on first use and terminated when the module is disabled.
 */
import ELK from "elkjs/lib/elk-api.js";
import workerSource from "elk-worker-source";
import type { ElkLike } from "./layout";

let elk: (ElkLike & { terminateWorker(): void }) | null = null;
let url: string | null = null;

export function getElk(): ElkLike {
	if (!elk) {
		// The build ships the worker base64 encoded (see esbuild.config.mjs).
		const bytes = Uint8Array.from(atob(workerSource), (c) => c.charCodeAt(0));
		url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
		const workerUrl = url;
		elk = new ELK({ workerFactory: () => new Worker(workerUrl) });
	}
	return elk;
}

export function disposeElk(): void {
	try {
		elk?.terminateWorker();
	} catch {
		// already gone
	}
	elk = null;
	if (url) URL.revokeObjectURL(url);
	url = null;
}
