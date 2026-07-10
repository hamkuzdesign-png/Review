import sharp from "sharp";
import type { BBox } from "@app/shared";
import { decodePng, buildDiffMask } from "./pixelDiff";

/** Fraction of differing pixels within `bbox`, comparing the same region cropped from both renders. Null if the region couldn't be extracted (e.g. bbox outside image bounds). */
export async function diffRegionRatio(figmaPng: Buffer, actualPng: Buffer, bbox: BBox): Promise<number | null> {
  try {
    const meta = await sharp(figmaPng).metadata();
    const imgWidth = meta.width ?? bbox.x + bbox.width;
    const imgHeight = meta.height ?? bbox.y + bbox.height;

    const left = Math.max(0, Math.floor(bbox.x));
    const top = Math.max(0, Math.floor(bbox.y));
    const width = Math.max(1, Math.min(Math.round(bbox.width), imgWidth - left));
    const height = Math.max(1, Math.min(Math.round(bbox.height), imgHeight - top));

    const [figmaRegion, actualRegion] = await Promise.all([
      sharp(figmaPng).extract({ left, top, width, height }).png().toBuffer(),
      sharp(actualPng).extract({ left, top, width, height }).png().toBuffer(),
    ]);

    const { mask, diffCount } = buildDiffMask(decodePng(figmaRegion), decodePng(actualRegion));
    return diffCount / mask.length;
  } catch {
    return null;
  }
}
