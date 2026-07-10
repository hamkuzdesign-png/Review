import type { Page } from "playwright";
import type { DomNode } from "@app/shared";

const MAX_DOM_NODES = 2000;

/**
 * Runs inside the page (browser context), not Node — `lib: DOM` in
 * tsconfig only supplies types here, nothing is polyfilled at runtime.
 */
function collectDomNodes(maxNodes: number): DomNode[] {
  // tsx runs esbuild with keepNames on, which wraps every named function/arrow
  // binding in this body (rgbStringToHex, parsePx, toHex below) in a call to a
  // `__name(fn, "name")` helper it injects at the *top of the compiled module*
  // — not inside this function. Playwright's page.evaluate sends only this
  // function's own stringified source into the page, so that outer helper
  // isn't there and the bare `__name(...)` calls throw a ReferenceError. This
  // line is a plain assignment (not a declaration), so esbuild has no name to
  // preserve on it and leaves it alone — it just makes the free variable
  // `__name` that the wrapped calls below reference resolve to a no-op.
  (window as unknown as { __name?: (fn: unknown) => unknown }).__name ??= (fn) => fn;

  const rgbStringToHex = (rgbString: string): string | undefined => {
    const match = rgbString.match(/rgba?\(([^)]+)\)/);
    if (!match) return undefined;
    const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
    const [r, g, b, a] = parts;
    if (a === 0) return undefined;
    const toHex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
  };

  const parsePx = (value: string): number => {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : 0;
  };

  const results: DomNode[] = [];
  const all = document.body.querySelectorAll("*");
  let count = 0;

  for (const el of Array.from(all)) {
    if (count >= maxNodes) break;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const style = window.getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none" || parseFloat(style.opacity) === 0) continue;

    let directText = "";
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) directText += child.textContent ?? "";
    }
    directText = directText.trim();

    const tagName = el.tagName.toLowerCase();
    const hasImage =
      tagName === "img" ||
      tagName === "svg" ||
      tagName === "picture" ||
      (style.backgroundImage !== "none" && style.backgroundImage !== "");

    results.push({
      bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      tagName,
      id: el.id || undefined,
      testId:
        el.getAttribute("data-testid") ||
        el.getAttribute("data-test") ||
        el.getAttribute("data-qa") ||
        undefined,
      className: typeof el.className === "string" && el.className ? el.className : undefined,
      textContent: directText || undefined,
      color: rgbStringToHex(style.color),
      backgroundColor: rgbStringToHex(style.backgroundColor),
      hasImage: hasImage || undefined,
      fontFamily: style.fontFamily ? style.fontFamily.split(",")[0].replace(/["']/g, "").trim() : undefined,
      fontSize: parsePx(style.fontSize),
      fontWeight: parseInt(style.fontWeight, 10) || undefined,
      borderRadius: parsePx(style.borderRadius),
      paddingTop: parsePx(style.paddingTop),
      paddingRight: parsePx(style.paddingRight),
      paddingBottom: parsePx(style.paddingBottom),
      paddingLeft: parsePx(style.paddingLeft),
    });
    count++;
  }

  return results;
}

export async function extractDomTree(page: Page): Promise<DomNode[]> {
  return page.evaluate(collectDomNodes, MAX_DOM_NODES);
}
