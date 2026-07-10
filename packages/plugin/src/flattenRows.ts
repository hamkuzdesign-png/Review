import type { BBox, Marker, MismatchAnnotation, MismatchCategory, Severity } from "@app/shared";

export interface FlatFixRow {
  number: number;
  description: string;
  category: MismatchCategory;
  actualCrop?: string;
  /** Marker's own absolute bbox — needed alongside cropInnerBox to derive the crop's offset for annotation placement. */
  bbox?: BBox;
  cropInnerBox?: BBox;
  annotation?: MismatchAnnotation;
  /** Only set for image-content mismatches — the correct image, shown once for this specific row since text can't describe "which picture". */
  expectedCrop?: string;
  severity: Severity;
}

export const CATEGORY_LABEL: Record<MismatchCategory, string> = {
  spacing: "Отступы",
  image: "Изображения",
  text: "Текст",
  color: "Цвет",
  size: "Размер",
  radius: "Скругление",
  structure: "Отсутствующие / лишние элементы",
  other: "Прочее",
};

// Display order — matches what the user cares about most, top to bottom.
const CATEGORY_ORDER: MismatchCategory[] = ["spacing", "image", "text", "color", "size", "radius", "structure", "other"];

/** "1 правка = 1 строка": a marker with several property mismatches becomes several rows, one per mismatch. */
export function flattenMarkersToRows(markers: Marker[]): FlatFixRow[] {
  const rows: FlatFixRow[] = [];
  let n = 1;
  for (const marker of markers) {
    const details = marker.explanations.length > 0 ? marker.explanations : [{ text: marker.title, category: "other" as const }];
    for (const detail of details) {
      // Semantic mismatches are already self-descriptive ("Неверный цвет: ... →
      // Заменить на ..."); the crop highlight identifies the object, so no name
      // prefix is needed there. Other kinds (missing/extra element) need it.
      const description = marker.kind === "semantic" ? detail.text : `${marker.title}: ${detail.text}`;
      rows.push({
        number: n++,
        description,
        category: detail.category,
        actualCrop: marker.actualCrop,
        bbox: marker.bbox,
        cropInnerBox: marker.cropInnerBox,
        annotation: detail.annotation,
        expectedCrop: detail.expectedCrop,
        severity: marker.severity,
      });
    }
  }
  return rows;
}

export interface RowGroup {
  category: MismatchCategory;
  rows: FlatFixRow[];
}

/** Groups rows by category and renumbers each group from 1 — rows are always displayed within their category section, so numbering should read 1,2,3... there instead of jumping around with the global order. */
export function groupRowsByCategory(rows: FlatFixRow[]): RowGroup[] {
  const byCategory = new Map<MismatchCategory, FlatFixRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  return CATEGORY_ORDER.filter((category) => byCategory.has(category)).map((category) => ({
    category,
    rows: byCategory.get(category)!.map((row, i) => ({ ...row, number: i + 1 })),
  }));
}
