// Pricing cards with Australian prices (A$34.99 squeezed "750 scans a month" into four lines on a desktop column, 11-03).
// Local dev server; the page reads the visitor country from sessionStorage cf_geo. node scripts/_plan-au-shots.mjs <outDir>
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "docs/shots";
const b = await chromium.launch();
const runs = [
  ["plan-cards-au-desktop.jpg", "AU", { viewport: { width: 1440, height: 1000 } }],
  ["plan-cards-us-desktop.jpg", "US", { viewport: { width: 1440, height: 1000 } }],
  ["plan-cards-au-phone.jpg", "AU", { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
];
for (const [file, country, ctx] of runs) {
  const c = await b.newContext(ctx);
  await c.addCookies([{ name: "cf_internal", value: "1", url: "http://localhost:3000" }]);
  await c.addInitScript((cc) => sessionStorage.setItem("cf_geo", cc), country);
  const p = await c.newPage();
  await p.goto("http://localhost:3000/pricing", { waitUntil: "networkidle", timeout: 180_000 });
  await p.waitForTimeout(2500);
  const grid = p.locator("div.grid").filter({ has: p.locator("p.whitespace-nowrap") }).first();
  await grid.scrollIntoViewIfNeeded();
  const subs = await p.locator("p.whitespace-nowrap").evaluateAll((els) => els.map((e) => `${e.textContent} ${Math.round(e.getBoundingClientRect().height)}px`));
  if (ctx.isMobile) {
    await p.locator(".rounded-3xl").filter({ hasText: "750 scans a month" }).first().screenshot({ path: `${out}/${file}` });
  } else await grid.screenshot({ path: `${out}/${file}` });
  console.log(file, subs.join(" | "));
  await c.close();
}
await b.close();
