import type { AnyModule } from "../core/module";
import { diagnosticsModule } from "./diagnostics";
import { nodeBordersModule } from "./node-borders";
import { nodeShapesModule } from "./node-shapes";
import { textAlignModule } from "./text-align";

/** Every feature module, in display order within its settings group. */
export const MODULES: readonly AnyModule[] = [nodeShapesModule, nodeBordersModule, textAlignModule, diagnosticsModule];
