// Before/after of the two visible 10-16 changes (Inventory summary "Show" word, chart date buttons), iPhone WebKit 375px.
// "Before" puts the old classes back on the same element, so the two pictures differ only by that change.
import { webkit } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const OUT = process.argv[2] ?? "wrap-ba";
fs.mkdirSync(OUT, { recursive: true });
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
await page.request.post(`${BASE}/api/auth/signup`, { data: { name: "Before After", email: `ba-${Date.now().toString(36)}@example.com`, password: "hunter22hunter" } });
await page.request.post(`${BASE}/api/account/tour`);
const found = await (await page.request.get(`${BASE}/api/search-card?name=charizard&lang=en&typed=1&limit=20`)).json();
for (const c of (found.cards ?? found).filter((c) => c.imageSmall && c.prices?.some((p) => p.market > 0)).slice(0, 2)) {
  const m = Math.max(...c.prices.map((p) => p.market || 0));
  await page.request.post(`${BASE}/api/cards`, { data: { cardName: c.name, setName: c.setName, cardNumber: c.number, imageUrl: c.imageSmall, game: "pokemon", price: m } });
}

const big = () => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const ns = []; let n; while ((n = w.nextNode())) ns.push(n);
  for (const n of ns) { const r = n.textContent.replace(/\$\s?\d[\d,]*(\.\d+)?/g, "$99,999.99"); if (r !== n.textContent) n.textContent = r; }
};
const oldSummary = () => {
  const b = document.querySelector("button[aria-controls='inventory-summary']");
  b.className = b.className.replace("gap-2 px-4", "gap-3 px-5");
  b.querySelector("span.flex-wrap").className = b.querySelector("span.flex-wrap").className.replace("gap-x-3", "gap-x-4");
  const st = document.createElement("style"); st.textContent = "button[aria-controls=inventory-summary] .hidden{display:inline!important}"; document.head.appendChild(st);
};
const oldChart = () => {
  const s = document.querySelector("section[aria-label='Price history']");
  const head = s.firstElementChild; head.className = "flex flex-wrap items-end justify-between gap-x-4 gap-y-2";
};

const go = async (url, sel, name, before, isBig) => {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: "header,.sticky{position:static!important}" });
  if (isBig) await page.evaluate(big);
  if (before) await page.evaluate(before);
  await page.waitForTimeout(200);
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(name);
};
const S = "button[aria-controls='inventory-summary']";
await go("/app/collection", S, "summary-1-before-normal", oldSummary, false);
await go("/app/collection", S, "summary-2-before-99999", oldSummary, true);
await go("/app/collection", S, "summary-3-after-99999", null, true);
await go("/app/collection", S, "summary-0-after-normal", null, false);
await browser.close(); process.exit(0);
const card = await page.evaluate(async () => ((await (await fetch("/cards/pokemon/30th-celebration")).text()).match(/href="(\/cards\/pokemon\/30th-celebration\/[^"]+)"/) || [])[1]);
const C = "section[aria-label='Price history']";
await go(card, C, "chart-1-before-normal", oldChart, false);
await go(card, C, "chart-2-before-99999", oldChart, true);
await go(card, C, "chart-3-after-normal", null, false);
await go(card, C, "chart-4-after-99999", null, true);
await browser.close();
