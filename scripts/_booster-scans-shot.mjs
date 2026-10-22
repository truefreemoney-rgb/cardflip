// Phone shot of /admin/users with Adjust Scans open on a Booster-tier (or the first non-owner) account: the new
// Plan / Booster toggle (TASKS B, 10-21). Local dev server, admin console sign-in from .env.local.
// node scripts/_booster-scans-shot.mjs <outDir>
import fs from "node:fs";
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "docs/shots";
const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].replace(/^"|"$/g, "")]));
const b = await chromium.launch();
const phone = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const c = await b.newContext(phone);
await c.addCookies([{ name: "cf_internal", value: "1", url: "http://localhost:3000" }]);
const r = await c.request.post("http://localhost:3000/api/admin/login", { data: { user: env.ADMIN_PANEL_USER ?? "admin", username: env.ADMIN_PANEL_USER ?? "admin", password: env.ADMIN_PANEL_PASSWORD ?? "password" } });
if (!r.ok()) throw new Error(`admin login ${r.status()} ${await r.text()}`);
const p = await c.newPage();
await p.goto("http://localhost:3000/admin/users", { waitUntil: "networkidle", timeout: 180_000 });
await p.waitForTimeout(1500);
// Rows open on a tap ("Tap a row for plan, plan scans, ..."): prefer a Booster-only row ("pack scans left"), else the
// first non-owner row, then its Adjust Scans button.
const packRow = p.getByText(/pack scans left/).first();
const hasPack = (await packRow.count()) > 0;
const rowText = hasPack ? packRow : p.getByText(/cards$/).nth(1);
await rowText.scrollIntoViewIfNeeded();
await rowText.click();
await p.waitForTimeout(700);
const btn = p.getByRole("button", { name: "Adjust Scans" }).first();
await btn.scrollIntoViewIfNeeded();
await btn.click();
const row = packRow;
await p.waitForTimeout(600);
const form = p.locator("form").filter({ hasText: "Booster scans" }).first();
await form.scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -120));
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/admin-booster-scans-after-phone.jpg` });
console.log("shot admin-booster-scans-after-phone.jpg (Booster row:", (await row.count()) > 0, ")");
await b.close();
