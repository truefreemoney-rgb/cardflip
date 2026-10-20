// Scratch: phone shots of the 10-20 flagged-price fallthrough (Black Lotus Unlimited) on the local dev server.
import { chromium } from "@playwright/test";
const out = process.argv[2] ?? "docs/shots";
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const r = await c.request.post("http://localhost:3000/api/auth/login", { data: { email: "admin", password: "password" } });
if (!r.ok()) throw new Error(`login ${r.status()} ${await r.text()}`);
const p = await c.newPage();
await p.goto("http://localhost:3000/cards/magic/unlimited-edition/black-lotus--2ed-233", { waitUntil: "networkidle", timeout: 120000 });
await p.getByText("MARKET PRICE", { exact: false }).first().scrollIntoViewIfNeeded();
await p.evaluate(() => window.scrollBy(0, -120));
await p.waitForTimeout(800);
await p.screenshot({ path: `${out}/lotus-2ed-card-page-phone.jpg`, type: "jpeg", quality: 80 });
await p.goto("http://localhost:3000/app/price-check", { waitUntil: "networkidle", timeout: 120000 });
const gameSel = p.locator("select").first();
if (await gameSel.count()) await gameSel.selectOption({ label: "Magic" }).catch(() => {});
await p.getByPlaceholder("Name or number").fill("Black Lotus");
await p.keyboard.press("Enter");
await p.waitForTimeout(5000);
console.log("buttons:", (await p.getByRole("button").allTextContents()).filter((t) => /lotus/i.test(t)).slice(0, 6));
console.log("body:", (await p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 300));
const open = p.getByRole("button", { name: /Open Black Lotus/ }).first();
if (await open.count()) { await open.click(); await p.waitForTimeout(3000); }
else { const img = p.getByRole("img", { name: /Black Lotus/ }).first(); if (await img.count()) { await img.click(); await p.waitForTimeout(3000); } }
await p.screenshot({ path: `${out}/lotus-2ed-app-popup-phone.jpg`, type: "jpeg", quality: 80 });
console.log("popup:", (await p.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 500));
await b.close();
