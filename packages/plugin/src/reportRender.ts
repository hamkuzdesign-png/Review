/// <reference types="@figma/plugin-typings" />
import type { BBox, CompareReport, MismatchAnnotation, Point } from "@app/shared";
import { flattenMarkersToRows, groupRowsByCategory, CATEGORY_LABEL, type FlatFixRow } from "./flattenRows";

// Best-effort visual approximation of the reference dark QA-table design
// (Figma MCP wasn't connected when this was built, so exact tokens from the
// source file couldn't be pulled — these are read off the provided screenshot).
const BG_DARK: RGB = { r: 0.071, g: 0.071, b: 0.094 };
const BG_HEADER_BAR: RGB = { r: 0, g: 0, b: 0 };
const BG_PILL_DARK: RGB = { r: 0.16, g: 0.16, b: 0.2 };
const TEXT_WHITE: RGB = { r: 0.96, g: 0.96, b: 0.97 };
const TEXT_GRAY: RGB = { r: 0.68, g: 0.68, b: 0.73 };
const TEXT_GREEN: RGB = { r: 0.29, g: 0.87, b: 0.5 };
const ACCENT_BLUE: RGB = { r: 0.2, g: 0.44, b: 0.96 };
const ACCENT_GREEN: RGB = { r: 0.16, g: 0.66, b: 0.36 };
const DIVIDER: RGB = { r: 0.2, g: 0.2, b: 0.25 };
const IMAGE_BG: RGB = { r: 0.05, g: 0.05, b: 0.07 };
const HIGHLIGHT_RED: RGB = { r: 0.94, g: 0.16, b: 0.16 };
const WARNING_ORANGE: RGB = { r: 0.95, g: 0.6, b: 0.1 };

const COL_DESC_WIDTH = 260;
const COL_IMAGE_WIDTH = 300;
const IMAGE_CELL_HEIGHT = 180;
const MOCKUP_MAX_WIDTH = 420;
const SCORE_BAR_WIDTH = 240;
const SCORE_BAR_HEIGHT = 8;

async function ensureFonts() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
}

function text(value: string, size: number, bold: boolean, color: RGB = TEXT_WHITE): TextNode {
  const node = figma.createText();
  node.fontName = { family: "Inter", style: bold ? "Bold" : "Regular" };
  node.fontSize = size;
  node.characters = value;
  node.fills = [{ type: "SOLID", color }];
  return node;
}

function wrappedText(value: string, size: number, width: number, color: RGB = TEXT_WHITE): TextNode {
  const node = figma.createText();
  node.fontName = { family: "Inter", style: "Regular" };
  node.fontSize = size;
  // Fix the wrap width and switch to auto-height BEFORE setting characters —
  // doing it after (the previous order) let Figma compute a single-line
  // auto-width layout first, then the follow-up resize's height sometimes
  // didn't reflow, so the wrapped text overflowed below its pill's hug height.
  node.textAutoResize = "HEIGHT";
  node.resize(width, node.height);
  node.characters = value;
  node.fills = [{ type: "SOLID", color }];
  return node;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return figma.base64Decode(base64);
}

function pill(label: string, bg: RGB, fg: RGB = TEXT_WHITE): FrameNode {
  const frame = figma.createFrame();
  frame.layoutMode = "HORIZONTAL";
  frame.primaryAxisSizingMode = "AUTO";
  frame.counterAxisSizingMode = "AUTO";
  frame.paddingTop = frame.paddingBottom = 6;
  frame.paddingLeft = frame.paddingRight = 14;
  frame.cornerRadius = 999;
  frame.fills = [{ type: "SOLID", color: bg }];
  frame.appendChild(text(label, 12, true, fg));
  return frame;
}

function fixedWidthCenteredCell(label: string, width: number): FrameNode {
  const cell = figma.createFrame();
  cell.layoutMode = "VERTICAL";
  cell.counterAxisSizingMode = "FIXED";
  cell.primaryAxisSizingMode = "AUTO";
  cell.resize(width, 40);
  cell.primaryAxisAlignItems = "CENTER";
  cell.counterAxisAlignItems = "CENTER";
  cell.paddingTop = cell.paddingBottom = 12;
  cell.fills = [];
  if (label) cell.appendChild(text(label, 13, true, TEXT_WHITE));
  return cell;
}

