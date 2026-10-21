// 10-21: phone shots of the public card search for Team Aqua's Kyogre, live vs local (d120e6d7: the app quotes the card
// page's TCGplayer line, $290, not pokemontcg.io's $542.60 that the guard flags as "looks off").
// node scripts/_kyogre-search-shots.mjs <out-dir> [local-base]
import { chromium } from "@playwright/test";
const [out = "docs/shots", base = "http://localhost:3000"] = process.argv.slice(2);
const b = await chromium.launch();
for (const [tag, host] of [["before-live", "https://cardflip.io"], ["after-local", base]]) {
  const ctx = await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(`${host}/cards/pokemon?heat=off`, { waitUntil: "networkidle", timeout: 180000 });
  await p.getByRole("button", { name: /decline|reject|only necessary|essential/i }).first().click({ timeout: 2000 }).catch(() => {});
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  const box = p.getByPlaceholder("Search a card name").last();
  await box.scrollIntoViewIfNeeded();
  const answer = p.waitForResponse((r) => r.url().includes("/api/search-card"), { timeout: 60000 }).catch(() => null);
  await box.fill("Team Aqua's Kyogre");
  const res = await answer;
  const body = res ? await res.json().catch(() => null) : null;
  const ky = body?.cards?.find((c) => c.id === "ex4-3");
  const holo = ky?.prices?.find((x) => x.variant === "holofoil" && x.source === "tcgplayer");
  await p.waitForTimeout(1500);
  const tile = p.getByText(/Team Aqua.s Kyogre/).first();
  await tile.scrollIntoViewIfNeeded().catch(() => {});
  await p.evaluate(() => window.scrollBy(0, -160));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/kyogre-search-${tag}-phone.jpg`, type: "jpeg", quality: 85 });
  console.log(tag, "ex4-3 holofoil", holo?.market, holo?.untrusted ? `FLAGGED ${holo.untrusted.reason}` : "shown");
  await ctx.close();
}
await b.close();
