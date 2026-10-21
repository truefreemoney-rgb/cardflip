// READ ONLY (prod, logged out): the public header's nav rows at 375px (TO-TEST "home nav row 1 = search, How It Works,
// Features, Card Prices; row 2 = Pricing, Log In, Get Started; nothing clipped"). Page GETs only; ?heat=off keeps it out of the heat map.
//   node scripts/_navrows-check.mjs [outDir]
import { chromium } from "playwright";
const out = process.argv[2] ?? ".";
const pages = ["/", "/features", "/cards/pokemon"];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const p of pages) {
  const page = await ctx.newPage();
  await page.goto(`https://cardflip.io${p}${p.includes("?") ? "&" : "?"}heat=off`, { waitUntil: "networkidle", timeout: 45_000 });
  const r = await page.evaluate(() => {
    const header = document.querySelector("header") ?? document.body;
    const items = [...header.querySelectorAll("a, button")]
      .filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.top < 200; })
      .map((e) => { const b = e.getBoundingClientRect(); return { t: (e.getAttribute("aria-label") || e.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24), top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right) }; });
    const rows = {};
    for (const i of items) (rows[i.top] ??= []).push(i);
    return { sw: document.documentElement.scrollWidth, clipped: items.filter((i) => i.left < 0 || i.right > 375).map((i) => i.t), rows: Object.entries(rows).map(([top, list]) => `${top}: ${list.sort((a, b) => a.left - b.left).map((i) => i.t).join(" | ")}`) };
  });
  console.log(p, JSON.stringify(r));
  await page.screenshot({ path: `${out}/navrows${p.replace(/\//g, "-") || "-home"}.png`, clip: { x: 0, y: 0, width: 375, height: 200 } });
  await page.close();
}
await browser.close();
