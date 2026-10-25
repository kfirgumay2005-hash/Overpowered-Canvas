import type { AnyModule } from "../core/module";
import { autoEdgesModule } from "./auto-edges";
import { canvasMetadataModule } from "./canvas-metadata";
import { canvasPropertiesModule } from "./canvas-properties";
import { canvasSearchModule } from "./canvas-search";
import { canvasCommandsModule } from "./canvas-commands";
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
import { directionModule } from "./direction";
import { performanceModule } from "./performance";
import { createGroupModule } from "./create-group";
import { customColorsModule } from "./custom-colors";
import { diagnosticsModule } from "./diagnostics";
import { drawingModule } from "./drawing";
import { freeLinesModule } from "./free-lines";
import { shapesModule } from "./shapes";
import { stickyNotesModule } from "./sticky-notes";
import { floatingTextModule } from "./floating-text";
import { infiniteLinesModule } from "./infinite-lines";
import { imageCropModule } from "./image-crop";
import { edgeEditingModule } from "./edge-editing";
import { lockItemsModule } from "./lock-items";
import { minimapModule } from "./minimap";
import { gridModule } from "./grid";
import { framesModule } from "./frames";
import { boardTemplatesModule } from "./board-templates";
import { kanbanModule } from "./kanban";
import { queryGroupsModule } from "./query-groups";
import { edgeRoutingModule } from "./edge-routing";
import { edgeStylesModule } from "./edge-styles";
import { edgeToolsModule } from "./edge-tools";
import { floatingEdgesModule } from "./floating-edges";
import { nodeBordersModule } from "./node-borders";
import { nodeShapesModule } from "./node-shapes";
import { nodeTemplatesModule } from "./node-templates";
import { textAlignModule } from "./text-align";
import { toolbarSizeModule } from "./toolbar-size";
import { variableBreakpointsModule } from "./variable-breakpoints";
import { layersModule } from "./layers";

/** Every feature module, in display order within its settings group. */
export const MODULES: readonly AnyModule[] = [
	betterDefaultsModule,
	directionModule,
	performanceModule,
	nodeShapesModule,
	nodeBordersModule,
	textAlignModule,
	autoResizeModule,
	customColorsModule,
	layersModule,
	nodeTemplatesModule,
	createGroupModule,
	variableBreakpointsModule,
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
	canvasCommandsModule,
	toolbarSizeModule,
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
	drawingModule,
	freeLinesModule,
	shapesModule,
	stickyNotesModule,
	floatingTextModule,
	infiniteLinesModule,
	imageCropModule,
	edgeEditingModule,
	lockItemsModule,
	minimapModule,
	gridModule,
	framesModule,
	boardTemplatesModule,
	kanbanModule,
	queryGroupsModule,
	diagnosticsModule,
];
