import { Modal, TFile, type App } from "obsidian";
import { defineModule } from "../../core/module";
import type { CropRect, OpcNode } from "../../data/schema";
import type { Translate } from "../../i18n";
import type { CanvasLike, CanvasNodeLike } from "../../internals/types";
import { capturePointer, mutate, nodeType, onlyNodes } from "../shared";
import { centeredRect, clampRect, croppedRatio, dragRect, FULL, isFull, roundRect, type Handle } from "./crop";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function isImageNode(node: CanvasNodeLike): boolean {
	return nodeType(node) === "file" && node.file instanceof TFile && IMAGE_EXTENSIONS.has(node.file.extension.toLowerCase());
}

function imgOf(node: CanvasNodeLike): HTMLImageElement | null {
	const el = node.contentEl?.firstElementChild;
	return el instanceof HTMLImageElement ? el : null;
}

function naturalRatio(node: CanvasNodeLike): number | null {
	const img = imgOf(node);
	return img && img.naturalHeight ? img.naturalWidth / img.naturalHeight : null;
}

function render(node: CanvasNodeLike, crop: CropRect | null): void {
	const el = node.nodeEl;
	if (!crop) {
		if (!el.hasAttribute("data-opc-crop")) return;
		el.removeAttribute("data-opc-crop");
		for (const k of ["x", "y", "w", "h"]) el.style.removeProperty(`--opc-crop-${k}`);
		return;
	}
	el.setAttribute("data-opc-crop", "");
	el.style.setProperty("--opc-crop-x", String(crop.x));
	el.style.setProperty("--opc-crop-y", String(crop.y));
	el.style.setProperty("--opc-crop-w", String(crop.w));
	el.style.setProperty("--opc-crop-h", String(crop.h));
}

class CropModal extends Modal {
	private rect: CropRect;
	private ratio: number | null = null;
	private frame!: HTMLElement;
	private box!: HTMLElement;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly src: string,
		private readonly natural: number,
		initial: CropRect,
		private readonly onDone: (rect: CropRect) => void,
	) {
		super(app);
		this.rect = initial;
	}

	override onOpen(): void {
		const { t } = this;
		this.modalEl.addClass("opc-crop-modal");
		this.setTitle(t("imageCrop.title"));
		const presets = this.contentEl.createDiv({ cls: "opc-crop-presets" });
		const preset = (label: string, ratio: number | null) => {
			const b = presets.createEl("button", { text: label });
			b.addEventListener("click", () => {
				this.ratio = ratio;
				presets.querySelectorAll("button").forEach((x) => x.removeClass("mod-cta"));
				b.addClass("mod-cta");
				if (ratio) this.rect = centeredRect(ratio, this.natural);
				this.update();
			});
			if (ratio === null) b.addClass("mod-cta");
		};
		preset(t("imageCrop.free"), null);
		preset("1:1", 1);
		preset("4:3", 4 / 3);
		preset("3:4", 3 / 4);
		preset("16:9", 16 / 9);
		preset(t("imageCrop.original"), this.natural);

		this.frame = this.contentEl.createDiv({ cls: "opc-crop-frame" });
		this.frame.createEl("img", { attr: { src: this.src, draggable: "false" } });
		this.box = this.frame.createDiv({ cls: "opc-crop-box" });
		this.box.addEventListener("pointerdown", (e) => this.drag(e, "move"));
		for (const h of HANDLES) {
			const el = this.box.createDiv({ cls: `opc-crop-handle mod-${h}` });
			el.addEventListener("pointerdown", (e) => {
				e.stopPropagation();
				this.drag(e, h);
			});
		}
		this.update();

		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		buttons.createEl("button", { text: t("imageCrop.reset") }).addEventListener("click", () => {
			this.rect = FULL;
			this.update();
		});
		buttons.createEl("button", { text: t("imageCrop.cancel") }).addEventListener("click", () => this.close());
		buttons.createEl("button", { text: t("imageCrop.apply"), cls: "mod-cta" }).addEventListener("click", () => {
			this.onDone(roundRect(this.rect));
			this.close();
		});
	}

	private update(): void {
		const r = this.rect;
		Object.assign(this.box.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
	}

	private drag(evt: PointerEvent, handle: Handle): void {
		if (evt.button !== 0) return;
		evt.preventDefault();
		const target = evt.currentTarget as HTMLElement;
		capturePointer(target, evt.pointerId);
		const start = { ...this.rect };
		const bounds = this.frame.getBoundingClientRect();
		const x0 = evt.clientX;
		const y0 = evt.clientY;
		const move = (e: PointerEvent) => {
			const dx = (e.clientX - x0) / bounds.width;
			const dy = (e.clientY - y0) / bounds.height;
			this.rect = dragRect(start, handle, dx, dy, this.ratio ? { ratio: this.ratio, natural: this.natural } : undefined);
			this.update();
		};
		const up = () => {
			target.removeEventListener("pointermove", move);
			target.removeEventListener("pointerup", up);
			target.removeEventListener("pointercancel", up);
		};
		target.addEventListener("pointermove", move);
		target.addEventListener("pointerup", up);
		target.addEventListener("pointercancel", up);
	}
}

