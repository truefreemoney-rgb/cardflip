// LOCAL only (10-31 App Review): the in-app plan pages before/after hiding the buy buttons. The local shots account
// is put on its trial for the run (access_override cleared), then comped back. Phone width, @3x.
// Run from the repo root with the dev server on 3000: node scripts/_app-plans-shots.mjs <outDir>
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
  for (const app of [false, true]) {
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark" });
    await c.addCookies([{ name: "cardflip_session", value: token, url: SITE }]);
    const p = await c.newPage();
    const tag = app ? "after" : "before";
    await p.goto(`${SITE}/pricing${app ? "?app=1" : ""}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(2500);
    await p.evaluate(() => window.scrollTo(0, 600));
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/pricing-${tag}.png` });
    await p.goto(`${SITE}/app/account${app ? "?app=1" : ""}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(3500);
    const plan = p.getByText("Plan", { exact: true }).first();
    await plan.evaluate((el) => el.scrollIntoView({ block: "center" })).catch(() => {});
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/account-${tag}.png` });
    await c.close();
  }
} finally {
  await b.close();
  await db.execute({ sql: "UPDATE users SET access_override = 'comp_standard' WHERE email = ?", args: [EMAIL] });
}
console.log("done");
