import type { BBox } from "@app/shared";
import { diffRegionRatio } from "../diff/regionDiff";

// Below this fraction of differing pixels in the pair's own region, treat any
// metadata differences (color right at the threshold edge, a font-family
// string that differs but resolves to the same rendered font, etc.) as noise
// that doesn't actually show up on screen — better to trust the pixels than
// the numbers when they disagree.
const VISUAL_DIFF_RATIO_THRESHOLD = 0.03;

export async function regionLooksIdentical(figmaPng: Buffer, actualPng: Buffer, bbox: BBox): Promise<boolean> {
  const ratio = await diffRegionRatio(figmaPng, actualPng, bbox);
  if (ratio === null) return false; // couldn't verify — safer to show than silently hide
  return ratio <= VISUAL_DIFF_RATIO_THRESHOLD;
}
