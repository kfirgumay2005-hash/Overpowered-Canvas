import { around } from "monkey-around";

/** Wrapper factories for the methods of T, in monkey-around style: `next` is the previous implementation. */
export type PatchFactories<T> = {
	[K in keyof T]?: T[K] extends (...args: never[]) => unknown ? (next: T[K]) => T[K] : never;
};

export interface PatchRecord {
	readonly owner: string;
	readonly label: string;
	readonly methods: readonly string[];
}

/**
 * The single entry point for monkey-patching. Keeps a registry of what is installed so a
 * disabled module can be proven to leave zero patches behind (see the diagnostics module).
 */
export class Patcher {
	private readonly active = new Set<PatchRecord>();

	/** Installs the patch and returns its uninstaller (idempotent). */
	apply<T extends object>(owner: string, label: string, target: T, factories: PatchFactories<T>): () => void {
		const uninstall = around(target as Record<string, never>, factories as Record<string, never>);
		const record: PatchRecord = { owner, label, methods: Object.keys(factories) };
		this.active.add(record);
		let removed = false;
		return () => {
			if (removed) return;
			removed = true;
			uninstall();
			this.active.delete(record);
		};
	}

	list(owner?: string): PatchRecord[] {
		return [...this.active].filter((p) => owner === undefined || p.owner === owner);
	}
}
