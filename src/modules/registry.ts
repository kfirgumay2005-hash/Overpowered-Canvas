import type { AnyModule } from "../core/module";
import { altTextRenderingModule } from "./alt-text-rendering";
import { autoResizeModule } from "./auto-resize";
import { betterDefaultsModule } from "./better-defaults";
import { createGroupModule } from "./create-group";
import { customColorsModule } from "./custom-colors";
import { diagnosticsModule } from "./diagnostics";
import { edgeRoutingModule } from "./edge-routing";
import { edgeStylesModule } from "./edge-styles";
import { edgeToolsModule } from "./edge-tools";
import { floatingEdgesModule } from "./floating-edges";
import { nodeBordersModule } from "./node-borders";
import { nodeShapesModule } from "./node-shapes";
import { nodeTemplatesModule } from "./node-templates";
import { textAlignModule } from "./text-align";
import { variableBreakpointsModule } from "./variable-breakpoints";
import { zOrderModule } from "./z-order";

/** Every feature module, in display order within its settings group. */
export const MODULES: readonly AnyModule[] = [
	betterDefaultsModule,
	nodeShapesModule,
	nodeBordersModule,
	textAlignModule,
	autoResizeModule,
	customColorsModule,
	zOrderModule,
	nodeTemplatesModule,
	createGroupModule,
	variableBreakpointsModule,
	altTextRenderingModule,
	edgeStylesModule,
	edgeRoutingModule,
	floatingEdgesModule,
	edgeToolsModule,
	diagnosticsModule,
];
