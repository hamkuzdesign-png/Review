import type { BBox, MismatchDetail } from "@app/shared";
import { diffRegionRatio } from "../diff/regionDiff";
import { cropRegion } from "../util/imageOps";

const IMAGE_DIFF_RATIO_THRESHOLD = 0.15; // >15% of pixels differing inside the object's own region => wrong picture

/**
 * Pixel-level check for "is this the right picture" — metadata alone (compareProps.ts)
 * can't tell a swapped logo from the correct one, so this crops both renders to the
 * Figma layer's own bbox and diffs just that region.
 */
export async function checkImageContentMismatch(
  figmaPng: Buffer,
  actualPng: Buffer,
  bbox: BBox
): Promise<MismatchDetail | null> {
  const ratio = await diffRegionRatio(figmaPng, actualPng, bbox);
  if (ratio === null || ratio <= IMAGE_DIFF_RATIO_THRESHOLD) return null;

  const expectedCrop = (await cropRegion(figmaPng, bbox)).dataUrl;
  return {
    text: "Неверное изображение: содержимое не совпадает с макетом → Заменить на изображение из макета",
    category: "image",
    annotation: { kind: "dot", point: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 } },
    expectedCrop,
  };
}
