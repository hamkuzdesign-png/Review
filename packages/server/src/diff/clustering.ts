import type { BBox, Severity } from "@app/shared";

export interface DiffRegion {
  bbox: BBox;
  pixelCount: number;
  severity: Severity;
}

const BLOCK_SIZE = 16;
const BLOCK_DENSITY_THRESHOLD = 0.15;
const MIN_AREA_FRACTION = 0.001; // discard regions smaller than 0.1% of image area
const MAX_REGIONS = 20;

/**
 * Clusters a per-pixel diff mask into a handful of readable bounding-box regions:
 * downsample to a block grid (density-thresholded), then flood-fill connected
 * blocks (8-connectivity), merging noise into a small number of coherent boxes
 * instead of thousands of single-pixel components.
 */
export function clusterDiffMask(mask: Uint8Array, width: number, height: number): DiffRegion[] {
  const cols = Math.ceil(width / BLOCK_SIZE);
  const rows = Math.ceil(height / BLOCK_SIZE);
  const blockDiffGrid = new Uint8Array(cols * rows);
  const blockPixelCounts = new Int32Array(cols * rows);

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * BLOCK_SIZE;
      const y0 = by * BLOCK_SIZE;
      const x1 = Math.min(x0 + BLOCK_SIZE, width);
      const y1 = Math.min(y0 + BLOCK_SIZE, height);
      let diffPixels = 0;
      const total = (x1 - x0) * (y1 - y0);
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          if (mask[y * width + x]) diffPixels++;
        }
      }
      const blockIdx = by * cols + bx;
      blockPixelCounts[blockIdx] = diffPixels;
      blockDiffGrid[blockIdx] = diffPixels / total > BLOCK_DENSITY_THRESHOLD ? 1 : 0;
    }
  }

  const visited = new Uint8Array(cols * rows);
  const regions: DiffRegion[] = [];

  for (let start = 0; start < cols * rows; start++) {
    if (!blockDiffGrid[start] || visited[start]) continue;

    const stack = [start];
    visited[start] = 1;
    let minBx = start % cols;
    let maxBx = start % cols;
    let minBy = Math.floor(start / cols);
    let maxBy = Math.floor(start / cols);
    let pixelCount = 0;

    while (stack.length > 0) {
      const idx = stack.pop()!;
      const bx = idx % cols;
      const by = Math.floor(idx / cols);
      pixelCount += blockPixelCounts[idx];
      minBx = Math.min(minBx, bx);
      maxBx = Math.max(maxBx, bx);
      minBy = Math.min(minBy, by);
      maxBy = Math.max(maxBy, by);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = bx + dx;
          const ny = by + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nIdx = ny * cols + nx;
          if (blockDiffGrid[nIdx] && !visited[nIdx]) {
            visited[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
    }

    const bbox: BBox = {
      x: minBx * BLOCK_SIZE,
      y: minBy * BLOCK_SIZE,
      width: Math.min((maxBx - minBx + 1) * BLOCK_SIZE, width - minBx * BLOCK_SIZE),
      height: Math.min((maxBy - minBy + 1) * BLOCK_SIZE, height - minBy * BLOCK_SIZE),
    };

    const areaFraction = (bbox.width * bbox.height) / (width * height);
    if (areaFraction < MIN_AREA_FRACTION) continue;

    regions.push({ bbox, pixelCount, severity: severityFor(areaFraction) });
  }

  return regions
    .sort((a, b) => b.pixelCount - a.pixelCount)
    .slice(0, MAX_REGIONS);
}

function severityFor(areaFraction: number): Severity {
  if (areaFraction > 0.05) return "high";
  if (areaFraction > 0.01) return "medium";
  return "low";
}
