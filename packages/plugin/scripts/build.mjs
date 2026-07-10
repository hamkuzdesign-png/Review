import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const watch = process.argv.includes("--watch");

mkdirSync(path.join(root, "dist"), { recursive: true });

// Figma plugin UI can't read a .env file at runtime, so the backend base URL
// is baked in at build time. This plugin is local-only: the backend always
// runs on the same machine as Figma, so both `npm run watch` and `npm run
// build` default to localhost. Override with BACKEND_URL=... only if you're
// pointing at a non-default local port.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:4517";

// Figma plugin UI is a single inline HTML string (figma.showUI(__html__)) with
// no ability to fetch its own asset files at runtime, so the brand fonts have
// to be embedded as base64 data URIs directly in the @font-face CSS rather
// than linked by path.
const FONT_FACES = [
  { family: "MTS Wide", weight: 500, file: "MTSWide-Medium.woff2" },
  { family: "MTS Wide", weight: 700, file: "MTSWide-Bold.woff2" },
  { family: "MTS Compact", weight: 400, file: "MTSCompact-Regular.woff2" },
  { family: "MTS Compact", weight: 500, file: "MTSCompact-Medium.woff2" },
  // Cyrillic-range subset of Google's Caveat (OFL), a variable font covering
  // weights 400-700 in one file — pulled from a Next.js font-cache elsewhere
  // on disk since this plugin has no network access to fetch it fresh.
  { family: "Caveat", weight: "400 700", file: "Caveat-Cyrillic.woff2" },
];

function buildFontFaceCss() {
  return FONT_FACES.map(({ family, weight, file }) => {
    const bytes = readFileSync(path.join(root, "assets/fonts", file));
    const base64 = bytes.toString("base64");
    return `@font-face { font-family: '${family}'; font-weight: ${weight}; font-style: normal; src: url(data:font/woff2;base64,${base64}) format('woff2'); }`;
  }).join("\n");
}

function writeUiHtml(js) {
  const template = readFileSync(path.join(root, "src/ui-template.html"), "utf8");
  const html = template.replace("__SCRIPT__", js).replace("__FONTS__", buildFontFaceCss());
  writeFileSync(path.join(root, "dist/ui.html"), html);
}

const mainConfig = {
  entryPoints: [path.join(root, "src/main.ts")],
  outfile: path.join(root, "dist/main.js"),
  bundle: true,
  platform: "browser",
  target: "es2017",
  format: "iife",
};

const uiConfig = {
  entryPoints: [path.join(root, "src/ui.tsx")],
  bundle: true,
  platform: "browser",
  target: "es2017",
  format: "iife",
  write: false,
  jsx: "automatic",
  define: { "process.env.BACKEND_URL": JSON.stringify(BACKEND_URL) },
};

if (watch) {
  const mainCtx = await esbuild.context(mainConfig);
  const uiCtx = await esbuild.context({
    ...uiConfig,
    plugins: [
      {
        name: "write-ui-html",
        setup(build) {
          build.onEnd((result) => {
            if (result.outputFiles?.[0]) writeUiHtml(result.outputFiles[0].text);
          });
        },
      },
    ],
  });
  await Promise.all([mainCtx.watch(), uiCtx.watch()]);
  console.log("Watching for changes...");
} else {
  await esbuild.build(mainConfig);
  const uiResult = await esbuild.build(uiConfig);
  writeUiHtml(uiResult.outputFiles[0].text);
  console.log("Build complete.");
}
