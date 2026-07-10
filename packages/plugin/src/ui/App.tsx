import { useEffect, useState } from "react";
import { WebCompareTab } from "./WebCompareTab";
import { colors, fonts } from "./theme";

type Tab = "web" | "apk";

// The Figma design for this panel (node 529:1944) only covers the "Веб"
// flow — APK mode has no design yet, even though it still works in code.
// Hide the switcher instead of deleting the APK branch below, so it's ready
// to show again once APK has its own design.
const SHOW_MODE_SWITCHER = false;

export interface ExportPayload {
  png: string;
  layerTree: unknown;
  name: string;
  width: number;
  height: number;
}

export function App() {
  const [tab, setTab] = useState<Tab>("web");
  const [exportPayload, setExportPayload] = useState<ExportPayload | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data?.pluginMessage;
      if (!msg) return;
      if (msg.type === "exportResult") {
        setExportPayload({
          png: msg.png,
          layerTree: msg.layerTree,
          name: msg.name,
          width: msg.width,
          height: msg.height,
        });
        setSelectionError(null);
      } else if (msg.type === "selectionInvalid") {
        setSelectionError(msg.reason);
        setExportPayload(null);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Hug the window to its content height so the button always sits right at
  // the bottom instead of leaving empty space below it — body has no margin
  // or padding of its own (see ui-template.html), so its scrollHeight is
  // exactly the window height the plugin frame needs.
  useEffect(() => {
    const reportHeight = () => {
      parent.postMessage({ pluginMessage: { type: "resizeUI", height: document.body.scrollHeight } }, "*");
    };
    const observer = new ResizeObserver(reportHeight);
    observer.observe(document.body);
    reportHeight();
    return () => observer.disconnect();
  }, []);

  function requestExport() {
    parent.postMessage({ pluginMessage: { type: "requestExport" } }, "*");
  }

  return (
    <div
      style={{
        boxSizing: "border-box",
        border: `1px solid ${colors.cardBorder}`,
        borderRadius: 48,
        backgroundImage: colors.cardBackground,
        backgroundColor: colors.pageBg,
        // Uniform on all four sides — bottom (window end -> button) matches
        // the sides, and the sides/top were bumped +20px together.
        padding: 52,
        display: "flex",
        flexDirection: "column",
        gap: 28,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <span
          style={{
            fontFamily: fonts.eyebrow,
            // Caveat is a script face and already slants on its own — the
            // Figma source has no italic style on this node, and forcing one
            // here would synthesize a second, unwanted oblique on top of it.
            fontSize: 16,
            lineHeight: "16px",
            color: colors.brandRed,
            textTransform: "uppercase",
          }}
        >
          дэйли бэнкинг
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, color: colors.textPrimary }}>
          <h1
            style={{
              margin: 0,
              fontFamily: fonts.display,
              fontWeight: 500,
              fontSize: 40,
              lineHeight: "42px",
            }}
          >
            МТС РЕВЬЮЕР
          </h1>
          <p
            style={{
              margin: 0,
              fontFamily: fonts.body,
              fontSize: 14,
              lineHeight: "18px",
              opacity: 0.64,
            }}
          >
            Инструмент для проверки разработанных макетов
          </p>
        </div>
      </div>

      {SHOW_MODE_SWITCHER && (
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setTab("web")} disabled={tab === "web"}>
            Веб
          </button>
          <button onClick={() => setTab("apk")} disabled={tab === "apk"}>
            APK
          </button>
        </div>
      )}

      {tab === "web" && (
        <WebCompareTab exportPayload={exportPayload} selectionError={selectionError} onRequestExport={requestExport} />
      )}
      {tab === "apk" && (
        <div style={{ fontFamily: fonts.body, fontSize: 13, color: colors.textSecondary }}>
          Режим сравнения с APK ещё в разработке: сначала появится статический анализ ресурсов APK, затем
          автоматизация через ADB/эмулятор для реального скриншота экрана.
        </div>
      )}
    </div>
  );
}
