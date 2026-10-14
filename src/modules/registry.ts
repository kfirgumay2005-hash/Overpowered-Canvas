import type { AnyModule } from "../core/module";
import { altTextRenderingModule } from "./alt-text-rendering";
import { autoEdgesModule } from "./auto-edges";
import { canvasMetadataModule } from "./canvas-metadata";
import { canvasPropertiesModule } from "./canvas-properties";
import { canvasSearchModule } from "./canvas-search";
import { collapsibleGroupsModule } from "./collapsible-groups";
import { encapsulateModule } from "./encapsulate";
import { eventsApiModule } from "./events-api";
import { focusModeModule } from "./focus-mode";
import { pdfAnnotationModule } from "./pdf-annotation";
import { portalsModule } from "./portals";
import { presentationModule } from "./presentation";
import { styleAttributesModule } from "./style-attributes";
import { imageExportModule } from "./image-export";
import { nodeLinksModule } from "./node-links";
import { readonlyPlusModule } from "./readonly-plus";
import { autoLayoutModule } from "./auto-layout";
import { autoResizeModule } from "./auto-resize";
import { branchCollapseModule } from "./branch-collapse";
import { mindmapModule } from "./mindmap";
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
	canvasMetadataModule,
	canvasPropertiesModule,
	autoEdgesModule,
	nodeLinksModule,
	canvasSearchModule,
	readonlyPlusModule,
	imageExportModule,
	presentationModule,
	portalsModule,
	collapsibleGroupsModule,
	focusModeModule,
	encapsulateModule,
	pdfAnnotationModule,
	styleAttributesModule,
	eventsApiModule,
	mindmapModule,
	branchCollapseModule,
	autoLayoutModule,
	diagnosticsModule,
];
