export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayerNode {
  id: string;
  name: string;
  type: string;
  bbox: BBox;
  characters?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fillColor?: string;
  hasImageFill?: boolean;
  cornerRadius?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  children?: LayerNode[];
}

export interface DomNode {
  bbox: BBox;
  tagName: string;
  id?: string;
  testId?: string;
  className?: string;
  textContent?: string;
  color?: string;
  backgroundColor?: string;
  hasImage?: boolean;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  borderRadius?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
}

export type ScreenshotSource = "live-browser" | "manual-upload" | "adb-device" | "static-only" | "none";
export type DomSource = "dom-extraction" | "uiautomator" | "static-resources" | "none";

export interface TierInfo {
  screenshotSource: ScreenshotSource;
  domSource: DomSource;
  warnings: string[];
}

export type MarkerKind = "semantic" | "pixel-region" | "missing-in-actual" | "extra-in-actual";
export type Severity = "low" | "medium" | "high";

export type MismatchCategory = "spacing" | "image" | "text" | "color" | "size" | "radius" | "structure" | "other";

export interface Point {
  x: number;
  y: number;
}

/**
 * How to point at the specific problem on the "Скрин" crop, in the same
 * absolute coordinate space as Marker.bbox (the renderer derives the crop's
 * own offset from bbox vs cropInnerBox and maps these into crop-local space).
 */
export type MismatchAnnotation =
  | { kind: "dot"; point: Point }
  | { kind: "dimension"; from: Point; to: Point }
  | { kind: "corners"; bbox: BBox; radius: number };

export interface MismatchDetail {
  text: string;
  category: MismatchCategory;
  annotation?: MismatchAnnotation;
  /** Only set for image-content mismatches — there's no way to describe "which picture" in text, so a small reference crop of the correct image is attached. */
  expectedCrop?: string;
}

export interface Marker {
  number: number;
  bbox: BBox;
  actualCrop?: string;
  /** Position of the actual mismatched object within actualCrop, for drawing a highlight box on the crop itself. */
  cropInnerBox?: BBox;
  title: string;
  explanations: MismatchDetail[];
  severity: Severity;
  kind: MarkerKind;
}

export interface CompareReportMeta {
  figmaLayerCount: number;
  matchedPairs: number;
  unmatchedFigmaLayers: number;
  unmatchedActualNodes: number;
}

export interface CompareReport {
  mode: "web" | "apk";
  tierInfo: TierInfo;
  figmaImage: string;
  actualImage?: string;
  markers: Marker[];
  meta: CompareReportMeta;
  /** 0-100: share of Figma layers that made it into the implementation with no flagged mismatch. */
  matchScore: number;
}

export interface HealthResponse {
  ok: boolean;
  capabilities: {
    playwright: boolean;
    adb: boolean;
    adbDevices: string[];
    aapt: boolean;
  };
}
