import { Router } from "express";
import type { HealthResponse } from "@app/shared";
import { detectCapabilities } from "../util/capabilities";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const capabilities = await detectCapabilities();
  const body: HealthResponse = { ok: true, capabilities };
  res.json(body);
});
