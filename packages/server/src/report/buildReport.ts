import sharp from "sharp";
import type { CompareReport, Marker, MismatchDetail, TierInfo, BBox } from "@app/shared";
import type { DiffRegion } from "../diff/clustering";
import type { MatchResult } from "../match/matchEngine";
import { describeMismatches, severityForMismatches } from "../match/compareProps";
import { checkImageContentMismatch } from "../match/imageContent";
import { regionLooksIdentical } from "../match/visualGate";
import { cropOneScreen, toDataUrl } from "../util/imageOps";

const MAX_MARKERS = 40;
const MIN_UNMATCHED_AREA = 400; // px^2 — filters noise from tiny/insignificant unmatched DOM nodes
// Figma's createImage() rejects images larger than 4096px on a side; stay a
// safe margin under that so the on-canvas report frame never fails to render.
const FIGMA_MAX_DIMENSION = 4000;

async function toScaledDataUrl(png: Buffer, scale: number): Promise<string> {
  if (scale >= 1) return toDataUrl(png);
  const meta = await sharp(png).metadata();
  const width = Math.max(1, Math.round((meta.width ?? 0) * scale));
  const height = Math.max(1, Math.round((meta.height ?? 0) * scale));
  const resized = await sharp(png).resize(width, height).png().toBuffer();
  return toDataUrl(resized);
}

function unionBBox(a: BBox, b: BBox): BBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

function bboxOverlaps(a: BBox, b: BBox): boolean {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return interArea > 0.3 * Math.min(a.width * a.height, b.width * b.height);
}

const CONTAINMENT_THRESHOLD = 0.8;

/** What fraction of `inner`'s own area sits inside `outer`. */
function containmentRatio(inner: BBox, outer: BBox): number {
  const x1 = Math.max(inner.x, outer.x);
  const y1 = Math.max(inner.y, outer.y);
  const x2 = Math.min(inner.x + inner.width, outer.x + outer.width);
  const y2 = Math.min(inner.y + inner.height, outer.y + outer.height);
  const interArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const innerArea = inner.width * inner.height;
  return innerArea > 0 ? interArea / innerArea : 0;
}

interface DraftMarker {
  bbox: BBox;
  title: string;
  explanations: MismatchDetail[];
  severity: Marker["severity"];
  kind: Marker["kind"];
}

