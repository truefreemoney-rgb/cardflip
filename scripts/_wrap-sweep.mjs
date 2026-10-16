// Phone-width "extra row" sweep (10-16, Chris: no extra rows appearing out of nowhere, anywhere).
// Every page at 375px: swap every price for $99,999.99 and every percent for 99.9%, then flag any
// short value, pill, badge or button label that breaks onto a second line or gets clipped.
// Run: node scripts/_wrap-sweep.mjs [baseUrl]   (dev server on :3000; writes shots to $SHOTS or ./wrap-shots)
import { chromium, webkit } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.argv[2] ?? "http://localhost:3000";
const SHOTS = process.env.SHOTS ?? "wrap-shots";
const ENGINE = process.env.ENGINE === "webkit" ? webkit : chromium;
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await ENGINE.launch();
// serviceWorkers blocked on WebKit: Playwright's Windows WebKit has no push service, and pushManager.getSubscription()
// (the Account page's notifications row) freezes the whole page there. Real iPhones have one (checked 10-16).
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: ENGINE === chromium, hasTouch: true, serviceWorkers: ENGINE === webkit ? "block" : "allow" });
const page = await ctx.newPage();

// --- a throwaway local account with watched + inventory cards (test data, local only) ---
const email = `wrap-${Date.now().toString(36)}@example.com`;
const su = await page.request.post(`${BASE}/api/auth/signup`, { data: { name: "Wrap Sweep", email, password: "hunter22hunter" } });
if (su.status() !== 201) throw new Error(`signup ${su.status()}`);
await page.request.post(`${BASE}/api/account/tour`);
const found = await (await page.request.get(`${BASE}/api/search-card?name=charizard&lang=en&typed=1&limit=60`)).json();
const cards = (found.cards ?? found.results ?? found).filter((c) => c.imageSmall && c.prices?.some((p) => p.market > 0)).slice(0, 6);
for (const [i, c] of cards.entries()) {
  const m = Math.max(...c.prices.map((p) => p.market || 0));
  await page.request.post(`${BASE}/api/wishlist`, { data: { card: c, language: "en", price: +(m * [1.05, 0.5, 1.6, 0.95, 2, 0.7][i]).toFixed(2) } });
  await page.request.post(`${BASE}/api/cards`, {
    data: { cardName: c.name, setName: c.setName, cardNumber: c.number, imageUrl: c.imageSmall, game: "pokemon", price: i < 2 ? 99999.99 : Math.max(1, m), condition: "Near Mint" },
  });
}

// --- the pages ---
const fixed = ["/", "/pricing", "/features", "/help", "/scan", "/cards", "/app", "/app/price-check", "/app/wishlist", "/app/collection",
  "/app/collection/insights", "/app/collection/report", "/app/collection/sets", "/app/account", "/app/rewards", "/app/packs", "/app/help"];
const urls = [...fixed];
await page.goto(`${BASE}/cards`, { waitUntil: "domcontentloaded" });
const games = [...new Set(await page.$$eval("a[href^='/cards/']", (as) => as.map((a) => a.getAttribute("href")).filter((h) => /^\/cards\/[a-z-]+$/.test(h))))];
for (const g of games) {
  urls.push(g, `${g}/movers`);
  await page.goto(`${BASE}${g}`, { waitUntil: "domcontentloaded" });
  const set = await page.$$eval("a[href]", (as, g) => as.map((a) => a.getAttribute("href")).find((h) => h.startsWith(g + "/") && h.split("/").length === 4 && !h.endsWith("/movers")), g);
  if (!set) continue;
  urls.push(set);
  await page.goto(`${BASE}${set}`, { waitUntil: "domcontentloaded" });
  const card = await page.$$eval("a[href]", (as, s) => as.map((a) => a.getAttribute("href")).find((h) => h.startsWith(s + "/") && h.split("/").length === 5 && !h.includes("/page/")), set);
  if (card) urls.push(card);
}

