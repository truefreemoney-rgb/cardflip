// 10-21: phone-width shots of a set page where stopped cards (no TCGplayer sale lately) come back at their last recorded price.
// node scripts/_set-last-recorded-shot.mjs <out-dir> <base-url> <tag>   e.g. docs/shots https://cardflip.io before
import { chromium } from "@playwright/test";
const [out = ".", base = "http://localhost:3000", tag = "after"] = process.argv.slice(2);
const pages = [["holon-phantoms", "/cards/pokemon/holon-phantoms", "Pikachu Star"]];
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
for (const [name, path, card] of pages) {
  const p = await ctx.newPage();
  await p.goto(`${base}${path}?heat=off`, { waitUntil: "networkidle", timeout: 120000 });
  await p.getByRole("button", { name: /decline|reject|only necessary|essential/i }).first().click({ timeout: 2000 }).catch(() => {});
  // The first card tiles: the list starts under the summary strip.
  const tile = p.getByText(card, { exact: false }).first();
  const found = await tile.count().then((n) => n > 0);
  if (found) {
    await tile.scrollIntoViewIfNeeded();
    await p.evaluate(() => window.scrollBy(0, -220));
  } else {
    await p.getByText(/most valuable/i).first().scrollIntoViewIfNeeded().catch(() => {});
  }
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/set-last-recorded-${name}-${tag}.png` });
  console.log(tag, name, found ? `${card} on the list` : `${card} NOT on the list`);
  await p.close();
}
await b.close();
