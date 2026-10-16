// Real Inventory summary bars (no text swapping) at 375px on iPhone WebKit: a normal total and a $199,999.98 one (10-16).
import { webkit } from "@playwright/test";
import path from "node:path";

const BASE = "http://localhost:3000";
const OUT = process.argv[2] ?? ".";
const browser = await webkit.launch();
for (const [name, prices] of [["summary-real-normal", [137.61]], ["summary-real-199999", [99999.99, 99999.99]]]) {
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  await page.request.post(`${BASE}/api/auth/signup`, { data: { name: "Sum", email: `sum-${Date.now().toString(36)}${name.length}@example.com`, password: "hunter22hunter" } });
  await page.request.post(`${BASE}/api/account/tour`);
  for (const price of prices) await page.request.post(`${BASE}/api/cards`, { data: { cardName: "Charizard", setName: "Base Set", cardNumber: "4", game: "pokemon", price } });
  await page.goto(`${BASE}/app/collection`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const b = page.locator("button[aria-controls='inventory-summary']");
  const info = await b.evaluate((el) => { const [a, e] = el.querySelector("span.flex-wrap").children; return `${el.textContent.trim()} | oneRow=${Math.abs(a.getBoundingClientRect().top - e.getBoundingClientRect().top) < 4}`; });
  await b.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name, info);
  await ctx.close();
}
await browser.close();