/**
 * Non-destructive image cropping: the crop is stored in x-opc.crop, the file is untouched.
 * The card keeps the cropped aspect ratio when resized. Other apps show the full image.
 */
export const imageCropModule = defineModule({
	id: "image-crop",
	name: "imageCrop.name",
	description: "imageCrop.desc",
	group: "nodes",
	defaultEnabled: true,
	defaultSettings: {},

	enable(ctx) {
		const cropOf = (extra: OpcNode) => (extra.crop && !isFull(extra.crop) ? clampRect(extra.crop) : null);
		/** Aspect ratio we set per node (the core resets it to the image's own ratio on load). */
		const applied = new WeakMap<CanvasNodeLike, number>();

		ctx.decorateNodes({
			apply: (node, extra) => {
				const crop = isImageNode(node) ? cropOf(extra) : null;
				render(node, crop);
				// Keep resize ratio in sync when the crop changes after load.
				const natural = naturalRatio(node);
				if (natural && crop) {
					node.aspectRatio = croppedRatio(natural, crop);
					applied.set(node, node.aspectRatio);
				} else if (natural && !crop && applied.has(node)) {
					node.aspectRatio = natural;
					applied.delete(node);
				}
			},
			clear: (node) => {
				render(node, null);
				const natural = naturalRatio(node);
				if (natural && applied.has(node)) node.aspectRatio = natural;
				applied.delete(node);
			},
		});

		// When the image loads the core sets the image's own ratio and refits the card to it:
		// switch to the cropped ratio and keep the stored size instead.
		ctx.intercept("node-move", (node, rect) => {
			if (!node.aspectRatio || applied.get(node) === node.aspectRatio || !isImageNode(node)) return undefined;
			const crop = cropOf(ctx.data.node(node).get());
			if (!crop) return undefined;
			node.aspectRatio = croppedRatio(node.aspectRatio, crop);
			applied.set(node, node.aspectRatio);
			return rect.x === node.x && rect.y === node.y ? true : undefined;
		});

		const setCrop = (canvas: CanvasLike, node: CanvasNodeLike, rect: CropRect) => {
			const natural = naturalRatio(node);
			const crop = isFull(rect) ? null : rect;
			mutate(ctx, canvas, () => {
				ctx.data.node(node).set({ crop: crop ?? undefined });
				if (natural) {
					const ratio = crop ? croppedRatio(natural, crop) : natural;
					node.aspectRatio = ratio;
					applied.set(node, ratio);
					node.moveAndResize({ x: node.x, y: node.y, width: node.width, height: Math.round(node.width / ratio) });
				}
			});
		};

		const openEditor = (canvas: CanvasLike, node: CanvasNodeLike) => {
			const img = imgOf(node);
			const natural = naturalRatio(node);
			if (!img || !natural) return;
			new CropModal(ctx.app, ctx.t, img.src, natural, ctx.data.node(node).get().crop ?? FULL, (rect) => setCrop(canvas, node, rect)).open();
		};

		const single = (selection: Parameters<typeof onlyNodes>[0]) => {
			const nodes = onlyNodes(selection);
			return nodes?.length === 1 && isImageNode(nodes[0]!) ? nodes[0]! : null;
		};
		ctx.addMenuButton({
			id: "crop",
			icon: "crop",
			tooltip: () => ctx.t("imageCrop.button"),
			order: 40,
			isVisible: (selection) => !!single(selection),
			isActive: (selection) => {
				const n = single(selection);
				return !!n && !!cropOf(ctx.data.node(n).get());
			},
			onClick: ({ canvas, selection }) => {
				const node = single(selection);
				if (node) openEditor(canvas, node);
			},
		});
		ctx.onNodeMenu((menu, node) => {
			if (node.canvas.readonly || !isImageNode(node)) return;
			menu.addItem((item) => item.setTitle(ctx.t("imageCrop.button")).setIcon("crop").onClick(() => openEditor(node.canvas, node)));
			if (cropOf(ctx.data.node(node).get())) menu.addItem((item) => item.setTitle(ctx.t("imageCrop.reset")).setIcon("rotate-ccw").onClick(() => setCrop(node.canvas, node, FULL)));
		});
	},
});

