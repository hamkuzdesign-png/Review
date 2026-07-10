/// <reference types="@figma/plugin-typings" />
import type { CompareReport, LayerNode } from "@app/shared";
import { renderReportToCanvas } from "./reportRender";

type LayerNodePayload = LayerNode;

type UIMessage =
  | { type: "requestExport" }
  | { type: "requestRenderReport"; report: CompareReport; frameName: string }
  | { type: "resizeUI"; height: number };

type MainMessage =
  | { type: "selectionInvalid"; reason: string }
  | { type: "exportResult"; png: string; layerTree: LayerNodePayload; name: string; width: number; height: number }
  | { type: "renderComplete" }
  | { type: "renderError"; reason: string };

const UI_WIDTH = 560;
const UI_MIN_HEIGHT = 300;
const UI_MAX_HEIGHT = 800;

figma.showUI(__html__, { width: UI_WIDTH, height: 600 });

const MAX_NODES = 1500;
let nodeCount = 0;

function rgbToHex(color: RGB): string {
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`.toUpperCase();
}

function getFillColor(node: SceneNode): string | undefined {
  if (!("fills" in node)) return undefined;
  const fills = node.fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return undefined;
  const solid = fills.find((f) => f.type === "SOLID" && f.visible !== false) as SolidPaint | undefined;
  return solid ? rgbToHex(solid.color) : undefined;
}

function hasImageFill(node: SceneNode): boolean {
  if (!("fills" in node)) return false;
  const fills = node.fills;
  if (fills === figma.mixed || !Array.isArray(fills)) return false;
  return fills.some((f) => f.type === "IMAGE" && f.visible !== false);
}

// Longer/more specific keywords must be checked before the shorter substrings
// they contain (e.g. "extrabold" before "bold", "semibold" before "bold").
const WEIGHT_BY_STYLE_KEYWORD: Array<[string, number]> = [
  ["thin", 100],
  ["extralight", 200],
  ["ultralight", 200],
  ["light", 300],
  ["regular", 400],
  ["book", 400],
  ["medium", 500],
  ["semibold", 600],
  ["demibold", 600],
  ["extrabold", 800],
  ["ultrabold", 800],
  ["bold", 700],
  ["black", 900],
  ["heavy", 900],
];

function guessFontWeight(styleName: string): number {
  const lower = styleName.toLowerCase();
  for (const [keyword, weight] of WEIGHT_BY_STYLE_KEYWORD) {
    if (lower.includes(keyword)) return weight;
  }
  return 400;
}

function walk(node: SceneNode, rootX: number, rootY: number): LayerNodePayload | null {
  if (!node.visible) return null;
  if (nodeCount++ > MAX_NODES) return null;

  const box =
    "absoluteBoundingBox" in node && node.absoluteBoundingBox
      ? {
          x: node.absoluteBoundingBox.x - rootX,
          y: node.absoluteBoundingBox.y - rootY,
          width: node.absoluteBoundingBox.width,
          height: node.absoluteBoundingBox.height,
        }
      : { x: 0, y: 0, width: 0, height: 0 };

  const payload: LayerNodePayload = {
    id: node.id,
    name: node.name,
    type: node.type,
    bbox: box,
    fillColor: getFillColor(node),
    hasImageFill: hasImageFill(node) || undefined,
  };

  if (node.type === "TEXT") {
    payload.characters = node.characters;
    payload.fontSize = typeof node.fontSize === "number" ? node.fontSize : undefined;
    if (node.fontName !== figma.mixed) {
      const fontName = node.fontName as FontName;
      payload.fontFamily = fontName.family;
      payload.fontWeight = guessFontWeight(fontName.style);
    }
  }

  if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
    payload.cornerRadius = node.cornerRadius;
  }

  if ("layoutMode" in node && node.layoutMode !== "NONE") {
    payload.paddingTop = node.paddingTop;
    payload.paddingRight = node.paddingRight;
    payload.paddingBottom = node.paddingBottom;
    payload.paddingLeft = node.paddingLeft;
  }

  if ("children" in node) {
    const children = node.children
      .map((child) => walk(child, rootX, rootY))
      .filter((c): c is LayerNodePayload => c !== null);
    if (children.length > 0) payload.children = children;
  }

  return payload;
}

async function handleExportRequest() {
  const selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    const msg: MainMessage = { type: "selectionInvalid", reason: "Выберите ровно один фрейм или компонент." };
    figma.ui.postMessage(msg);
    return;
  }

  const node = selection[0];
  if (!("exportAsync" in node) || !("absoluteBoundingBox" in node) || !node.absoluteBoundingBox) {
    const msg: MainMessage = { type: "selectionInvalid", reason: "Выбранный элемент нельзя экспортировать." };
    figma.ui.postMessage(msg);
    return;
  }

  const bytes = await (node as unknown as ExportMixin).exportAsync({ format: "PNG" });
  const base64 = figma.base64Encode(bytes);

  nodeCount = 0;
  const layerTree = walk(node, node.absoluteBoundingBox.x, node.absoluteBoundingBox.y) ?? {
    id: node.id,
    name: node.name,
    type: node.type,
    bbox: { x: 0, y: 0, width: node.absoluteBoundingBox.width, height: node.absoluteBoundingBox.height },
  };

  const msg: MainMessage = {
    type: "exportResult",
    png: base64,
    layerTree,
    name: node.name,
    width: Math.round(node.absoluteBoundingBox.width),
    height: Math.round(node.absoluteBoundingBox.height),
  };
  figma.ui.postMessage(msg);
}

async function handleRenderReportRequest(report: CompareReport, frameName: string) {
  try {
    await renderReportToCanvas(report, frameName);
    const msg: MainMessage = { type: "renderComplete" };
    figma.ui.postMessage(msg);
  } catch (err) {
    const msg: MainMessage = { type: "renderError", reason: (err as Error).message };
    figma.ui.postMessage(msg);
  }
}

figma.ui.onmessage = (msg: UIMessage) => {
  if (msg.type === "requestExport") {
    void handleExportRequest();
  } else if (msg.type === "requestRenderReport") {
    void handleRenderReportRequest(msg.report, msg.frameName);
  } else if (msg.type === "resizeUI") {
    const height = Math.min(UI_MAX_HEIGHT, Math.max(UI_MIN_HEIGHT, Math.round(msg.height)));
    figma.ui.resize(UI_WIDTH, height);
  }
};
