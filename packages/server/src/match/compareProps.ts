import type { BBox, MismatchDetail, Point, Severity } from "@app/shared";
import type { MatchedPair } from "./matchEngine";
import { colorDistance } from "../util/color";

const SIZE_TOLERANCE = 2;
const FONT_SIZE_TOLERANCE = 1;
const FONT_WEIGHT_TOLERANCE = 100;
const RADIUS_TOLERANCE = 1;
const PADDING_TOLERANCE = 2;
const COLOR_DISTANCE_TOLERANCE = 30;

function normalizeFontFamily(family: string): string {
  return family
    .toLowerCase()
    .replace(/[-_](regular|bold|medium|semibold|light|italic)$/i, "")
    .trim();
}

function normalizeTextForCompare(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function centerOf(bbox: BBox): Point {
  return { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
}

/** Dimension line spanning the actual (wrong) padding amount, inward from that edge. */
function paddingAnnotation(bbox: BBox, side: "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft", amount: number) {
  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  let from: Point;
  let to: Point;
  switch (side) {
    case "paddingTop":
      from = { x: cx, y: bbox.y };
      to = { x: cx, y: bbox.y + amount };
      break;
    case "paddingBottom":
      from = { x: cx, y: bbox.y + bbox.height - amount };
      to = { x: cx, y: bbox.y + bbox.height };
      break;
    case "paddingLeft":
      from = { x: bbox.x, y: cy };
      to = { x: bbox.x + amount, y: cy };
      break;
    case "paddingRight":
      from = { x: bbox.x + bbox.width - amount, y: cy };
      to = { x: bbox.x + bbox.width, y: cy };
      break;
  }
  return { kind: "dimension" as const, from, to };
}

/**
 * Compares one matched Figma-layer/DOM-node pair on metadata alone (no pixel
 * buffers here — see imageContent.ts for the pixel-level "is this the right
 * picture" check) and returns Russian mismatch descriptions, one per distinct
 * property, in the format "Неверный <свойство>: <что сейчас> → Заменить на
 * <что должно быть>", each tagged with a category and an on-image annotation
 * (dot / dimension line / corner outline) so the developer can see exactly
 * which object and which measurement is being talked about.
 */
export function describeMismatches(pair: MatchedPair): MismatchDetail[] {
  const { figmaLayer: f, domNode: d } = pair;
  const details: MismatchDetail[] = [];

  if (f.hasImageFill && !d.hasImage) {
    details.push({
      text: "Здесь должно быть изображение (например, лого или картинка) → В реализации на этом месте изображения нет",
      category: "image",
      annotation: { kind: "dot", point: centerOf(d.bbox) },
    });
  }

  if (f.type === "TEXT" && f.characters && d.textContent) {
    if (normalizeTextForCompare(f.characters) !== normalizeTextForCompare(d.textContent)) {
      details.push({
        text: `Неверный текст: «${d.textContent}» → Заменить на «${f.characters}»`,
        category: "text",
        annotation: { kind: "dot", point: centerOf(d.bbox) },
      });
    }
  }

  const actualColor = f.type === "TEXT" ? d.color : d.backgroundColor;
  if (!f.hasImageFill && f.fillColor && actualColor && colorDistance(f.fillColor, actualColor) > COLOR_DISTANCE_TOLERANCE) {
    const label = f.type === "TEXT" ? "цвет текста" : "цвет фона";
    details.push({
      text: `Неверный ${label}: ${actualColor} → Заменить на ${f.fillColor}`,
      category: "color",
      annotation: { kind: "dot", point: centerOf(d.bbox) },
    });
  }

  const sizeCategory = f.hasImageFill ? "image" : "size";
  const sizeSubject = f.hasImageFill ? "изображения" : "блока";
  const cx = d.bbox.x + d.bbox.width / 2;
  const cy = d.bbox.y + d.bbox.height / 2;
  const dw = d.bbox.width - f.bbox.width;
  if (Math.abs(dw) > SIZE_TOLERANCE) {
    details.push({
      text: `Неверная ширина ${sizeSubject}: ${Math.round(d.bbox.width)}px → Заменить на ${Math.round(f.bbox.width)}px`,
      category: sizeCategory,
      annotation: {
        kind: "dimension",
        from: { x: d.bbox.x, y: cy },
        to: { x: d.bbox.x + d.bbox.width, y: cy },
      },
    });
  }
  const dh = d.bbox.height - f.bbox.height;
  if (Math.abs(dh) > SIZE_TOLERANCE) {
    details.push({
      text: `Неверная высота ${sizeSubject}: ${Math.round(d.bbox.height)}px → Заменить на ${Math.round(f.bbox.height)}px`,
      category: sizeCategory,
      annotation: {
        kind: "dimension",
        from: { x: cx, y: d.bbox.y },
        to: { x: cx, y: d.bbox.y + d.bbox.height },
      },
    });
  }

  if (f.type === "TEXT") {
    if (f.fontFamily && d.fontFamily && normalizeFontFamily(f.fontFamily) !== normalizeFontFamily(d.fontFamily)) {
      details.push({
        text: `Неверный шрифт: ${d.fontFamily} → Заменить на ${f.fontFamily}`,
        category: "text",
        annotation: { kind: "dot", point: centerOf(d.bbox) },
      });
    }
    if (
      typeof f.fontSize === "number" &&
      typeof d.fontSize === "number" &&
      Math.abs(f.fontSize - d.fontSize) > FONT_SIZE_TOLERANCE
    ) {
      details.push({
        text: `Неверный размер шрифта: ${Math.round(d.fontSize)}px → Заменить на ${f.fontSize}px`,
        category: "text",
        annotation: { kind: "dot", point: centerOf(d.bbox) },
      });
    }
    if (
      typeof f.fontWeight === "number" &&
      typeof d.fontWeight === "number" &&
      Math.abs(f.fontWeight - d.fontWeight) > FONT_WEIGHT_TOLERANCE
    ) {
      details.push({
        text: `Неверная насыщенность шрифта: ${d.fontWeight} → Заменить на ${f.fontWeight}`,
        category: "text",
        annotation: { kind: "dot", point: centerOf(d.bbox) },
      });
    }
  }

  if (
    typeof f.cornerRadius === "number" &&
    typeof d.borderRadius === "number" &&
    Math.abs(f.cornerRadius - d.borderRadius) > RADIUS_TOLERANCE
  ) {
    details.push({
      text: `Неверный радиус скругления: ${Math.round(d.borderRadius)}px → Заменить на ${f.cornerRadius}px`,
      category: "radius",
      annotation: { kind: "corners", bbox: d.bbox, radius: d.borderRadius },
    });
  }

  const paddingSides: Array<["paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft", string]> = [
    ["paddingTop", "сверху"],
    ["paddingRight", "справа"],
    ["paddingBottom", "снизу"],
    ["paddingLeft", "слева"],
  ];
  for (const [key, label] of paddingSides) {
    const fVal = f[key];
    const dVal = d[key];
    if (typeof fVal === "number" && typeof dVal === "number" && Math.abs(fVal - dVal) > PADDING_TOLERANCE) {
      details.push({
        text: `Неверный отступ ${label}: ${Math.round(dVal)}px → Заменить на ${fVal}px`,
        category: "spacing",
        annotation: paddingAnnotation(d.bbox, key, dVal),
      });
    }
  }

  return details;
}

export function severityForMismatches(details: MismatchDetail[]): Severity {
  if (details.length >= 3) return "high";
  if (details.length === 2) return "medium";
  return "low";
}
