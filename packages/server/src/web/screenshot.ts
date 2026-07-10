import { chromium } from "playwright";
import type { DomNode } from "@app/shared";
import { extractDomTree } from "./domExtract";

export interface LiveWebResult {
  png: Buffer;
  domNodes: DomNode[];
}

export async function captureLiveWebData(url: string, width: number, height: number): Promise<LiveWebResult> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    // "load" rather than "networkidle": real-world sites often keep background
    // requests (analytics, trackers, chat widgets) going forever, so
    // networkidle can time out even once the page is visually ready.
    await page.goto(url, { waitUntil: "load", timeout: 20000 });
    await page.waitForTimeout(800); // let late-rendering content/fonts settle
    await page.evaluate(() => window.scrollTo(0, 0));

    const domNodes = await extractDomTree(page);
    const png = await page.screenshot({ type: "png" });
    return { png, domNodes };
  } finally {
    await browser.close();
  }
}