function pluralizeFix(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "правка";
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return "правки";
  return "правок";
}

function scoreColor(score: number): RGB {
  if (score >= 85) return ACCENT_GREEN;
  if (score >= 60) return ACCENT_BLUE;
  if (score >= 35) return WARNING_ORANGE;
  return HIGHLIGHT_RED;
}

/** A labeled 0-100 meter for report.matchScore: how much of the design made it into the implementation cleanly. */
function createScoreBar(score: number): FrameNode {
  // report crosses a network boundary (plugin UI -> local server -> back), so
  // a missing/malformed value here shouldn't be able to crash the whole
  // canvas render — fall back to 0 rather than letting NaN reach .resize().
  const clamped = Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const color = scoreColor(clamped);

  const wrapper = figma.createFrame();
  wrapper.name = "match-score";
  wrapper.layoutMode = "VERTICAL";
  wrapper.primaryAxisSizingMode = "AUTO";
  wrapper.counterAxisSizingMode = "AUTO";
  wrapper.itemSpacing = 6;
  wrapper.fills = [];
  wrapper.appendChild(text(`Соответствие макету: ${clamped}%`, 13, true, color));

  const track = figma.createFrame();
  track.name = "match-score-track";
  track.layoutMode = "HORIZONTAL";
  track.primaryAxisSizingMode = "FIXED";
  track.counterAxisSizingMode = "FIXED";
  track.resize(SCORE_BAR_WIDTH, SCORE_BAR_HEIGHT);
  track.cornerRadius = SCORE_BAR_HEIGHT / 2;
  track.clipsContent = true;
  track.fills = [{ type: "SOLID", color: BG_PILL_DARK }];

  const fill = figma.createRectangle();
  fill.name = "match-score-fill";
  fill.resize(Math.max(1, Math.round((SCORE_BAR_WIDTH * clamped) / 100)), SCORE_BAR_HEIGHT);
  fill.fills = [{ type: "SOLID", color }];
  track.appendChild(fill);

  wrapper.appendChild(track);
  return wrapper;
}

function drawDot(parent: FrameNode, point: Point) {
  const dotSize = 14;
  const dot = figma.createEllipse();
  dot.name = "annotation-dot";
  dot.x = point.x - dotSize / 2;
  dot.y = point.y - dotSize / 2;
  dot.resize(dotSize, dotSize);
  dot.fills = [{ type: "SOLID", color: HIGHLIGHT_RED }];
  dot.strokes = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  dot.strokeWeight = 2;
  parent.appendChild(dot);
}

/** A thin bar between the two points plus a small round cap at each end — a robust stand-in for a dimension arrow that doesn't depend on rotating a line node. */
function drawDimension(parent: FrameNode, from: Point, to: Point) {
  const thickness = 2;
  const capSize = 8;
  const isHorizontal = Math.abs(to.y - from.y) < 0.01;

  const bar = figma.createRectangle();
  bar.name = "annotation-dimension";
  bar.fills = [{ type: "SOLID", color: HIGHLIGHT_RED }];
  if (isHorizontal) {
    bar.x = Math.min(from.x, to.x);
    bar.y = from.y - thickness / 2;
    bar.resize(Math.max(1, Math.abs(to.x - from.x)), thickness);
  } else {
    bar.x = from.x - thickness / 2;
    bar.y = Math.min(from.y, to.y);
    bar.resize(thickness, Math.max(1, Math.abs(to.y - from.y)));
  }
  parent.appendChild(bar);

  for (const point of [from, to]) {
    const cap = figma.createEllipse();
    cap.name = "annotation-dimension-cap";
    cap.x = point.x - capSize / 2;
    cap.y = point.y - capSize / 2;
    cap.resize(capSize, capSize);
    cap.fills = [{ type: "SOLID", color: HIGHLIGHT_RED }];
    cap.strokes = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    cap.strokeWeight = 1.5;
    parent.appendChild(cap);
  }
}

