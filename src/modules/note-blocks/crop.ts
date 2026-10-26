import { Modal, Setting, type App } from "obsidian";
import type { Translate } from "../../i18n";

export type CropShape = "circle" | "square";

/** Size (px) of the stored handle image. */
export const IMAGE_SIZE = 64;
/** Size (px) of the crop frame on screen. */
const FRAME = 240;
/** Farthest zoom-in, relative to the scale that just covers the frame. */
const MAX_ZOOM = 6;

/** Loads an image file into an element (any format the browser can draw). */
export async function loadImage(file: File): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(file);
	try {
		const img = new Image();
		img.src = url;
		await img.decode();
		return img;
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** Where the image sits in the frame: its scale and the frame-space position of its top left. */
interface View {
	scale: number;
	x: number;
	y: number;
}

/** Draws the image as placed in a frame of `size` px (the frame being FRAME px on screen). */
function draw(g: CanvasRenderingContext2D, img: HTMLImageElement, v: View, size: number, shape: CropShape | null): void {
	const k = size / FRAME;
	g.clearRect(0, 0, size, size);
	g.save();
	if (shape === "circle") {
		g.beginPath();
		g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
		g.clip();
	}
	g.drawImage(img, v.x * k, v.y * k, img.naturalWidth * v.scale * k, img.naturalHeight * v.scale * k);
	g.restore();
}

/**
 * Crop a picked image for the drag handle: a circle or a square, moved by dragging and sized by
 * the slider or the wheel. Resolves to a PNG data URL (IMAGE_SIZE px), or null when cancelled.
 */
export class CropModal extends Modal {
	private shape: CropShape = "circle";
	private view: View;
	private readonly cover: number;
	private done = false;

	constructor(
		app: App,
		private readonly t: Translate,
		private readonly img: HTMLImageElement,
		private readonly onDone: (url: string | null) => void,
	) {
		super(app);
		const w = img.naturalWidth || FRAME;
		const h = img.naturalHeight || FRAME;
		this.cover = FRAME / Math.min(w, h);
		this.view = { scale: this.cover, x: (FRAME - w * this.cover) / 2, y: (FRAME - h * this.cover) / 2 };
	}

	override onOpen(): void {
		const { t, contentEl } = this;
		this.setTitle(t("noteBlocks.crop.title"));
		this.modalEl.addClass("opc-crop-modal");
		contentEl.createEl("p", { cls: "setting-item-description", text: t("noteBlocks.crop.hint") });

		const stage = contentEl.createDiv({ cls: "opc-crop-stage" });
		const canvas = stage.createEl("canvas", { attr: { width: String(FRAME * 2), height: String(FRAME * 2) } });
		const mask = stage.createDiv({ cls: "opc-crop-mask" });
		const g = canvas.getContext("2d");
		const render = () => {
			if (!g) return;
			// Drawn at twice the size for sharp edges; the mask shows the shape.
			g.setTransform(2, 0, 0, 2, 0, 0);
			draw(g, this.img, this.view, FRAME, null);
			mask.toggleClass("is-circle", this.shape === "circle");
		};

		const clamp = () => {
			// The frame always stays covered by the image.
			const w = this.img.naturalWidth * this.view.scale;
			const h = this.img.naturalHeight * this.view.scale;
			this.view.x = Math.min(0, Math.max(FRAME - w, this.view.x));
			this.view.y = Math.min(0, Math.max(FRAME - h, this.view.y));
		};
		let slider: HTMLInputElement | null = null;
		const zoomTo = (zoom: number, cx = FRAME / 2, cy = FRAME / 2) => {
			const next = this.cover * Math.min(MAX_ZOOM, Math.max(1, zoom));
			const k = next / this.view.scale;
			this.view = { scale: next, x: cx - (cx - this.view.x) * k, y: cy - (cy - this.view.y) * k };
			clamp();
			if (slider) slider.value = String(next / this.cover);
			render();
		};

		// Drag to move (mouse, touch or pen).
		let drag: { id: number; x: number; y: number } | null = null;
		stage.addEventListener("pointerdown", (e) => {
			drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
			stage.setPointerCapture(e.pointerId);
			e.preventDefault();
		});
		stage.addEventListener("pointermove", (e) => {
			if (!drag || e.pointerId !== drag.id) return;
			const r = stage.getBoundingClientRect();
			const k = FRAME / (r.width || FRAME);
			this.view.x += (e.clientX - drag.x) * k;
			this.view.y += (e.clientY - drag.y) * k;
			drag.x = e.clientX;
			drag.y = e.clientY;
			clamp();
			render();
		});
		const end = (e: PointerEvent) => {
			if (drag?.id === e.pointerId) drag = null;
		};
		stage.addEventListener("pointerup", end);
		stage.addEventListener("pointercancel", end);
		stage.addEventListener(
			"wheel",
			(e) => {
				e.preventDefault();
				const r = stage.getBoundingClientRect();
				const k = FRAME / (r.width || FRAME);
				zoomTo((this.view.scale / this.cover) * Math.exp(-e.deltaY / 400), (e.clientX - r.left) * k, (e.clientY - r.top) * k);
			},
			{ passive: false },
		);

		new Setting(contentEl).setName(t("noteBlocks.crop.shape")).addDropdown((d) =>
			d
				.addOption("circle", t("noteBlocks.crop.circle"))
				.addOption("square", t("noteBlocks.crop.square"))
				.setValue(this.shape)
				.onChange((v) => {
					this.shape = v === "square" ? "square" : "circle";
					render();
				}),
		);
		new Setting(contentEl).setName(t("noteBlocks.crop.zoom")).addSlider((s) => {
			slider = s.sliderEl;
			s.setLimits(1, MAX_ZOOM, 0.01)
				.setValue(1)
				.onChange((v) => zoomTo(v));
		});
		new Setting(contentEl)
			.addButton((b) => b.setButtonText(t("common.cancel")).onClick(() => this.close()))
			.addButton((b) =>
				b
					.setButtonText(t("common.apply"))
					.setCta()
					.onClick(() => {
						this.done = true;
						const out = contentEl.createEl("canvas", { attr: { width: String(IMAGE_SIZE), height: String(IMAGE_SIZE) } });
						const og = out.getContext("2d");
						if (og) draw(og, this.img, this.view, IMAGE_SIZE, this.shape);
						const url = out.toDataURL("image/png");
						out.remove();
						this.close();
						this.onDone(url);
					}),
			);
		render();
	}

	override onClose(): void {
		this.contentEl.empty();
		if (!this.done) this.onDone(null);
	}
}
