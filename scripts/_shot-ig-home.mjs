// 10-31: the homepage as an Instagram ad visitor sees it (iPhone + Android in-app UA). Local dev only.
// Reports Google requests (One Tap must not load in an app browser), page errors, and the first screen.
import { webkit, chromium, devices } from "@playwright/test";
const IG_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 352.0.0.38.100 (iPhone15,3; iOS 18_0; en_US; en; scale=3.00; 1290x2796; 650120155)";
const IG_AND = "Mozilla/5.0 (Linux; Android 14; SM-S918U Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36 Instagram 352.0.0.38.100 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918U; dm3q; qcom; en_US; 650120155)";
const base = process.argv[2] ?? "http://localhost:3000";
for (const [name, engine, dev, ua] of [["ig-iphone", webkit, devices["iPhone 13"], IG_IOS], ["ig-android", chromium, devices["Pixel 7"], IG_AND]]) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ ...dev, userAgent: ua, serviceWorkers: "block" });
  const page = await ctx.newPage();
  const google = [];
  const errors = [];
  page.on("request", (r) => /accounts\.google|gsi|google\/onetap/.test(r.url()) && google.push(r.url().slice(0, 80)));
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 150)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 150)));
  const t0 = Date.now();
  await page.goto(`${base}/?utm_source=instagram&utm_campaign=ig-traffic&heat=off`, { waitUntil: "load" });
  const loadMs = Date.now() - t0;
  await page.waitForTimeout(3000);
  const fold = await page.evaluate(() => {
    const h = window.innerHeight;
    const vis = [...document.querySelectorAll("a,button")].filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= h && r.width > 0; }).map((e) => e.textContent.trim().slice(0, 30)).filter(Boolean);
    const overlays = [...document.querySelectorAll("body *")].filter((e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return (s.position === "fixed" || s.position === "sticky") && r.height > h * 0.2 && s.display !== "none" && s.visibility !== "hidden"; }).map((e) => `${e.tagName}.${String(e.className).slice(0, 40)} ${Math.round(e.getBoundingClientRect().height)}px`);
    return { h, docH: document.documentElement.scrollHeight, sideways: document.documentElement.scrollWidth > window.innerWidth, vis, overlays };
  });
  console.log(name, { loadMs, google, errors, ...fold });
  await page.screenshot({ path: `C:/Users/Chris/AppData/Local/Temp/claude/C--Users-Chris-My-project--1-/b2da0244-6da2-4445-a8ef-13488074c6de/scratchpad/home-${name}.jpg`, type: "jpeg", quality: 75 });
  await browser.close();
}
