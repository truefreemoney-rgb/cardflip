// Phone shots of the new iPhone-app lines on /privacy and /terms (10-29), scrolled to the paragraph.
import { chromium } from "@playwright/test";
const out = process.argv[2];
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
const p = await c.newPage();
for (const [path, needle] of [["privacy", "The CardFlip iPhone app:"], ["terms", "The CardFlip iPhone app (from"]]) {
  await p.goto(`http://localhost:3000/${path}`, { waitUntil: "networkidle", timeout: 120000 });
  const el = p.getByText(needle, { exact: false }).first();
  await el.scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -140));
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/legal-${path}-app-line-phone.jpg`, type: "jpeg", quality: 85 });
  console.log("shot", path);
}
await b.close();
