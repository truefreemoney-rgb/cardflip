// 10-31 LOCAL: App Store review screenshots for the CardFlip + Pro subscriptions = the plans page as the iPhone app
// shows it (?app=1), signed in as the local shots account on its trial, 430x932 @3x = 1290x2796. Comped back after.
// node scripts/_iap-review-shots.mjs <outDir>   (dev server on 3000)
import { chromium } from "@playwright/test";
import { createClient } from "@libsql/client";
const out = process.argv[2];
const SITE = "http://localhost:3000";
const db = createClient({ url: "file:data/cardflip.db" });
const EMAIL = "shots@cardflip.dev";
await db.execute({ sql: "UPDATE users SET access_override = NULL WHERE email = ?", args: [EMAIL] });
const b = await chromium.launch();
try {
  const r = await (await b.newContext()).request.post(`${SITE}/api/auth/login`, { headers: { "x-cardflip-app": "web/1.0.0", "x-cardflip-device": "appstore-shots" }, data: { email: EMAIL, password: "Shots-Screens-2026!" } });
  const token = (await r.json()).session?.token;
  if (!token) throw new Error(`login ${r.status()}`);
  const c = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await c.addCookies([{ name: "cardflip_session", value: token, url: SITE }]);
  const p = await c.newPage();
  await p.goto(`${SITE}/pricing?app=1`, { waitUntil: "networkidle", timeout: 120000 });
  await p.waitForTimeout(3000);
  for (const [name, re] of [["standard", /^250 scans a month/], ["pro", /^750 scans a month/]]) {
    const el = p.getByText(re).first();
    await el.evaluate((e) => {
      e.scrollIntoView({ block: "start" });
      window.scrollBy(0, -140);
    });
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/iap-review-${name}-plan.png` });
  }
} finally {
  await b.close();
  await db.execute({ sql: "UPDATE users SET access_override = 'comp_standard' WHERE email = ?", args: [EMAIL] });
}
console.log("done");
