import type { AnyModule } from "../core/module";
import { diagnosticsModule } from "./diagnostics";

/** Every feature module, in display order within its settings group. */
export const MODULES: readonly AnyModule[] = [diagnosticsModule];
