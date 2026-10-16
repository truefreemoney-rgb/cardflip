// iPhone (WebKit, 375px) screenshots of every spot changed by the 10-16 "no extra rows" pass, with every price
// forced to $99,999.99, every percent to the widest pill, and the size tier the code picks for $99,999.99.
// Run: node scripts/_wrap-shots.mjs [outDir]
import { webkit } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3000";
const OUT = process.argv[2] ?? "wrap-shots";
fs.mkdirSync(OUT, { recursive: true });
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();

const email = `wraps-${Date.now().toString(36)}@example.com`;
await page.request.post(`${BASE}/api/auth/signup`, { data: { name: "Wrap Shots", email, password: "hunter22hunter" } });
await page.request.post(`${BASE}/api/account/tour`);
const found = await (await page.request.get(`${BASE}/api/search-card?name=charizard&lang=en&typed=1&limit=40`)).json();
for (const [i, c] of (found.cards ?? found).filter((c) => c.imageSmall && c.prices?.some((p) => p.market > 0)).slice(0, 4).entries()) {
  const m = Math.max(...c.prices.map((p) => p.market || 0));
  await page.request.post(`${BASE}/api/wishlist`, { data: { card: c, language: "en", price: +(m * 0.5).toFixed(2) } });
  await page.request.post(`${BASE}/api/cards`, { data: { cardName: c.name, setName: c.setName, cardNumber: c.number, imageUrl: c.imageSmall, game: "pokemon", price: i < 2 ? 99999.99 : Math.max(1, m) } });
}

const stress = () => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = w.nextNode())) nodes.push(n);
  for (const n of nodes) {
    const v = n.textContent;
    let r = v.replace(/[$£€]\s?\d[\d,]*(\.\d+)?/g, (m) => m[0] + "99,999.99").replace(/\d+(\.\d+)?%/g, "99.9%");
    const next = n.nextSibling;
    if (next && next.nodeType === 3 && next.textContent.startsWith("%")) r = r.replace(/\d+(\.\d+)?\s*$/, "99.9");
    const prev = n.previousSibling;
    if (prev && prev.nodeType === 3 && /[$£€]\s*$/.test(prev.textContent)) r = r.replace(/^\s*\d[\d,]*(\.\d+)?/, "99,999.99");
    if (r !== v) n.textContent = r;
  }
  // the tier each tile's code picks for $99,999.99
  for (const e of document.querySelectorAll("button.shrink-0.rounded-2xl span.flex-wrap > span:first-child")) e.className = e.className.replace(/text-\[1[35]px\]/, "text-[12px]");
  for (const e of document.querySelectorAll("p.font-display.leading-none")) e.className = e.className.replace(/text-(xl|\[1[47]px\])(?=\s|$)/, "text-[13px]");
  for (const l of document.querySelectorAll("span.uppercase.text-brand-300")) { const p = l.nextElementSibling; if (p) p.className = p.className.replace("text-sm", "text-[11px]"); }
};

const shot = async (url, name, locate, { scrollY } = {}) => {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(stress);
  await page.waitForTimeout(200);
  await page.addStyleTag({ content: "header,.sticky{position:static!important}" });
  const el = await page.evaluateHandle(locate);
  const target = el.asElement();
  if (!target) return console.log(`${name}: NOT FOUND`);
  await target.scrollIntoViewIfNeeded();
  await target.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`${name}: ok`);
};

const sectionWith = (txt) => new Function(`return [...document.querySelectorAll("section,div")].filter(e=>e.textContent.includes(${JSON.stringify(txt)})).sort((a,b)=>a.textContent.length-b.textContent.length)[0]`);
await shot("/app/price-check", "1-search-watchlist", () => document.querySelector("button.shrink-0.rounded-2xl")?.closest("section"));
await shot("/app/wishlist", "2-watchlist-page", () => document.querySelector("p.font-display.leading-none")?.closest("ul,div.grid"));
await shot("/app/collection", "3-inventory-summary", () => document.querySelector("button[aria-controls='inventory-summary']")?.parentElement);
await shot("/", "4-home-game-tiles", () => document.querySelector("span.uppercase.text-brand-300")?.closest("div.grid"));
await shot("/", "5-home-binder-numbers", () => [...document.querySelectorAll("dl")].find((d) => d.textContent.includes("Fees and Postage")));
await shot("/app/collection/insights", "6-insights", () => document.querySelector("main") ?? document.body);
const card = await page.evaluate(async () => {
  const r = await fetch("/cards/pokemon/30th-celebration");
  const h = await r.text();
  return (h.match(/href="(\/cards\/pokemon\/30th-celebration\/[^"]+)"/) || [])[1];
});
if (card) {
  await shot(card, "7-card-price-chart", () => document.querySelector("section[aria-label='Price history']"));
}
await browser.close();