/**
 * Outlines just the rounding, not the whole shape: a full circle centered on
 * each corner's true arc-center at the actual radius. The quarter of each
 * circle that faces into the shape traces the real corner curve exactly; the
 * rest bulges into the empty area a rounded corner already cuts away, so it
 * doesn't read as a stray mark over real content.
 */
function drawCorners(parent: FrameNode, bbox: BBox, radius: number) {
  if (radius <= 0) return;
  const r = radius;
  const centers: Point[] = [
    { x: bbox.x + r, y: bbox.y + r },
    { x: bbox.x + bbox.width - r, y: bbox.y + r },
    { x: bbox.x + bbox.width - r, y: bbox.y + bbox.height - r },
    { x: bbox.x + r, y: bbox.y + bbox.height - r },
  ];
  for (const center of centers) {
    const ring = figma.createEllipse();
    ring.name = "annotation-corner";
    ring.x = center.x - r;
    ring.y = center.y - r;
    ring.resize(Math.max(1, r * 2), Math.max(1, r * 2));
    ring.fills = [];
    ring.strokes = [{ type: "SOLID", color: HIGHLIGHT_RED }];
    ring.strokeWeight = 2;
    parent.appendChild(ring);
  }
}

/** Maps absolute image coordinates (same space as Marker.bbox) onto wherever the crop actually lands on screen, given a precomputed scale + any letterbox offset. */
function createCropMapper(bbox: BBox, cropInnerBox: BBox, scale: number, fitOffsetX: number, fitOffsetY: number) {
  const offsetXAbs = bbox.x - cropInnerBox.x;
  const offsetYAbs = bbox.y - cropInnerBox.y;

  return {
    scale,
    toCanvas(point: Point): Point {
      return { x: fitOffsetX + (point.x - offsetXAbs) * scale, y: fitOffsetY + (point.y - offsetYAbs) * scale };
    },
  };
}

function drawAnnotation(
  parent: FrameNode,
  annotation: MismatchAnnotation,
  mapper: ReturnType<typeof createCropMapper>
) {
  if (annotation.kind === "dot") {
    drawDot(parent, mapper.toCanvas(annotation.point));
  } else if (annotation.kind === "dimension") {
    drawDimension(parent, mapper.toCanvas(annotation.from), mapper.toCanvas(annotation.to));
  } else {
    const topLeft = mapper.toCanvas({ x: annotation.bbox.x, y: annotation.bbox.y });
    drawCorners(
      parent,
      { x: topLeft.x, y: topLeft.y, width: annotation.bbox.width * mapper.scale, height: annotation.bbox.height * mapper.scale },
      annotation.radius * mapper.scale
    );
  }
}

