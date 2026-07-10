import { PNG } from "pngjs";

export interface DecodedImage {
  data: Buffer;
  width: number;
  height: number;
}

export function decodePng(buffer: Buffer): DecodedImage {
  const png = PNG.sync.read(buffer);
  return { data: png.data, width: png.width, height: png.height };
}

const COLOR_DISTANCE_THRESHOLD = 40; // euclidean distance in RGB space, 0-441

/** Boolean mask (1 = differing pixel), same length as width*height. */
export function buildDiffMask(a: DecodedImage, b: DecodedImage): { mask: Uint8Array; diffCount: number } {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("Images must be the same size before diffing");
  }
  const { width, height } = a;
  const mask = new Uint8Array(width * height);
  let diffCount = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const dr = a.data[o] - b.data[o];
    const dg = a.data[o + 1] - b.data[o + 1];
    const db = a.data[o + 2] - b.data[o + 2];
    const da = a.data[o + 3] - b.data[o + 3];
    const dist = Math.sqrt(dr * dr + dg * dg + db * db + da * da);
    if (dist > COLOR_DISTANCE_THRESHOLD) {
      mask[i] = 1;
      diffCount++;
    }
  }
  return { mask, diffCount };
}
