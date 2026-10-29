// App Store screenshots, raw screens (docs/APP-STORE-LISTING.md "Screenshots to make"): the Expo web build
// (localhost:8081) against the local dev server (localhost:3000), 440x956 @3x = 1320x2868 (6.9" iPhone).
// Guest screens use a stored intro flag + a stored guest scan; the scanner gets a fake camera feed (Y4M).
import { chromium } from "@playwright/test";
import fs from "node:fs";
const [out, y4m] = process.argv.slice(2);
const APP = "http://localhost:8081", SITE = "http://localhost:3000";
const VP = { width: 440, height: 956 };
const CARD = { id: "swsh7-215", game: "pokemon", condition: "Near Mint", variant: null };
const b = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${y4m}`] });
async function ctx(store) {
  const c = await b.newContext({ viewport: VP, deviceScaleFactor: 3, isMobile: true, hasTouch: true, colorScheme: "dark", permissions: ["camera"] });
  await c.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, store);
  return c;
}
async function shot(p, name, ms = 2500) {
  await p.waitForTimeout(ms);
  await p.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
}
// --- guest: fan, scanner, result page
{
  const c = await ctx({ cardflip_intro_seen: "1" });
  const p = await c.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.goto(`${APP}/first-scan`, { waitUntil: "networkidle" });
  await shot(p, "01-first-scan", 3000);
  await p.getByText("Scan Your Card", { exact: true }).click();
  await p.waitForTimeout(4000);
  await p.evaluate(() => { for (const el of document.querySelectorAll("div, span")) if (el.textContent === "Test photo" && el.children.length === 0) { const n = el.parentElement ?? el; n.style.visibility = "hidden"; } });
  await shot(p, "02-scanner", 1500);
  await c.close();
}
{
  const c = await ctx({ cardflip_intro_seen: "1", cardflip_guest_scan: JSON.stringify(CARD) });
  const p = await c.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.goto(`${APP}/first-card`, { waitUntil: "networkidle" });
  await shot(p, "03-first-card", 4000);
  await c.close();
}
// --- signed in: Inventory, Watchlist, the editor
{
  let token = process.env.SHOTS_TOKEN;
  if (!token) {
    const r = await (await b.newContext()).request.post(`${SITE}/api/auth/login`, { headers: { "x-cardflip-app": "web/1.0.0", "x-cardflip-device": "appstore-shots" }, data: { email: "shots@cardflip.dev", password: "Shots-Screens-2026!" } });
    if (!r.ok()) throw new Error(`login ${r.status()}`);
    token = (await r.json()).session?.token;
  }
  if (!token) throw new Error("no token");
  const c = await ctx({ cardflip_intro_seen: "1", cardflip_session: token });
  const p = await c.newPage();
  p.on("pageerror", (e) => console.log("pageerror", e.message));
  await p.goto(`${APP}/cards`, { waitUntil: "networkidle" });
  await shot(p, "04-inventory", 6000);
  await p.getByText("Watchlist", { exact: true }).last().click();
  await shot(p, "05-watchlist", 6000);
  await p.getByText("Inventory", { exact: true }).last().click();
  await p.waitForTimeout(4000);
  const f = p.frameLocator("iframe").first();
  const first = f.locator("a").filter({ hasText: /^Build Listing$/ }).first();
  await first.click({ timeout: 10000 }).catch((e) => console.log("card click failed", e.message));
  await p.waitForTimeout(3000);
  await shot(p, "06-editor-top", 500);
  await p.mouse.move(220, 600);
  for (const [i, dy] of [[1, 520], [2, 520], [3, 560]]) {
    await p.mouse.wheel(0, dy);
    await shot(p, `06-editor-${i}`, 1200);
  }
  await c.close();
}
await b.close();