async function createScreenshotCell(
  label: string,
  labelColor: RGB,
  dataUrl: string | undefined,
  bbox: BBox | undefined,
  cropInnerBox: BBox | undefined,
  annotation: MismatchAnnotation | undefined,
  width: number,
  /** Fixed height => letterboxed "FIT" into a box (used for the small image-reference cell). Omitted => fit by width only, auto height (used for the main full-screen crop, whose aspect ratio varies per report). */
  height: number | undefined
): Promise<FrameNode> {
  const wrapper = figma.createFrame();
  wrapper.layoutMode = "VERTICAL";
  // Sizing this frame via Figma's AUTO hug has repeatedly proven unreliable
  // in this file (the wrapper stayed pinned at its placeholder height while
  // the image inside it grew past it, clipping the screenshot to nothing —
  // twice now). Instead of trusting the auto-layout engine to recompute the
  // hug height, this cell is sized FIXED and its exact final height is
  // computed and set explicitly at the end, once both children's real sizes
  // are known — no ambiguity about when/whether a resize propagates.
  wrapper.counterAxisSizingMode = "FIXED";
  wrapper.primaryAxisSizingMode = "FIXED";
  wrapper.itemSpacing = 6;
  wrapper.fills = [];
  // Defensive backstop: even if the height computed below is ever wrong,
  // overflow should be visible (and so noticeable) rather than silently
  // clipped out of view.
  wrapper.clipsContent = false;
  wrapper.resize(width, 10);
  const labelNode = text(label, 11, false, labelColor);
  wrapper.appendChild(labelNode);

  const imageFrame = figma.createFrame();
  imageFrame.cornerRadius = 8;
  imageFrame.clipsContent = true;
  wrapper.appendChild(imageFrame);

  if (dataUrl) {
    try {
      const image = figma.createImage(dataUrlToBytes(dataUrl));
      const { width: nativeW, height: nativeH } = await image.getSizeAsync();

      let scale: number;
      let frameHeight: number;
      let fitOffsetX = 0;
      let fitOffsetY = 0;
      if (height === undefined) {
        scale = nativeW > 0 ? width / nativeW : 1;
        frameHeight = Math.max(1, Math.round(nativeH * scale));
      } else {
        scale = Math.min(width / nativeW, height / nativeH);
        frameHeight = height;
        fitOffsetX = (width - nativeW * scale) / 2;
        fitOffsetY = (height - nativeH * scale) / 2;
      }

      imageFrame.resize(width, frameHeight);
      imageFrame.fills = [
        { type: "SOLID", color: IMAGE_BG },
        { type: "IMAGE", imageHash: image.hash, scaleMode: height === undefined ? "FILL" : "FIT" },
      ];

      if (bbox && cropInnerBox && nativeW > 0 && nativeH > 0) {
        const mapper = createCropMapper(bbox, cropInnerBox, scale, fitOffsetX, fitOffsetY);
        const effective: MismatchAnnotation = annotation ?? {
          kind: "dot",
          point: { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 },
        };
        drawAnnotation(imageFrame, effective, mapper);
      }
    } catch (err) {
      imageFrame.resize(width, height ?? 200);
      imageFrame.layoutMode = "VERTICAL";
      imageFrame.primaryAxisAlignItems = "CENTER";
      imageFrame.counterAxisAlignItems = "CENTER";
      imageFrame.fills = [{ type: "SOLID", color: BG_PILL_DARK }];
      imageFrame.appendChild(text((err as Error).message, 9, false, TEXT_GRAY));
    }
  } else {
    imageFrame.resize(width, height ?? 200);
    imageFrame.layoutMode = "VERTICAL";
    imageFrame.primaryAxisAlignItems = "CENTER";
    imageFrame.counterAxisAlignItems = "CENTER";
    imageFrame.fills = [{ type: "SOLID", color: BG_PILL_DARK }];
    imageFrame.appendChild(text("Нет скриншота", 10, false, TEXT_GRAY));
  }

  wrapper.resize(width, labelNode.height + wrapper.itemSpacing + imageFrame.height);
  return wrapper;
}

/** The target design is shown once for the whole report, not duplicated per row. */
async function createMockupPreview(dataUrl: string, maxWidth: number): Promise<FrameNode> {
  const wrapper = figma.createFrame();
  wrapper.name = "mockup-preview";
  wrapper.layoutMode = "VERTICAL";
  wrapper.primaryAxisSizingMode = "AUTO";
  wrapper.counterAxisSizingMode = "AUTO";
  wrapper.itemSpacing = 6;
  wrapper.fills = [];
  wrapper.appendChild(text("Макет", 12, false, TEXT_GREEN));

  const imageFrame = figma.createFrame();
  imageFrame.cornerRadius = 8;
  imageFrame.clipsContent = true;

  try {
    const image = figma.createImage(dataUrlToBytes(dataUrl));
    const { width: nativeW, height: nativeH } = await image.getSizeAsync();
    const scale = nativeW > maxWidth ? maxWidth / nativeW : 1;
    imageFrame.resize(Math.round(nativeW * scale), Math.round(nativeH * scale));
    imageFrame.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
  } catch (err) {
    imageFrame.resize(maxWidth, 200);
    imageFrame.layoutMode = "VERTICAL";
    imageFrame.primaryAxisAlignItems = "CENTER";
    imageFrame.counterAxisAlignItems = "CENTER";
    imageFrame.fills = [{ type: "SOLID", color: BG_PILL_DARK }];
    imageFrame.appendChild(text((err as Error).message, 10, false, TEXT_GRAY));
  }

  wrapper.appendChild(imageFrame);
  return wrapper;
}

