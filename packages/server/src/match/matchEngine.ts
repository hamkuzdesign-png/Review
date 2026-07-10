import type { BBox, LayerNode, DomNode } from "@app/shared";

export interface MatchedPair {
  figmaLayer: LayerNode;
  domNode: DomNode;
}

export interface MatchResult {
  pairs: MatchedPair[];
  unmatchedFigmaLayers: LayerNode[];
  unmatchedDomNodes: DomNode[];
}

const CONTAINER_TYPES = new Set(["FRAME", "GROUP", "SECTION", "INSTANCE"]);
const TEXT_SIMILARITY_THRESHOLD = 0.85;
const MIN_IMAGE_IOU_THRESHOLD = 0.2;

/**
 * Pure layout wrappers (frames/groups/instances with no fill of their own)
 * are skipped as match candidates. INSTANCE matters here as much as
 * FRAME/GROUP: component-instance "slots" (e.g. a positioning wrapper around
 * a nested icon-badge instance) are common in design-system files, and if
 * the outer slot isn't filtered, it shows up as its own "missing" layer
 * alongside the real icon it merely wraps — one visual element reported as
 * two, even though the actual page renders it correctly. Only the fill-less
 * wrapper is skipped; its children (including the real nested instance) are
 * still visited and stay eligible.
 * "No fill" must check both fillColor AND hasImageFill — fillColor is only
 * populated for solid fills, so a layer with an IMAGE paint (a photo, an
 * illustration, a rounded avatar) has no fillColor either. Checking
 * fillColor alone wrongly treated every image-filled instance as an empty
 * wrapper and dropped it from matching entirely — which is why the
 * "Изображения" category (and image-filled rounded layers feeding
 * "Скругление") disappeared once INSTANCE was added here.
 * The root selection itself is also excluded: it represents the whole
 * compared screen, not an individual element with a natural DOM counterpart,
 * so it should never show up as "missing in the implementation".
 */
function flattenMatchableLayers(root: LayerNode): LayerNode[] {
  const result: LayerNode[] = [];
  function visit(node: LayerNode) {
    const isPureContainer = CONTAINER_TYPES.has(node.type) && !node.fillColor && !node.hasImageFill;
    if (!isPureContainer) result.push(node);
    for (const child of node.children ?? []) visit(child);
  }
  for (const child of root.children ?? []) visit(child);
  return result;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9а-яё]+/gi, "");
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function textSimilarity(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function iou(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const unionArea = a.width * a.height + b.width * b.height - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}

const MAX_MATCH_DISTANCE_RATIO = 3;

/**
 * Name/id/class and text-similarity matches carry no positional signal on
 * their own — a generic layer name ("Button") or a repeated label ("Подробнее")
 * can exist in several unrelated places on the same page. Without this check,
 * the matcher would confidently pair, say, an "Open account" button with a
 * "Debit card" button just because both are named "Button" in Figma and share
 * a CSS class in the DOM, producing a nonsense "wrong text" mismatch between
 * two different elements. Requiring the candidate boxes to actually overlap,
 * or at least sit within a few box-widths of each other, keeps name/text
 * matches scoped to "the same element rendered differently" instead of "two
 * different elements that happen to share a label".
 */
function boxesArePlausiblePair(a: BBox, b: BBox): boolean {
  if (iou(a, b) > 0) return true;
  const dist = Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
  const scale = Math.max(a.width, a.height, b.width, b.height, 1);
  return dist <= scale * MAX_MATCH_DISTANCE_RATIO;
}

/**
 * Three-tier greedy matching, in priority order: exact name/id/data-testid
 * key, then text-content similarity, then image-to-image position proximity.
 * Each tier only considers candidates left unmatched by the earlier one, and
 * a match removes both sides so the result stays 1:1. The first two tiers
 * additionally require the candidates to be positionally plausible (see
 * boxesArePlausiblePair) so a generic shared name/class/label can't pair up
 * two unrelated elements that just happen to sit in different parts of the
 * page.
 *
 * There is deliberately no *generic* "nearest bbox" fallback for arbitrary
 * elements: guessing a pair by proximity alone produced confident-looking
 * property mismatches ("wrong color", "wrong padding") for objects that were
 * never really the same element. But image-bearing layers (logos, photos,
 * icons) have no name match or text to go on either, so without *some*
 * positional pairing the image-content check never runs at all — the tier
 * below is scoped narrowly to pairs where both sides are already flagged as
 * "a picture belongs here" (hasImageFill / hasImage), where a position match
 * is a meaningful signal rather than a guess.
 */
export function matchLayers(figmaRoot: LayerNode, domNodes: DomNode[]): MatchResult {
  const figmaLayers = flattenMatchableLayers(figmaRoot);
  const remainingFigma = new Set(figmaLayers);
  const remainingDom = new Set(domNodes);
  const pairs: MatchedPair[] = [];

  for (const layer of figmaLayers) {
    if (!remainingFigma.has(layer)) continue;
    const key = normalizeKey(layer.name);
    if (!key) continue;
    for (const dom of remainingDom) {
      const domKeys = [dom.id, dom.testId, ...(dom.className ? dom.className.split(/\s+/) : [])]
        .filter((v): v is string => !!v)
        .map(normalizeKey);
      if (domKeys.includes(key) && boxesArePlausiblePair(layer.bbox, dom.bbox)) {
        pairs.push({ figmaLayer: layer, domNode: dom });
        remainingFigma.delete(layer);
        remainingDom.delete(dom);
        break;
      }
    }
  }

  for (const layer of figmaLayers) {
    if (!remainingFigma.has(layer)) continue;
    if (layer.type !== "TEXT" || !layer.characters) continue;
    const normalizedLayerText = normalizeText(layer.characters);
    let bestDom: DomNode | null = null;
    let bestScore = 0;
    for (const dom of remainingDom) {
      if (!dom.textContent) continue;
      if (!boxesArePlausiblePair(layer.bbox, dom.bbox)) continue;
      const score = textSimilarity(normalizedLayerText, normalizeText(dom.textContent));
      if (score > bestScore) {
        bestScore = score;
        bestDom = dom;
      }
    }
    if (bestDom && bestScore >= TEXT_SIMILARITY_THRESHOLD) {
      pairs.push({ figmaLayer: layer, domNode: bestDom });
      remainingFigma.delete(layer);
      remainingDom.delete(bestDom);
    }
  }

  for (const layer of figmaLayers) {
    if (!remainingFigma.has(layer)) continue;
    if (!layer.hasImageFill) continue;
    let bestDom: DomNode | null = null;
    let bestIou = 0;
    for (const dom of remainingDom) {
      if (!dom.hasImage) continue;
      const score = iou(layer.bbox, dom.bbox);
      if (score > bestIou) {
        bestIou = score;
        bestDom = dom;
      }
    }
    if (bestDom && bestIou >= MIN_IMAGE_IOU_THRESHOLD) {
      pairs.push({ figmaLayer: layer, domNode: bestDom });
      remainingFigma.delete(layer);
      remainingDom.delete(bestDom);
    }
  }

  return {
    pairs,
    unmatchedFigmaLayers: [...remainingFigma],
    unmatchedDomNodes: [...remainingDom],
  };
}
