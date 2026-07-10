import type { CSSProperties } from "react";

// Visual language for the "МТС Ревьюер" panel (Figma node 529:1944), ported
// from the nakoplen project's real MTS Wide / MTS Compact font files and
// design tokens (~/Desktop/nakoplen/web/app/globals.css) — same brand system,
// so no more guessed system-font stand-ins for these two. Caveat (the
// handwritten eyebrow font) came from a Next.js font-cache on disk elsewhere
// (Google Fonts, OFL-licensed) since this plugin has no network access to
// fetch it fresh. The @font-face rules themselves are generated at build
// time from packages/plugin/assets/fonts (see scripts/build.mjs) since the
// plugin UI is a single inline HTML string with no ability to fetch its own
// files at runtime.
export const fonts = {
  display: "'MTS Wide', -apple-system, Arial, sans-serif",
  body: "'MTS Compact', -apple-system, \"Segoe UI\", Arial, sans-serif",
  eyebrow: "'Caveat', Georgia, \"Times New Roman\", serif",
} as const;

export const colors = {
  pageBg: "#101214",
  cardBorder: "rgba(255,255,255,0.1)",
  cardBackground:
    "linear-gradient(140.36deg, rgb(26,29,33) 108.01%, rgb(14,16,18) 34.683%, rgb(26,29,33) 177.37%), linear-gradient(90deg, rgb(14,16,18) 0%, rgb(14,16,18) 100%)",
  brandRed: "#ff0032",
  textPrimary: "#fafafa",
  textSecondary: "#969fa8",
  fieldBg: "rgba(98,108,119,0.25)",
  fieldBorder: "rgba(127,140,153,0.35)",
  tabsTrackBg: "rgba(197,189,255,0.08)",
  tabsActiveBg: "rgba(177,185,217,0.2)",
  errorRed: "#ff6b6b",
} as const;

export const fieldButtonStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  height: 64,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 2,
  padding: "0 12px",
  border: "none",
  borderRadius: 16,
  background: colors.fieldBg,
  cursor: "pointer",
  textAlign: "left",
};

export const fieldLabelStyle: CSSProperties = {
  fontFamily: fonts.body,
  fontSize: 14,
  lineHeight: "20px",
  color: colors.textSecondary,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

export const fieldValueStyle: CSSProperties = {
  fontFamily: fonts.body,
  fontSize: 17,
  lineHeight: "24px",
  color: colors.textPrimary,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

// Same box as fieldButtonStyle (label-on-top-of-value field), but for a div
// wrapping a real <input> rather than a <button> — bordered like Figma's
// "Ссылка на разработанный макет" field, text cursor instead of a pointer.
export const fieldContainerStyle: CSSProperties = {
  ...fieldButtonStyle,
  border: `1px solid ${colors.fieldBorder}`,
  cursor: "text",
};

export const fieldTextInputStyle: CSSProperties = {
  ...fieldValueStyle,
  width: "100%",
  padding: 0,
  border: "none",
  outline: "none",
  background: "transparent",
};

export const tabsTrackStyle: CSSProperties = {
  display: "flex",
  gap: 0,
  padding: 4,
  borderRadius: 16,
  background: colors.tabsTrackBg,
  width: "fit-content",
};

export const tabButtonStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: "6px 12px",
  borderRadius: 12,
  fontFamily: fonts.body,
  fontWeight: 500,
  fontSize: 14,
  lineHeight: "20px",
  color: colors.textPrimary,
  cursor: "pointer",
};

export const tabButtonActiveStyle: CSSProperties = {
  ...tabButtonStyle,
  background: colors.tabsActiveBg,
};

export const primaryButtonStyle: CSSProperties = {
  boxSizing: "border-box",
  width: "100%",
  border: "none",
  borderRadius: 16,
  padding: "18px 22px",
  background: colors.brandRed,
  color: "#ffffff",
  fontFamily: fonts.display,
  fontWeight: 700,
  fontSize: 12,
  letterSpacing: "0.6px",
  lineHeight: "16px",
  textTransform: "uppercase",
  cursor: "pointer",
};

export const primaryButtonDisabledStyle: CSSProperties = {
  ...primaryButtonStyle,
  background: colors.fieldBg,
  color: colors.textSecondary,
  cursor: "default",
};

export const hintTextStyle: CSSProperties = {
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: "18px",
  color: colors.textSecondary,
};

export const errorTextStyle: CSSProperties = {
  fontFamily: fonts.body,
  fontSize: 13,
  lineHeight: "18px",
  color: colors.errorRed,
};