const detect = (stressed) => {
  const out = [];
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && s.opacity !== "0"; };
  const lineCount = (node) => { const rg = document.createRange(); rg.selectNodeContents(node); const rs = [...rg.getClientRects()].filter((r) => r.width > 0.5 && r.height > 2); const b = []; for (const r of rs) { const hit = b.find((x) => r.top < x.bottom - 1 && r.bottom > x.top + 1); if (hit) { hit.top = Math.min(hit.top, r.top); hit.bottom = Math.max(hit.bottom, r.bottom); } else b.push({ top: r.top, bottom: r.bottom }); } return b.length; };
  const desc = (e) => `${e.tagName.toLowerCase()}.${(e.getAttribute("class") || "").slice(0, 90)}`;
  const clean = (t) => (t || "").trim().replace(/\s+/g, " ");
  const inlineOnly = (e) => [...e.children].every((c) => /^inline/.test(getComputedStyle(c).display));
  const seen = new Set();
  // 1. a short text run (a label, a value, a pill word) broken over 2+ lines
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = clean(n.textContent);
    const e = n.parentElement;
    if (!t || t.length > 32 || !e || !visible(e) || ["SCRIPT", "STYLE", "TITLE"].includes(e.tagName)) continue;
    // the smallest inline-only wrapper around this run (e.g. <span>▼ <b>5.0</b>%</span>)
    let box = e;
    while (box.parentElement && /^inline/.test(getComputedStyle(box).display) && clean(box.parentElement.textContent).length <= 32 && inlineOnly(box.parentElement)) box = box.parentElement;
    if (clean(box.textContent).length > 32 || seen.has(box)) continue;
    seen.add(box);
    if (!inlineOnly(box)) { if (lineCount(n) > 1) out.push({ kind: "TEXT-SPLIT", text: t, el: desc(e) }); continue; }
    if (lineCount(box) > 1) out.push({ kind: "TEXT-SPLIT", text: clean(box.textContent), el: desc(box) });
  }
  // 2. clipped without an ellipsis
  for (const e of document.querySelectorAll("body *")) {
    const own = [...e.childNodes].some((x) => x.nodeType === 3 && x.textContent.trim());
    if (!own || !visible(e)) continue;
    const s = getComputedStyle(e);
    if (e.scrollWidth > e.clientWidth + 1 && s.overflowX !== "visible" && s.textOverflow !== "ellipsis" && clean(e.textContent).length <= 40) out.push({ kind: "CLIPPED", text: clean(e.textContent), el: desc(e) });
  }
  // 3. a "label ... value" row (justify-between) whose value dropped to a second row
  for (const p of document.querySelectorAll("[class*='justify-between']")) {
    const s = getComputedStyle(p);
    if (!visible(p) || !s.display.includes("flex") || s.flexDirection !== "row") continue;
    const kids = [...p.children].filter(visible);
    if (kids.length < 2 || clean(p.textContent).length > 80) continue;
    const tops = kids.map((k) => k.getBoundingClientRect().top);
    const hs = kids.map((k) => k.getBoundingClientRect().height);
    if (Math.max(...tops) - Math.min(...tops) > Math.min(...hs) * 0.8) out.push({ kind: "ROW-BREAK", text: clean(p.textContent).slice(0, 60), el: desc(p) });
  }
  // 4. the whole page scrolling sideways (something pushed past the screen edge)
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) out.push({ kind: "PAGE-SIDEWAYS", text: `${de.scrollWidth} > ${de.clientWidth}`, el: "html" });
  return out.map((o) => ({ ...o, stressed }));
};

const stress = () => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = w.nextNode())) nodes.push(n);
  for (const n of nodes) {
    const v = n.textContent;
    let r = v.replace(/[$£€]\s?\d[\d,]*(\.\d+)?/g, (m) => m[0] + "99,999.99").replace(/\d+(\.\d+)?%/g, "99.9%");
    // React splits "{pct}%" into "41.3" + "%": stretch a trailing number when the next text starts with %
    const next = n.nextSibling;
    if (next && next.nodeType === 3 && next.textContent.startsWith("%")) r = r.replace(/\d+(\.\d+)?\s*$/, "99.9");
    // and "$" + "{price}" the same way
    const prev = n.previousSibling;
    if (prev && prev.nodeType === 3 && /[$£€]\s*$/.test(prev.textContent)) r = r.replace(/^\s*\d[\d,]*(\.\d+)?/, "99,999.99");
    if (r !== v) n.textContent = r;
  }
};
const report = [];
for (const u of urls) {
  try {
    await page.goto(`${BASE}${u}`, { waitUntil: "networkidle", timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const close = page.getByRole("button", { name: "Close the tutorial" });
    if (await close.isVisible().catch(() => false)) await close.click();
    const before = await page.evaluate(detect, false);
    await page.evaluate(stress);
    await page.waitForTimeout(150);
    const after = (await page.evaluate(detect, true)).filter((a) => !before.some((b) => b.el === a.el && b.kind === a.kind));
    const all = [...before, ...after];
    const seen = new Set();
    const uniq = all.filter((x) => { const k = x.kind + x.el + x.text; if (seen.has(k)) return false; seen.add(k); return true; });
    report.push({ url: u, issues: uniq });
    const name = u.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home";
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
    console.log(`${u}: ${uniq.length} issue(s)`);
  } catch (err) {
    console.log(`${u}: ERROR ${err.message}`);
  }
}
fs.writeFileSync(path.join(SHOTS, "report.json"), JSON.stringify(report, null, 2));
await browser.close();
