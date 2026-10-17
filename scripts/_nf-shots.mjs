// Phone-width shots of made-up card/set links (A-H #21). node scripts/_nf-shots.mjs <outdir> <tag> [base]
import { chromium } from "@playwright/test";
const [out, tag, base = "http://localhost:3000"] = process.argv.slice(2);
const urls = [["card", "/cards/pokemon/base-set/not-a-card--zzz9-999"], ["set", "/cards/pokemon/no-such-set"], ["game", "/cards/notagame"]];
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
for (const [name, u] of urls) {
  const r = await p.goto(base + u, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/notfound-${tag}-${name}.png` });
  console.log(name, r.status(), (await p.title()), "|", (await p.locator("main").innerText().catch(() => "")).slice(0, 120).replace(/\s+/g, " "));
}
await b.close();
