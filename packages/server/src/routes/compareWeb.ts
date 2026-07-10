import { Router } from "express";
import multer from "multer";
import type { LayerNode, TierInfo } from "@app/shared";
import { captureLiveWebData } from "../web/screenshot";
import { decodePng, buildDiffMask } from "../diff/pixelDiff";
import { clusterDiffMask } from "../diff/clustering";
import { matchLayers, type MatchResult } from "../match/matchEngine";
import { buildWebReport } from "../report/buildReport";
import { resizeToMatch } from "../util/imageOps";

const upload = multer({ storage: multer.memoryStorage() });

export const compareWebRouter = Router();

compareWebRouter.post(
  "/compare/web",
  upload.fields([
    { name: "figmaPng", maxCount: 1 },
    { name: "screenshotFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const figmaPngFile = files?.figmaPng?.[0];
      if (!figmaPngFile) {
        return res.status(400).json({ error: "figmaPng file is required" });
      }

      const width = Number(req.body.width);
      const height = Number(req.body.height);
      const mode = req.body.mode === "screenshot-fallback" ? "screenshot-fallback" : "live";
      let layerTree: LayerNode | null = null;
      try {
        layerTree = req.body.layerTree ? JSON.parse(req.body.layerTree) : null;
      } catch {
        layerTree = null;
      }

      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return res.status(400).json({ error: "width and height must be positive numbers" });
      }

      const warnings: string[] = [];
      let actualPng: Buffer;
      let matchResult: MatchResult | null = null;
      let domSource: TierInfo["domSource"] = "none";

      if (mode === "live") {
        const url = req.body.url as string | undefined;
        if (!url) return res.status(400).json({ error: "url is required in live mode" });
        try {
          const result = await captureLiveWebData(url, width, height);
          actualPng = result.png;
          if (layerTree) {
            matchResult = matchLayers(layerTree, result.domNodes);
            domSource = "dom-extraction";
          } else {
            warnings.push("Дерево слоёв Figma не получено — семантическое сопоставление пропущено.");
          }
        } catch (err) {
          return res.status(502).json({
            error: `Не удалось загрузить страницу (${(err as Error).message}). Попробуйте режим загрузки скриншота вручную.`,
          });
        }
      } else {
        const screenshotFile = files?.screenshotFile?.[0];
        if (!screenshotFile) {
          return res.status(400).json({ error: "screenshotFile is required in screenshot-fallback mode" });
        }
        actualPng = await resizeToMatch(screenshotFile.buffer, width, height);
        warnings.push("Использован вручную загруженный скриншот — DOM недоступен, сравниваются только пиксели.");
      }

      const figmaPng = await resizeToMatch(figmaPngFile.buffer, width, height);

      const figmaDecoded = decodePng(figmaPng);
      const actualDecoded = decodePng(actualPng);
      const { mask } = buildDiffMask(figmaDecoded, actualDecoded);
      const regions = clusterDiffMask(mask, width, height);

      const tierInfo: TierInfo = {
        screenshotSource: mode === "live" ? "live-browser" : "manual-upload",
        domSource,
        warnings,
      };

      const report = await buildWebReport({
        figmaPng,
        actualPng,
        regions,
        matchResult,
        tierInfo,
        figmaLayerCount: countLayers(layerTree),
      });

      res.json(report);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: (err as Error).message });
    }
  }
);

function countLayers(node: LayerNode | null): number {
  if (!node) return 0;
  let count = 1;
  for (const child of node.children ?? []) count += countLayers(child);
  return count;
}
