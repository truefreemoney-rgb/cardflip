// Phone shots for the 10-21 polish batch (review J items): before = cardflip.io (live code), after = local dev.
// node scripts/_polish-1021-shots.mjs <outDir>
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "docs/shots";
const b = await chromium.launch();
const phone = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function shot(url, file, { login = false, scrollTo = null, clip = null } = {}) {
  const c = await b.newContext(phone);
  // Keep these visits out of the heat map and the analytics (cf_internal, memory heatmap-users-only).
  await c.addCookies([{ name: "cf_internal", value: "1", url: new URL(url).origin }]);
  if (login) {
    const r = await c.request.post("http://localhost:3000/api/auth/login", { data: { email: "admin", password: "password" } });
    if (!r.ok()) throw new Error(`login ${r.status()} ${await r.text()}`);
  }
  const p = await c.newPage();
  await p.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
  await p.waitForTimeout(1200);
  if (scrollTo) {
    const el = p.getByText(scrollTo, { exact: false }).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await p.evaluate(() => window.scrollBy(0, -140));
    await p.waitForTimeout(500);
  }
  await p.screenshot({ path: `${out}/${file}`, ...(clip ? { clip } : {}) });
  console.log("shot", file);
  await c.close();
}

// 1. Set page summary strip: "Set value 7 days" -> "7-day change".
await shot("https://cardflip.io/cards/pokemon/skyridge", "polish-1021-set-strip-before.jpg", { scrollTo: "Set value 7 days" });
await shot("http://localhost:3000/cards/pokemon/skyridge", "polish-1021-set-strip-after.jpg", { scrollTo: "7-day change" });
// 2. /scan signed in: "Open App" -> "Open CardFlip".
await shot("http://localhost:3000/scan", "polish-1021-scan-open-after.jpg", { login: true });
await b.close();
