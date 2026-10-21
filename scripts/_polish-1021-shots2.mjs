// Phone shots, batch 2 of the 10-21 polish (review J): before = cardflip.io, after = local dev. Also checks that the two
// Watch buttons on a card page follow each other (local, admin account; adds the card to the LOCAL watchlist only).
// node scripts/_polish-1021-shots2.mjs <outDir>
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "docs/shots";
const b = await chromium.launch();
const phone = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function page(url, { login = false } = {}) {
  const c = await b.newContext(phone);
  await c.addCookies([{ name: "cf_internal", value: "1", url: new URL(url).origin }]);
  if (login) {
    const r = await c.request.post("http://localhost:3000/api/auth/login", { data: { email: "admin", password: "password" } });
    if (!r.ok()) throw new Error(`login ${r.status()} ${await r.text()}`);
  }
  const p = await c.newPage();
  await p.goto(url, { waitUntil: "networkidle", timeout: 180_000 });
  await p.waitForTimeout(1200);
  return { c, p };
}
async function at(p, text, file) {
  await p.getByText(text, { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {});
  await p.evaluate(() => window.scrollBy(0, -160));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/${file}` });
  console.log("shot", file);
}

// 1. Card page: "Price history" printed once (section heading), not again inside the chart box.
const card = "/cards/pokemon/skyridge/ho-oh--ecard3-149";
{ const { c, p } = await page(`https://cardflip.io${card}`); await at(p, "Price history", "polish-1021-chart-title-before.jpg"); await c.close(); }
{ const { c, p } = await page(`http://localhost:3000${card}`); await at(p, "Price history", "polish-1021-chart-title-after.jpg"); await c.close(); }

// 2. Big set pager: "Show more" -> "Next Page".
const big = "/cards/magic/secret-lair-drop";
{ const { c, p } = await page(`https://cardflip.io${big}`); await at(p, "Show more", "polish-1021-pager-before.jpg"); await c.close(); }
{ const { c, p } = await page(`http://localhost:3000${big}`); await at(p, "Next Page", "polish-1021-pager-after.jpg"); await c.close(); }

// 3. Inventory (local admin): "Missing Price" chip, 16px sort field, "Show More".
{ const { c, p } = await page("http://localhost:3000/app/collection", { login: true }); await p.waitForTimeout(2500); await p.screenshot({ path: `${out}/polish-1021-inventory-after.jpg` }); console.log("shot polish-1021-inventory-after.jpg"); await c.close(); }

// 4. Watch sync: tap the sticky bar's Watch, the price row's copy must turn to "Watching" too.
{
  const { c, p } = await page(`http://localhost:3000${card}`, { login: true });
  const buttons = p.getByRole("button", { name: "Watch this price" });
  const n = await buttons.count();
  console.log("watch buttons on the page:", n);
  if (n >= 2) {
    await buttons.nth(n - 1).click();
    await p.waitForTimeout(4000);
    const left = await p.getByRole("button", { name: "Watch this price" }).count();
    const watching = await p.getByText("Watching.", { exact: false }).count();
    console.log(`after one tap: ${left} Watch buttons left, ${watching} "Watching." notes`);
    await p.evaluate(() => window.scrollTo(0, 0));
    await at(p, "Watching.", "polish-1021-watch-sync-after.jpg");
  }
  await c.close();
}
await b.close();
