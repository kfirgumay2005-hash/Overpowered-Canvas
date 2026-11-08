import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		// Neither exists at run time: "obsidian" ships only types, the worker comes from the build.
		alias: {
			obsidian: fileURLToPath(new URL("./src/testing/obsidian-stub.ts", import.meta.url)),
			"elk-worker-source": fileURLToPath(new URL("./src/testing/elk-worker-stub.ts", import.meta.url)),
			"emoji-data": fileURLToPath(new URL("./src/testing/emoji-data-stub.ts", import.meta.url)),
		},
	},
	test: {
		include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
		environment: "node",
	},
});
