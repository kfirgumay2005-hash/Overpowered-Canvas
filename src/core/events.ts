import type { Workspace } from "obsidian";

export const EVENT_PREFIX = "overpowered-canvas:";

/**
 * Public events, triggered on app.workspace as "overpowered-canvas:<name>".
 * Other plugins listen with app.workspace.on("overpowered-canvas:<name>", ...).
 * Each phase adds its events here; the payload tuple is part of the public API.
 */
export interface PublicEventMap {
	"module-enabled": [moduleId: string];
	"module-disabled": [moduleId: string];
}

export type PublicEventName = keyof PublicEventMap;

export class PublicEvents {
	constructor(private readonly workspace: Workspace) {}

	emit<K extends PublicEventName>(name: K, ...args: PublicEventMap[K]): void {
		try {
			this.workspace.trigger(`${EVENT_PREFIX}${name}`, ...args);
		} catch (error) {
			// A listener in another plugin must never break us.
			console.error(`[overpowered-canvas] listener of ${name} threw`, error);
		}
	}
}
