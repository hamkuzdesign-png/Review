import { useEffect, useState } from "react";
import type { CompareReport } from "@app/shared";
import type { ExportPayload } from "./App";
import { compareWeb } from "./api";
import {
  colors,
  errorTextStyle,
  fieldButtonStyle,
  fieldContainerStyle,
  fieldLabelStyle,
  fieldTextInputStyle,
  fieldValueStyle,
  hintTextStyle,
  primaryButtonDisabledStyle,
  primaryButtonStyle,
  tabButtonActiveStyle,
  tabButtonStyle,
  tabsTrackStyle,
} from "./theme";

interface Props {
  exportPayload: ExportPayload | null;
  selectionError: string | null;
  onRequestExport: () => void;
}

type RenderStatus = "idle" | "rendering" | "done" | "error";

export function WebCompareTab({ exportPayload, selectionError, onRequestExport }: Props) {
  const [url, setUrl] = useState("http://localhost:3000");
  const [fallback, setFallback] = useState(false);
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CompareReport | null>(null);
  const [renderStatus, setRenderStatus] = useState<RenderStatus>("idle");
  const [renderErrorMessage, setRenderErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage;
      if (!msg) return;
      if (msg.type === "renderComplete") {
        setRenderStatus("done");
      } else if (msg.type === "renderError") {
        setRenderStatus("error");
        setRenderErrorMessage(msg.reason);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  async function handleCompare() {
    if (!exportPayload) return;
    setLoading(true);
    setError(null);
    setReport(null);
    setRenderStatus("idle");
    try {
      const result = await compareWeb({
        figmaPngBase64: exportPayload.png,
        layerTree: exportPayload.layerTree,
        width: exportPayload.width,
        height: exportPayload.height,
        mode: fallback ? "screenshot-fallback" : "live",
        url: fallback ? undefined : url,
        screenshotFile: fallback ? screenshotFile ?? undefined : undefined,
      });
      setReport(result);
      setRenderStatus("rendering");
      parent.postMessage(
        { pluginMessage: { type: "requestRenderReport", report: result, frameName: exportPayload.name } },
        "*"
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ marginBottom: 16 }}>
        <button type="button" onClick={onRequestExport} style={fieldButtonStyle}>
          <span style={fieldLabelStyle}>Выберите нужный фрейм</span>
          <span style={fieldValueStyle}>
            {exportPayload ? `${exportPayload.name} — ${exportPayload.width}×${exportPayload.height}px` : "Не выбран"}
          </span>
        </button>
        {selectionError && <div style={{ ...errorTextStyle, marginTop: 6 }}>{selectionError}</div>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 32 }}>
        <div style={tabsTrackStyle}>
          <button type="button" onClick={() => setFallback(false)} style={fallback ? tabButtonStyle : tabButtonActiveStyle}>
            Ссылка
          </button>
          <button type="button" onClick={() => setFallback(true)} style={fallback ? tabButtonActiveStyle : tabButtonStyle}>
            Скриншот
          </button>
        </div>

        {!fallback ? (
          <div style={fieldContainerStyle}>
            {/* Floating label: once there's a value, the label collapses to a
                caption above it (Figma node 532:11253) instead of doubling as
                the placeholder — matches the frame-picker field's look. */}
            {url.length > 0 && <span style={fieldLabelStyle}>Ссылка на разработанный макет</span>}
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Ссылка на разработанный макет"
              style={fieldTextInputStyle}
            />
          </div>
        ) : (
          <label style={{ ...fieldButtonStyle, border: `1px solid ${colors.fieldBorder}` }}>
            <span style={fieldLabelStyle}>Скриншот разработанного макета</span>
            <span style={fieldValueStyle}>{screenshotFile ? screenshotFile.name : "Файл не выбран"}</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => setScreenshotFile(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
          </label>
        )}
      </div>

      {/* No margin below the button by default — the window hugs its content
          height, so with nothing following, the button should sit flush
          against the card's own bottom padding (same as the side padding). */}
      <button
        type="button"
        onClick={handleCompare}
        disabled={!exportPayload || loading}
        style={!exportPayload || loading ? primaryButtonDisabledStyle : primaryButtonStyle}
      >
        {loading ? "Ревью..." : "Провести ревью"}
      </button>

      {error && <div style={{ ...errorTextStyle, marginTop: 16 }}>{error}</div>}

      {/* The full breakdown (rows, screenshots, categories) renders straight onto the
          Figma canvas — this panel only needs to say whether that placement succeeded. */}
      {report && (
        <div
          style={{
            ...hintTextStyle,
            marginTop: 16,
            color: renderStatus === "error" ? colors.errorRed : colors.textSecondary,
          }}
        >
          {renderStatus === "rendering" && "Добавляю отчёт на холст Figma…"}
          {renderStatus === "done" && "Готово: отчёт добавлен на холст рядом с выбранным фреймом."}
          {renderStatus === "error" && `Не удалось добавить отчёт на холст: ${renderErrorMessage}`}
          {renderStatus === "idle" && "Отчёт готов."}
        </div>
      )}
    </div>
  );
}