export async function buildWebReport(params: {
  figmaPng: Buffer;
  actualPng: Buffer;
  regions: DiffRegion[];
  matchResult: MatchResult | null;
  tierInfo: TierInfo;
  figmaLayerCount: number;
}): Promise<CompareReport> {
  const { figmaPng, actualPng, regions, matchResult, tierInfo, figmaLayerCount } = params;
  const drafts: DraftMarker[] = [];

  if (matchResult) {
    for (const pair of matchResult.pairs) {
      const messages = describeMismatches(pair);

      if (pair.figmaLayer.hasImageFill && pair.domNode.hasImage) {
        const imageMismatch = await checkImageContentMismatch(figmaPng, actualPng, pair.figmaLayer.bbox);
        if (imageMismatch) messages.push(imageMismatch);
      }

      if (messages.length === 0) continue;

      const bbox = unionBBox(pair.figmaLayer.bbox, pair.domNode.bbox);
      // Metadata says something differs, but if the pixels in this exact spot
      // are indistinguishable, it isn't a real problem for whoever looks at
      // the screen — skip it instead of adding noise the developer can't act on.
      if (await regionLooksIdentical(figmaPng, actualPng, bbox)) continue;

      drafts.push({
        bbox,
        title:
          pair.figmaLayer.type === "TEXT"
            ? `Текст «${pair.figmaLayer.characters ?? pair.figmaLayer.name}»`
            : `Слой «${pair.figmaLayer.name}»`,
        explanations: messages,
        severity: severityForMismatches(messages),
        kind: "semantic",
      });
    }

    for (const layer of matchResult.unmatchedFigmaLayers) {
      if (layer.bbox.width * layer.bbox.height < 16) continue;
      // The matcher failed to pair this layer with a DOM node, but if the
      // pixels at its spot already look like the design, it's really there —
      // just missed by the name/text heuristic, not an actual defect.
      if (await regionLooksIdentical(figmaPng, actualPng, layer.bbox)) continue;
      const contentHint =
        layer.type === "TEXT" && layer.characters
          ? `Текст «${layer.characters}»`
          : layer.hasImageFill
            ? "Изображение"
            : null;
      const sizeHint = `${Math.round(layer.bbox.width)}×${Math.round(layer.bbox.height)}px`;
      drafts.push({
        bbox: layer.bbox,
        // "нет в реализации" carries the one fact that matters; the old
        // wording repeated it twice more ("отсутствует", "не найден") and
        // closed with a boilerplate "проверьте, реализован ли" on every one
        // of 30+ rows — the crop + dot annotation already say "look here",
        // so the detail line below only needs to add content that's new.
        title: `«${layer.name}» — нет в реализации`,
        explanations: [
          {
            // Concrete content (visible text / "this should be an image")
            // gives the developer something to search the page for, instead
            // of the layer's Figma name alone — names like ".Content" or
            // "Tab Stroke" mean nothing outside the design file.
            text: contentHint ? `${contentHint}, ${sizeHint}` : `Блок ${sizeHint}`,
            category: "structure",
            annotation: {
              kind: "dot",
              point: { x: layer.bbox.x + layer.bbox.width / 2, y: layer.bbox.y + layer.bbox.height / 2 },
            },
          },
        ],
        severity: "medium",
        kind: "missing-in-actual",
      });
    }

    // A real webpage's DOM nests many wrapper elements (div > div > span)
    // around a single piece of content. If the outer wrapper already matched
    // a Figma layer cleanly, the inner ones are just incidental markup, not
    // separate defects — and among the unmatched nodes themselves, a whole
    // extra block's inner elements shouldn't each get their own row either.
    // Largest-first + containment dedup keeps just one row per actual extra
    // region instead of one per nesting level.
    const matchedDomBoxes = matchResult.pairs.map((pair) => pair.domNode.bbox);
    const unmatchedByArea = [...matchResult.unmatchedDomNodes].sort(
      (a, b) => b.bbox.width * b.bbox.height - a.bbox.width * a.bbox.height
    );
    const acceptedExtraBoxes: BBox[] = [];

    for (const dom of unmatchedByArea) {
      if (dom.bbox.width * dom.bbox.height < MIN_UNMATCHED_AREA) continue;
      if (!dom.textContent && !dom.backgroundColor) continue;
      if (matchedDomBoxes.some((box) => containmentRatio(dom.bbox, box) > CONTAINMENT_THRESHOLD)) continue;
      if (acceptedExtraBoxes.some((box) => containmentRatio(dom.bbox, box) > CONTAINMENT_THRESHOLD)) continue;
      // Same reasoning as above, mirrored: if this spot looks like the
      // design already, it corresponds to something real in Figma that the
      // matcher just didn't pair up — not an extra element.
      if (await regionLooksIdentical(figmaPng, actualPng, dom.bbox)) continue;
      acceptedExtraBoxes.push(dom.bbox);
      const extraSizeHint = `${Math.round(dom.bbox.width)}×${Math.round(dom.bbox.height)}px`;
      drafts.push({
        bbox: dom.bbox,
        title: `Лишний элемент (${dom.tagName})`,
        explanations: [
          {
            text: dom.textContent ? `«${dom.textContent}», ${extraSizeHint} — нет в макете.` : `${extraSizeHint} — нет в макете.`,
            // Text content is the defining feature of the defect ("extra
            // copy that shouldn't be there") — file it under "Текст" so it
            // reads alongside other text issues instead of the generic
            // structure bucket, which should be reserved for whole extra
            // visual blocks that aren't fundamentally about wording.
            category: dom.textContent ? "text" : "structure",
            annotation: {
              kind: "dot",
              point: { x: dom.bbox.x + dom.bbox.width / 2, y: dom.bbox.y + dom.bbox.height / 2 },
            },
          },
        ],
        severity: "low",
        kind: "extra-in-actual",
      });
    }
  }

  for (const region of regions) {
    const alreadyExplained = drafts.some((d) => bboxOverlaps(d.bbox, region.bbox));
    if (alreadyExplained) continue;
    drafts.push({
      bbox: region.bbox,
      title: "Область пиксельного расхождения",
      explanations: [
        {
          text: matchResult
            ? "Визуальное отличие без точного соответствия слою Figma — проверьте эту область вручную."
            : "Пиксельное расхождение обнаружено в этой области (семантическое сопоставление недоступно для этого сравнения).",
          category: "other",
          annotation: {
            kind: "dot",
            point: { x: region.bbox.x + region.bbox.width / 2, y: region.bbox.y + region.bbox.height / 2 },
          },
        },
      ],
      severity: region.severity,
      kind: "pixel-region",
    });
  }

  // Share of Figma layers that exist in the implementation with nothing
  // flagged on them. Denominator is every layer the matcher actually tried to
  // place (matched + missing) — not the raw Figma layer count, which also
  // includes pure layout wrappers that were never candidates to begin with.
  // Uses the unsliced draft list (not the capped `markers` below) so a page
  // with more than MAX_MARKERS issues doesn't look artificially better just
  // because the overflow got trimmed from the visible report.
  const totalMatchable = (matchResult?.pairs.length ?? 0) + (matchResult?.unmatchedFigmaLayers.length ?? 0);
  const semanticIssueLayers = drafts.filter((d) => d.kind === "semantic").length;
  const cleanMatched = (matchResult?.pairs.length ?? 0) - semanticIssueLayers;
  const matchScore =
    totalMatchable > 0
      ? Math.round((100 * Math.max(0, cleanMatched)) / totalMatchable)
      : drafts.length === 0
        ? 100
        : Math.max(0, 100 - drafts.length * 5);

  const severityWeight: Record<Marker["severity"], number> = { high: 3, medium: 2, low: 1 };
  const top = drafts
    .sort((a, b) => {
      const w = severityWeight[b.severity] - severityWeight[a.severity];
      if (w !== 0) return w;
      return b.bbox.width * b.bbox.height - a.bbox.width * a.bbox.height;
    })
    .slice(0, MAX_MARKERS)
    .sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);

  const markers: Marker[] = await Promise.all(
    top.map(async (draft, i) => {
      const actualCrop = await cropOneScreen(actualPng, draft.bbox);
      return {
        number: i + 1,
        bbox: draft.bbox,
        actualCrop: actualCrop.dataUrl,
        cropInnerBox: actualCrop.innerBox,
        title: draft.title,
        explanations: draft.explanations,
        severity: draft.severity,
        kind: draft.kind,
      };
    })
  );

  const { width, height } = await sharp(figmaPng).metadata();
  const largestSide = Math.max(width ?? 0, height ?? 0);
  const scale = largestSide > FIGMA_MAX_DIMENSION ? FIGMA_MAX_DIMENSION / largestSide : 1;

  const figmaImage = await toScaledDataUrl(figmaPng, scale);
  const actualImage = await toScaledDataUrl(actualPng, scale);
  const scaledMarkers =
    scale < 1
      ? markers.map((m) => ({
          ...m,
          bbox: {
            x: m.bbox.x * scale,
            y: m.bbox.y * scale,
            width: m.bbox.width * scale,
            height: m.bbox.height * scale,
          },
        }))
      : markers;
  const scaleWarnings =
    scale < 1
      ? [
          `Изображения уменьшены до ${Math.round((width ?? 0) * scale)}×${Math.round(
            (height ?? 0) * scale
          )}px для показа в Figma (оригинал ${width}×${height}px превышает предел холста ~4096px). Кропы отдельных областей остаются в полном разрешении.`,
        ]
      : [];

  return {
    mode: "web",
    tierInfo: { ...tierInfo, warnings: [...tierInfo.warnings, ...scaleWarnings] },
    figmaImage,
    actualImage,
    markers: scaledMarkers,
    meta: {
      figmaLayerCount,
      matchedPairs: matchResult?.pairs.length ?? 0,
      unmatchedFigmaLayers: matchResult?.unmatchedFigmaLayers.length ?? 0,
      unmatchedActualNodes: matchResult?.unmatchedDomNodes.length ?? 0,
    },
    matchScore,
  };
}
