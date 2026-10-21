// 10-21: phone/desktop shots for 387e78ef (/admin/prices: today's price, the eBay read under it, "no longer binds") and
// aff692cc (Enlightened Confidant pfra 5p headline, live vs local). LOCAL dev only: the console cookie is minted with the
// dev secret from .env.local and only sent to localhost.
// node --env-file=.env.local --experimental-strip-types --no-warnings scripts/_b8-shots.mjs <out-dir> [local-base]
import { chromium } from "@playwright/test";
const { signAdminToken, ADMIN_COOKIE } = await import("../src/lib/adminAuth.ts");
const [out = "docs/shots", base = "http://localhost:3000"] = process.argv.slice(2);
const b = await chromium.launch();
const phone = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const decline = (p) => p.getByRole("button", { name: /decline|reject|only necessary|essential/i }).first().click({ timeout: 2000 }).catch(() => {});

// 1-2: /admin/prices "Your calls", phone + desktop.
const { token } = signAdminToken();
for (const [tag, opts] of [["phone", phone], ["desktop", { viewport: { width: 1280, height: 900 } }]]) {
  const ctx = await b.newContext(opts);
  await ctx.addCookies([{ name: ADMIN_COOKIE, value: token, url: base }]);
  const p = await ctx.newPage();
  await p.goto(`${base}/admin/prices`, { waitUntil: "networkidle", timeout: 180000 });
  const h = p.getByRole("heading", { name: /Your calls/ });
  if ((await h.count()) === 0) { console.log(tag, "NO 'Your calls' heading, url", p.url()); await p.screenshot({ path: `${out}/b8-admin-calls-${tag}-FAILED.png` }); await ctx.close(); continue; }
  await h.scrollIntoViewIfNeeded();
  await p.evaluate(() => window.scrollBy(0, -12));
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${out}/b8-admin-calls-${tag}.${tag === "phone" ? "jpg" : "png"}`, ...(tag === "phone" ? { type: "jpeg", quality: 85 } : {}) });
  console.log(tag, "admin calls shot", (await p.getByText(/no longer binds/).count()), "lapsed notes,", (await p.getByText(/eBay read/).count()), "read notes");
  await ctx.close();
}

// 3-4: Enlightened Confidant headline, live then local.
const path = "/cards/magic/reality-fracture-promos/enlightened-confidant--pfra-5p";
for (const [tag, host] of [["before-live", "https://cardflip.io"], ["after-local", base]]) {
  const ctx = await b.newContext(phone);
  const p = await ctx.newPage();
  await p.goto(`${host}${path}?heat=off`, { waitUntil: "networkidle", timeout: 180000 });
  await decline(p);
  // The dev server's "Issues" badge (Google sign-in's FedCM note in headless Chromium) would cover the price bar.
  await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  await p.waitForTimeout(800);
  await p.screenshot({ path: `${out}/confidant-tie-${tag}-phone.jpg`, type: "jpeg", quality: 85 });
  const title = await p.title();
  console.log(tag, title);
  await ctx.close();
}
await b.close();
