import sharp from "sharp";
import type { BBox } from "@app/shared";

export async function resizeToMatch(png: Buffer, width: number, height: number): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  if (meta.width === width && meta.height === height) return png;
  return sharp(png).resize(width, height, { fit: "fill" }).png().toBuffer();
}

// A flat 8px padding left almost no surrounding context (couldn't tell where
// on the screen the object was), but scaling off the object's LARGER side
// blew up for wide-but-short elements (e.g. a full-width headline) until the
// crop was nearly the whole screen — every row ended up showing basically the
// same giant chunk, burying the actual marker. Scaling off the SMALLER side
// instead keeps padding proportionate to the object's actual visual scale.
const CROP_PADDING_RATIO = 0.5;
const MIN_CROP_PADDING = 24;
const MAX_CROP_PADDING = 80;

export interface CropResult {
  dataUrl: string;
  /** Where the original bbox sits within the returned crop — clamping near image edges can make the padding asymmetric, so this can't be assumed to always equal the nominal padding. */
  innerBox: BBox;
}

export async function cropRegion(png: Buffer, bbox: BBox): Promise<CropResult> {
  const meta = await sharp(png).metadata();
  const imgWidth = meta.width ?? bbox.x + bbox.width;
  const imgHeight = meta.height ?? bbox.y + bbox.height;

  const padding = Math.min(
    MAX_CROP_PADDING,
    Math.max(MIN_CROP_PADDING, Math.round(Math.min(bbox.width, bbox.height) * CROP_PADDING_RATIO))
  );

  const left = Math.max(0, Math.floor(bbox.x - padding));
  const top = Math.max(0, Math.floor(bbox.y - padding));
  const right = Math.min(imgWidth, Math.ceil(bbox.x + bbox.width + padding));
  const bottom = Math.min(imgHeight, Math.ceil(bbox.y + bbox.height + padding));

  const cropped = await sharp(png)
    .extract({ left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) })
    .png()
    .toBuffer();

  return {
    dataUrl: `data:image/png;base64,${cropped.toString("base64")}`,
    innerBox: { x: bbox.x - left, y: bbox.y - top, width: bbox.width, height: bbox.height },
  };
}

// One "screen" worth of vertical scroll — a typical mobile viewport height.
// Used so a long scrolling page doesn't get screenshotted in full for every
// single fix (impossible to tell where anything is), but a normal one-screen
// comparison still shows the whole screen rather than a tight zoomed-in box.
const SCREEN_HEIGHT = 900;

/**
 * Crops the full image width, and a height capped at one "screen" (or the
 * whole image if it's shorter than that), vertically centered on the bbox.
 * This is what's shown as the main "Скрин" reference per row — full context
 * of where the object sits on the screen, without dragging in unrelated
 * scroll positions from a long page.
 */
export async function cropOneScreen(png: Buffer, bbox: BBox): Promise<CropResult> {
  const meta = await sharp(png).metadata();
  const imgWidth = meta.width ?? bbox.x + bbox.width;
  const imgHeight = meta.height ?? bbox.y + bbox.height;

  const height = Math.min(imgHeight, SCREEN_HEIGHT);
  const bboxCenterY = bbox.y + bbox.height / 2;
  const top = Math.max(0, Math.min(Math.round(bboxCenterY - height / 2), imgHeight - height));

  const cropped = await sharp(png)
    .extract({ left: 0, top, width: imgWidth, height })
    .png()
    .toBuffer();

  return {
    dataUrl: `data:image/png;base64,${cropped.toString("base64")}`,
    innerBox: { x: bbox.x, y: bbox.y - top, width: bbox.width, height: bbox.height },
  };
}

export function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}
