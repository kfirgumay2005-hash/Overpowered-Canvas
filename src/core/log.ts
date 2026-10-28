/**
 * The plugin's own problem reports: printed to the console as before and, while the debug log
 * (Diagnostics module) is on, kept there too, so they can be sent from devices without
 * developer tools.
 */

export type LogSink = (level: "error" | "warn", args: unknown[]) => void;

let sink: LogSink | null = null;

/** The debug log listens here (null: nobody). */
export function setLogSink(next: LogSink | null): void {
	sink = next;
}

export function logError(...args: unknown[]): void {
	console.error(...args);
	sink?.("error", args);
}

export function logWarn(...args: unknown[]): void {
	console.warn(...args);
	sink?.("warn", args);
}
