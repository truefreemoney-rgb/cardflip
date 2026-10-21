// 10-21 (72c4fad2): phone shots of the Dark Charizard 1st Edition page, live (blank headline) vs local (the binding
// $700 eBay sold check vouches for its own price). Page GETs only, no search, so the live half writes nothing.
// node scripts/_dark-charizard-shots.mjs <out-dir> [local-base]
import { chromium } from "@playwright/test";
const [out = "docs/shots", base = "http://localhost:3000"] = process.argv.slice(2);
const path = "/cards/pokemon/team-rocket-1st-edition/dark-charizard--base5-4-1st?heat=off";
const b = await chromium.launch();
for (const [tag, host] of [["before-live", "https://cardflip.io"], ["after-local", base]]) {
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${host}${path}`, { waitUntil: "networkidle", timeout: 180000 });
  await p.getByRole("button", { name: /decline|reject|only necessary|essential/i }).first().click({ timeout: 2000 }).catch(() => {});
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await p.getByRole("heading", { level: 1 }).first().scrollIntoViewIfNeeded().catch(() => {});
  await p.evaluate(() => window.scrollBy(0, -80));
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/dark-charizard-1st-${tag}-phone.jpg`, type: "jpeg", quality: 85 });
  const text = await p.evaluate(() => document.body.innerText);
  console.log(tag, (text.match(/\$[0-9,]+\.\d{2}/g) ?? []).slice(0, 5).join(" "), "|", (text.match(/Checked against[^\n]{0,60}|hasn't updated[^\n]{0,40}|No (recent )?price[^\n]{0,40}/) ?? [""])[0]);
  await ctx.close();
}
await b.close();
