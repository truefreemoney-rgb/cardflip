// How long can "In Play $X  Earned $Y" get before "Show" no longer fits beside it? iPhone WebKit, 375px (10-16).
import { webkit } from "@playwright/test";

const BASE = "http://localhost:3000";
const browser = await webkit.launch();
const page = await (await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true })).newPage();
await page.request.post(`${BASE}/api/auth/signup`, { data: { name: "Fit", email: `fit-${Date.now().toString(36)}@example.com`, password: "hunter22hunter" } });
await page.request.post(`${BASE}/api/account/tour`);
await page.request.post(`${BASE}/api/cards`, { data: { cardName: "Charizard", setName: "Base", cardNumber: "4", game: "pokemon", price: 50 } });
await page.goto(`${BASE}/app/collection`, { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const res = await page.evaluate(() => {
  const b = document.querySelector("button[aria-controls='inventory-summary']");
  const st = document.createElement("style"); st.textContent = "button[aria-controls=inventory-summary] .hidden{display:inline!important}"; document.head.appendChild(st);
  const row = b.querySelector("span.flex-wrap");
  const [a, e] = row.children;
  const vals = ["$0.00", "$9.99", "$99.99", "$999.99", "$9,999.99", "$99,999.99"];
  const out = [];
  for (const label of ["In Play", "Market Value"]) for (const x of vals) for (const y of vals) {
    a.firstChild.textContent = label + " "; a.lastElementChild.textContent = x; e.lastElementChild.textContent = y;
    const one = Math.abs(a.getBoundingClientRect().top - e.getBoundingClientRect().top) < 4;
    out.push({ len: `${label} ${x} Earned ${y}`.length, one, s: `${label} ${x} | ${y}` });
  }
  return out;
});
const fits = res.filter((r) => r.one).map((r) => r.len), fails = res.filter((r) => !r.one).map((r) => r.len);
console.log("longest that fits with Show:", Math.max(...fits), " shortest that breaks:", Math.min(...fails));
for (const r of res.filter((r) => !r.one).sort((p, q) => p.len - q.len).slice(0, 4)) console.log(" breaks:", r.len, r.s);
await browser.close();
