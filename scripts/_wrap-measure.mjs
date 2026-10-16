// Size-tiered prices at $99,999.99 on iPhone WebKit (10-16): the text-swap sweep can't move a tile into its
// smaller-font tier, so these force the tier class the code would pick for $99,999.99 and measure.
import { webkit } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:3000";
const browser = await webkit.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const email = `wrapm-${Date.now().toString(36)}@example.com`;
await page.request.post(`${BASE}/api/auth/signup`, { data: { name: "Wrap Measure", email, password: "hunter22hunter" } });
await page.request.post(`${BASE}/api/account/tour`);
const found = await (await page.request.get(`${BASE}/api/search-card?name=charizard&lang=en&typed=1&limit=40`)).json();
for (const c of (found.cards ?? found).filter((c) => c.prices?.some((p) => p.market > 0)).slice(0, 3)) {
  const m = Math.max(...c.prices.map((p) => p.market || 0));
  await page.request.post(`${BASE}/api/wishlist`, { data: { card: c, language: "en", price: +(m * 0.5).toFixed(2) } });
}

const check = async (url, fn) => {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log(url, JSON.stringify(await page.evaluate(fn), null, 1));
};
const sameLine = `(a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return x.top<y.bottom-1&&y.top<x.bottom-1}`;

// homepage game tiles: label + price (>= $10k -> text-xs)
await check("/", new Function(`const same=${sameLine};return [...document.querySelectorAll('span.uppercase.text-brand-300')].map(l=>l.parentElement).filter(r=>r.children[1]).map(r=>{const [l,p]=r.children;p.textContent='$99,999.99';p.className=p.className.replace(/text-sm/,'text-[11px]');return l.textContent+': row='+r.clientWidth+' label='+l.scrollWidth+' price='+p.offsetWidth+' gap='+getComputedStyle(r).columnGap+' labelCut='+(l.scrollWidth>l.clientWidth)})`));
// search tab watchlist tiles (>= $10k -> 12px) with the worst pill
await check("/app/price-check", new Function(`const same=${sameLine};return [...document.querySelectorAll('button.shrink-0.rounded-2xl span.flex-wrap')].map(r=>{const [p,m]=r.children;p.className=p.className.replace(/text-\\[1[35]px\\]/,'text-[12px]');p.textContent='$99,999.99';if(m)m.textContent='▼ 99.9%';return 'oneLine='+(m?same(p,m):'no pill')+' fs='+getComputedStyle(p).fontSize})`));
// watchlist page tiles (>= $10k -> text-base) with the pill
await check("/app/wishlist", new Function(`const same=${sameLine};return [...document.querySelectorAll('p.font-display.leading-none')].map(p=>{const m=p.nextElementSibling;const T=[['$99.99','text-xl'],['$999.99','text-[17px]'],['$9,999.99','text-[14px]'],['$99,999.99','text-[13px]']];const res=[];for(const [v,t] of T){p.className=p.className.replace(/text-(xl|lg|base|\\[1[3-7]px\\])(?=\\s|$)/,t);p.textContent=v;if(m)m.textContent='▲ 999%';res.push(v+':'+(p.offsetWidth+(m?m.offsetWidth:0)+6)+'/'+p.parentElement.clientWidth+(p.parentElement.scrollWidth>p.parentElement.clientWidth?' OVER':' ok'))}return res.join(' ');const b=[...p.closest('div.rounded-2xl,li,article,div')?.querySelectorAll('button')||[]].find(x=>/Price alert|Alert at/.test(x.textContent));if(b)b.textContent='🔔 Alert at $99,999.99 · sent';return 'row='+p.parentElement.clientWidth+' price='+p.offsetWidth+' pill='+(m?m.offsetWidth:0)+' overflow='+(p.parentElement.scrollWidth>p.parentElement.clientWidth)+' fs='+getComputedStyle(p).fontSize+(b?' alertCut='+(b.scrollWidth>b.clientWidth):'')})`));
await browser.close();
