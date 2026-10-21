// Local (10-21): phone-width shots of card pages that were blank and now print the last recorded price.
// node scripts/_last-recorded-shot.mjs <out-dir>
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? ".";
const pages = [
  ["pikachu-star", "/cards/pokemon/holon-phantoms/pikachu-star--ex13-104"],
  ["blastoise-1st", "/cards/pokemon/base-set-1st-edition/blastoise--base1-2-1st"],
];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const [name, path] of pages) {
  const p = await ctx.newPage();
  await p.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle", timeout: 90000 });
  // Dismiss the cookie banner if it covers the bar.
  await p.getByRole("button", { name: /decline|reject|only necessary|essential/i }).first().click({ timeout: 2000 }).catch(() => {});
  await p.getByText(/^As of /).first().scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -260));
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/last-recorded-${name}.png` });
  await p.close();
}
await b.close();
console.log("shots written to", out);