async function createFixRow(row: FlatFixRow): Promise<FrameNode> {
  const rowFrame = figma.createFrame();
  rowFrame.name = `row-${row.number}`;
  rowFrame.layoutMode = "HORIZONTAL";
  rowFrame.primaryAxisSizingMode = "AUTO";
  rowFrame.counterAxisSizingMode = "AUTO";
  rowFrame.fills = [{ type: "SOLID", color: BG_DARK }];
  rowFrame.strokes = [{ type: "SOLID", color: DIVIDER }];
  rowFrame.strokeTopWeight = 0;
  rowFrame.strokeLeftWeight = 0;
  rowFrame.strokeRightWeight = 0;
  rowFrame.strokeBottomWeight = 1;
  rowFrame.clipsContent = false;

  const descCol = figma.createFrame();
  descCol.layoutMode = "VERTICAL";
  descCol.counterAxisSizingMode = "FIXED";
  descCol.primaryAxisSizingMode = "AUTO";
  descCol.resize(COL_DESC_WIDTH, 100);
  descCol.paddingTop = descCol.paddingBottom = 16;
  descCol.paddingLeft = descCol.paddingRight = 16;
  descCol.itemSpacing = 8;
  descCol.fills = [];
  descCol.clipsContent = false;

  const numberBadge = pill(String(row.number), { r: 1, g: 1, b: 1 }, { r: 0.07, g: 0.07, b: 0.09 });
  descCol.appendChild(numberBadge);

  descCol.appendChild(wrappedText(row.description, 12, COL_DESC_WIDTH - 32, TEXT_WHITE));

  rowFrame.appendChild(descCol);
  rowFrame.appendChild(
    await createScreenshotCell(
      "Скрин",
      TEXT_GRAY,
      row.actualCrop,
      row.bbox,
      row.cropInnerBox,
      row.annotation,
      COL_IMAGE_WIDTH,
      undefined
    )
  );

  // Image-content mismatches are the one case where text can't say "which
  // picture" — so (only for those specific rows) show a small reference crop
  // of the correct image, instead of a mockup-wide duplicate on every row.
  if (row.expectedCrop) {
    rowFrame.appendChild(
      await createScreenshotCell(
        "Верное изображение",
        TEXT_GREEN,
        row.expectedCrop,
        undefined,
        undefined,
        undefined,
        COL_IMAGE_WIDTH,
        IMAGE_CELL_HEIGHT
      )
    );
  }

  return rowFrame;
}

