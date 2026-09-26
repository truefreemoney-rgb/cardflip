/**
 * /admin/analytics data + the visitor ping's new columns.
 * Run: npm run test:analytics
 *
 * Pins: referrerHost keeps only an outside host (own site, junk, paths â†’
 * ""); deviceClass reads phone/tablet/desktop; /api/visit stores ref,
 * device and country on the row; getAnalytics buckets a 7d window by day
 * and a 24h window by hour, compares against the prior period, computes
 * the funnel, top pages/referrers/devices/countries, scans by game, MRR
 * from users.plan/sub_status, and social last-post days from settings.
 * Throwaway db as in test-admin-routes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-analytics-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { referrerHost, deviceClass } = await import(at("lib/visit.ts"));
const visit = await import(at("app/api/visit/route.ts"));
const { getAnalytics, deltaPct, parseRange, etOffsetMs } = await import(at("lib/server/analytics.ts"));
const { db } = await import(at("lib/db.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { setSetting } = await import(at("lib/server/settings.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

console.log("referrerHost / deviceClass");
check("outside host kept, www dropped", referrerHost("https://www.Reddit.com/r/pokemon?x=1"), "reddit.com");
check("own site dropped", referrerHost("https://cardflip.io/pricing"), "");
check("subdomain of own site dropped", referrerHost("https://app.cardflip.io/"), "");
check("junk dropped", [referrerHost("not a url"), referrerHost(""), referrerHost(42)], ["", "", ""]);
check("iphone = phone", deviceClass("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari"), "phone");
check("android phone", deviceClass("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari"), "phone");
check("android tablet", deviceClass("Mozilla/5.0 (Linux; Android 14; SM-X910) Safari"), "tablet");
check("ipad = tablet", deviceClass("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"), "tablet");
check("windows = desktop", deviceClass("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome"), "desktop");

console.log("/api/visit");
{
  const { NextRequest } = await import("next/server");
  const mk = (body, headers = {}) =>
    new NextRequest("http://test/api/visit", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (iPhone) Safari", "x-forwarded-for": "1.2.3.4", ...headers },
    });
  const r = await visit.POST(mk({ path: "/pricing", ref: "https://t.co/abc" }, { "x-vercel-ip-country": "us" }));
  check("204", r.status, 204);
  const row = await db.prepare("SELECT path, ref, device, country FROM page_views").get();
  check("row carries ref/device/country", row, { path: "/pricing", ref: "t.co", device: "phone", country: "US" });
  await visit.POST(mk({ path: "/admin/analytics" }));
  check("admin path not counted", (await db.prepare("SELECT COUNT(*) AS n FROM page_views").get()).n, 1);
}
console.log("getAnalytics");
const now = Date.UTC(2026, 8, 26, 15, 0, 0); // 2026-09-26T15:00Z
const H = 3_600_000, D = 24 * H;
await db.prepare("DELETE FROM page_views").run();
const pv = (dayOff, visitor, p, extra = {}) =>
  db.prepare("INSERT OR IGNORE INTO page_views (day, visitor, path, at, ref, device, country) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(new Date(now - dayOff * D).toISOString().slice(0, 10), visitor, p, now - dayOff * D - H, extra.ref ?? "", extra.device ?? "desktop", extra.country ?? "US");
await pv(0, "a", "/", { device: "phone", ref: "reddit.com" });
await pv(0, "a", "/pricing", { device: "phone" });
await pv(1, "b", "/", { country: "CA" });
await pv(2, "c", "/scan");
await pv(10, "old1", "/"); // prior 7d window
await pv(11, "old2", "/");
await pv(12, "old3", "/");

const u1 = await createUser("A", "a@x.io", "pw-long-enough");
const u2 = await createUser("B", "b@x.io", "pw-long-enough");
const u3 = await createUser("C", "c@x.io", "pw-long-enough");
await db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(now - 2 * D, u1.id);
await db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(now - 3 * D, u2.id);
await db.prepare("UPDATE users SET created_at = ?, sub_status = 'active', plan = 'pro' WHERE id = ?").run(now - 40 * D, u3.id);
await db.prepare("UPDATE users SET sub_status = 'active' WHERE id = ?").run(u1.id);
const card = (id, uid, status, off, extra = {}) =>
  db.prepare(
    "INSERT INTO cards (id, user_id, card_name, set_name, card_number, image_url, condition, status, price, listed_at, sold_price, sold_at, created_at, updated_at, game) VALUES (?, ?, 'x', 's', '1', '', 'NM', ?, 10, ?, ?, ?, ?, ?, ?)",
  ).run(id, uid, status, extra.listed_at ?? null, extra.sold_price ?? null, extra.sold_at ?? null, now - off * D, now - off * D, extra.game ?? "pokemon");
await card("c1", u1.id, "sold", 2, { listed_at: now - D, sold_price: 25, sold_at: now - H, game: "pokemon" });
await card("c2", u1.id, "ready", 1, { game: "mtg" });
await card("c3", u2.id, "ready", 1);
await card("c4", u3.id, "ready", 20);
await db.prepare("INSERT INTO scan_usage (id, user_id, at, model, input_tokens, output_tokens, cost_micros) VALUES ('s1', ?, ?, 'm', 1, 1, 6000)").run(u1.id, now - H);
await db.prepare("INSERT INTO scan_usage (id, user_id, at, model, input_tokens, output_tokens, cost_micros) VALUES ('s2', ?, ?, 'm', 1, 1, 4000)").run(u1.id, now - 2 * H);
await setSetting("social_last_post:bluesky", "2026-09-26");
await setSetting("social_last_post:bluesky:uris", JSON.stringify(["u1", "u2"]));
await setSetting("social_last_post:x", "2026-09-20");

const a = await getAnalytics("7d", now);
check("7 daily buckets + today", a.metrics.pageViews.series.keys.length, 8);
check("not hourly", a.metrics.pageViews.series.hourly, false);
check("page views this week", a.metrics.pageViews.total, 4);
check("visitors this week", a.metrics.visitors.total, 3);
check("prior week visitors", a.metrics.visitors.prior, 3);
check("today's bucket has 2 views", a.metrics.pageViews.series.values.at(-1), 2);
check("sign-ups in window", a.metrics.signups.total, 2);
check("scans in window", a.metrics.scans.total, 3);
check("sold + sales", [a.metrics.sold.total, a.metrics.soldUsd.total], [1, 25]);
check("vision calls + cost usd", [a.metrics.visionCalls.total, a.metrics.visionCostUsd.total], [2, 0.01]);
check("top pages", a.pages.map((p) => [p.path, p.views, p.visitors]), [["/", 2, 2], ["/pricing", 1, 1], ["/scan", 1, 1]]);
check("referrers", a.referrers, [{ host: "reddit.com", visitors: 1 }]);
check("devices", a.devices, [{ device: "desktop", visitors: 2 }, { device: "phone", visitors: 1 }]);
check("countries", a.countries, [{ country: "US", visitors: 2 }, { country: "CA", visitors: 1 }]);
check("details collected", a.detailsCollected, true);
check("scans by game", a.scansByGame, [{ game: "pokemon", scans: 2 }, { game: "mtg", scans: 1 }]);
check("cohort funnel", a.funnel.cohort, { signedUp: 2, scanned: 2, listed: 1, sold: 1, paying: 1 });
check("all-time funnel", a.funnel.allTime, { signedUp: 3, scanned: 3, listed: 1, sold: 1, paying: 2 });
const { PRICING } = await import(at("lib/pricing.ts"));
check("mrr", [a.subscriptions.activeStandard, a.subscriptions.activePro, a.subscriptions.mrrUsd.toFixed(2)], [1, 1, (PRICING.standard.price + PRICING.pro.price).toFixed(2)]);
check("social", a.social, [
  { site: "bluesky", lastDay: "2026-09-26", postsThatDay: 2 },
  { site: "x", lastDay: "2026-09-20", postsThatDay: 0 },
]);

const h = await getAnalytics("24h", now);
check("25 hourly buckets", [h.metrics.pageViews.series.keys.length, h.metrics.pageViews.series.hourly], [25, true]);
check("hour keys are Eastern (15:00Z = 11am EDT)", h.metrics.pageViews.series.keys[0], "2026-09-25T11");
check("last hour key is now in Eastern", h.metrics.pageViews.series.keys.at(-1), "2026-09-26T11");
check("14:00Z page view lands in the 10am ET bucket", h.metrics.pageViews.series.values[h.metrics.pageViews.series.keys.indexOf("2026-09-26T10")], 2);
check("etOffsetMs: EDT -4h, EST -5h", [etOffsetMs(now), etOffsetMs(Date.UTC(2026, 0, 15))], [-4 * H, -5 * H]);
check("daily keys are Eastern days", a.metrics.pageViews.series.keys.at(-1), "2026-09-26");
check("24h page views", h.metrics.pageViews.total, 2);
check("24h prior page views", h.metrics.pageViews.prior, 1);

console.log("helpers");
check("deltaPct", [deltaPct(150, 100), deltaPct(50, 100), deltaPct(5, 0), deltaPct(0, 0)], [50, -50, null, 0]);
check("parseRange", [parseRange("30d"), parseRange("junk"), parseRange(undefined)], ["30d", "7d", "7d"]);

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall analytics checks passed");
