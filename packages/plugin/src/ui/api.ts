import type { CompareReport } from "@app/shared";

declare const process: { env: { BACKEND_URL: string } };
const BACKEND_URL = process.env.BACKEND_URL;

function base64ToBlob(base64: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  return new Blob([new Uint8Array(byteNumbers)], { type: "image/png" });
}

export async function compareWeb(params: {
  figmaPngBase64: string;
  layerTree: unknown;
  width: number;
  height: number;
  mode: "live" | "screenshot-fallback";
  url?: string;
  screenshotFile?: File;
}): Promise<CompareReport> {
  const form = new FormData();
  form.append("figmaPng", base64ToBlob(params.figmaPngBase64), "figma.png");
  form.append("layerTree", JSON.stringify(params.layerTree));
  form.append("width", String(params.width));
  form.append("height", String(params.height));
  form.append("mode", params.mode);
  if (params.url) form.append("url", params.url);
  if (params.screenshotFile) form.append("screenshotFile", params.screenshotFile);

  const res = await fetch(`${BACKEND_URL}/compare/web`, { method: "POST", body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? "Compare failed");
  return body as CompareReport;
}