export async function renderReportToCanvas(report: CompareReport, frameName: string): Promise<void> {
  await ensureFonts();

  const rows = flattenMarkersToRows(report.markers);

  const container = figma.createFrame();
  container.name = `QA: ${frameName}`;
  container.layoutMode = "VERTICAL";
  container.primaryAxisSizingMode = "AUTO";
  container.counterAxisSizingMode = "AUTO";
  container.fills = [{ type: "SOLID", color: BG_DARK }];
  container.cornerRadius = 16;
  container.clipsContent = true;

  const header = figma.createFrame();
  header.layoutMode = "VERTICAL";
  header.primaryAxisSizingMode = "AUTO";
  header.counterAxisSizingMode = "AUTO";
  header.itemSpacing = 12;
  header.paddingTop = header.paddingBottom = header.paddingLeft = header.paddingRight = 24;
  header.fills = [];
  header.appendChild(text(frameName, 22, true, TEXT_WHITE));

  const badgeRow = figma.createFrame();
  badgeRow.layoutMode = "HORIZONTAL";
  badgeRow.primaryAxisSizingMode = "AUTO";
  badgeRow.counterAxisSizingMode = "AUTO";
  badgeRow.itemSpacing = 8;
  badgeRow.fills = [];
  const hasIssues = rows.length > 0;
  badgeRow.appendChild(
    pill(hasIssues ? "Ждёт исправления" : "Совпадает с макетом", hasIssues ? ACCENT_BLUE : ACCENT_GREEN, {
      r: 1,
      g: 1,
      b: 1,
    })
  );
  badgeRow.appendChild(pill(`${rows.length} ${pluralizeFix(rows.length)}`, BG_PILL_DARK, TEXT_GRAY));
  header.appendChild(badgeRow);

  header.appendChild(createScoreBar(report.matchScore));

  header.appendChild(await createMockupPreview(report.figmaImage, MOCKUP_MAX_WIDTH));

  if (report.tierInfo.warnings.length > 0) {
    header.appendChild(
      wrappedText(report.tierInfo.warnings.map((w) => `⚠️ ${w}`).join("\n"), 11, 700, TEXT_GRAY)
    );
  }

  container.appendChild(header);

  if (rows.length > 0) {
    const categoriesRow = figma.createFrame();
    categoriesRow.name = "categories";
    categoriesRow.layoutMode = "HORIZONTAL";
    categoriesRow.primaryAxisSizingMode = "AUTO";
    categoriesRow.counterAxisSizingMode = "AUTO";
    categoriesRow.counterAxisAlignItems = "MIN";
    categoriesRow.itemSpacing = 24;
    categoriesRow.paddingLeft = categoriesRow.paddingRight = 24;
    categoriesRow.paddingBottom = 24;
    categoriesRow.fills = [];
    categoriesRow.clipsContent = false;

    for (const group of groupRowsByCategory(rows)) {
      const categoryBlock = figma.createFrame();
      categoryBlock.name = `category-${group.category}`;
      categoryBlock.layoutMode = "VERTICAL";
      categoryBlock.primaryAxisSizingMode = "AUTO";
      categoryBlock.counterAxisSizingMode = "AUTO";
      categoryBlock.fills = [];
      categoryBlock.clipsContent = false;

      const sectionTitle = figma.createFrame();
      sectionTitle.name = `section-${group.category}`;
      sectionTitle.layoutMode = "HORIZONTAL";
      sectionTitle.primaryAxisSizingMode = "AUTO";
      sectionTitle.counterAxisSizingMode = "AUTO";
      sectionTitle.paddingTop = sectionTitle.paddingBottom = 14;
      sectionTitle.paddingLeft = sectionTitle.paddingRight = 24;
      sectionTitle.fills = [{ type: "SOLID", color: BG_PILL_DARK }];
      sectionTitle.appendChild(
        text(`${CATEGORY_LABEL[group.category]} (${group.rows.length})`, 20, true, TEXT_WHITE)
      );
      categoryBlock.appendChild(sectionTitle);

      const headerBar = figma.createFrame();
      headerBar.name = "column-headers";
      headerBar.layoutMode = "HORIZONTAL";
      headerBar.primaryAxisSizingMode = "AUTO";
      headerBar.counterAxisSizingMode = "AUTO";
      headerBar.fills = [{ type: "SOLID", color: BG_HEADER_BAR }];
      headerBar.appendChild(fixedWidthCenteredCell("", COL_DESC_WIDTH));
      headerBar.appendChild(fixedWidthCenteredCell("Скрин", COL_IMAGE_WIDTH));
      categoryBlock.appendChild(headerBar);

      for (const row of group.rows) {
        categoryBlock.appendChild(await createFixRow(row));
      }

      categoriesRow.appendChild(categoryBlock);
    }

    container.appendChild(categoriesRow);
  } else {
    const emptyState = figma.createFrame();
    emptyState.layoutMode = "VERTICAL";
    emptyState.primaryAxisSizingMode = "AUTO";
    emptyState.counterAxisSizingMode = "AUTO";
    emptyState.paddingTop = emptyState.paddingBottom = 40;
    emptyState.paddingLeft = emptyState.paddingRight = 24;
    emptyState.fills = [];
    emptyState.appendChild(text("Расхождений не найдено 🎉", 14, false, TEXT_WHITE));
    container.appendChild(emptyState);
  }

  const selection = figma.currentPage.selection[0];
  if (selection && "absoluteBoundingBox" in selection && selection.absoluteBoundingBox) {
    container.x = selection.absoluteBoundingBox.x + selection.absoluteBoundingBox.width + 100;
    container.y = selection.absoluteBoundingBox.y;
  } else {
    container.x = figma.viewport.center.x;
    container.y = figma.viewport.center.y;
  }

  figma.currentPage.appendChild(container);
  figma.viewport.scrollAndZoomIntoView([container]);
  figma.currentPage.selection = [container];
}
