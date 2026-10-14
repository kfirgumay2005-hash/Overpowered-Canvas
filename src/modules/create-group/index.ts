import { defineModule } from "../../core/module";
import type { CanvasLike, Point } from "../../internals/types";
import { mutate } from "../shared";

const SIZE = { width: 400, height: 300 };

/** An empty group from the card menu (click or drag), without having to select nodes first. */
export const createGroupModule = defineModule({
	id: "create-group",
	name: "createGroup.name",
	description: "createGroup.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},
	overlapsWith: ["advanced-canvas"],

	enable(ctx) {
		const create = (canvas: CanvasLike, pos: Point, centered: boolean) =>
			mutate(ctx, canvas, () => {
				canvas.deselectAll();
				canvas.createGroupNode({ pos, size: SIZE, ...(centered ? { position: "center" } : {}), save: false });
			});

		ctx.addCardMenuButton({
			id: "create-group",
			icon: "box-select",
			tooltip: () => ctx.t("createGroup.button"),
			order: 100,
			onClick: (canvas) => create(canvas, canvas.posCenter(), true),
			drag: { size: () => SIZE, drop: (canvas, pos) => create(canvas, pos, false) },
		});

		ctx.addCommand({
			id: "create-empty-group",
			name: ctx.t("createGroup.button"),
			icon: "box-select",
			checkCallback: (checking) => {
				const canvas = ctx.activeCanvas();
				if (!canvas || canvas.readonly) return false;
				if (!checking) create(canvas, canvas.posCenter(), true);
				return true;
			},
		});
	},
});
