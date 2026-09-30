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
const { getAnalytics, deltaPct, parseRange, parseWindow, etOffsetMs } = await import(at("lib/server/analytics.ts"));
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
  check("a ping without `first` keeps no source", { ...(await db.prepare("SELECT src, camp FROM page_views").get()) }, { src: "", camp: "" });

  // Source + campaign (lib/attribution.ts): only a page load's first ping carries them. One row per visitor (distinct IP).
  let ipN = 0;
  const pingSrc = async (body) => {
    const ip = `9.9.9.${++ipN}`;
    await visit.POST(mk(body, { "x-forwarded-for": ip }));
    // Every case uses its own path, so the path finds the row it just wrote.
    return { ...(await db.prepare("SELECT src, camp FROM page_views WHERE path = ?").get(body.path)) };
  };
  check("first ping, tagged link: classified source + campaign", await pingSrc({ path: "/t1", first: true, utm_source: "Bluesky", utm_campaign: "Pokemon-Set-0930" }), { src: "bluesky", camp: "pokemon-set-0930" });
  check("first ping, search referrer", await pingSrc({ path: "/t2", first: true, ref: "https://www.google.com/" }), { src: "search", camp: "" });
  check("first ping, Facebook's link shim", await pingSrc({ path: "/t3", first: true, ref: "https://l.facebook.com/l.php?u=x" }), { src: "facebook", camp: "" });
  check("first ping, a tag beats the referrer", await pingSrc({ path: "/t4", first: true, utm_source: "x", utm_campaign: "mtg-movers-0930", ref: "https://t.co/abc" }), { src: "x", camp: "mtg-movers-0930" });
  check("first ping, nothing at all = direct", await pingSrc({ path: "/t5", first: true }), { src: "direct", camp: "" });
  check("first ping, some other site", await pingSrc({ path: "/t6", first: true, ref: "https://news.example.org/story" }), { src: "other:news.example.org", camp: "" });
  check("first ping, junk in the tag is sanitized", await pingSrc({ path: "/t7", first: true, utm_source: "<b>X</b>", utm_campaign: "A B!c" }), { src: "other:bxb", camp: "abc" });
  check("a later ping (no `first`) stays blank even with a tag in the body", await pingSrc({ path: "/t8", utm_source: "x", utm_campaign: "abc" }), { src: "", camp: "" });
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

console.log("where sign-ups come from (lib/attribution.ts, 09-30)");
{
  check("before anything is recorded: every account in the range is 'not recorded', none collected", [a.attribution.signups, a.attribution.visitors, a.attribution.landings, a.attribution.collected], [
    [{ source: "unknown", signups: 2, paying: 1, campaigns: [] }],
    [],
    [],
    false,
  ]);
  const u4 = await createUser("D", "d@x.io", "pw-long-enough");
  const u5 = await createUser("E", "e@x.io", "pw-long-enough");
  await db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(now - D, u4.id);
  await db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(now - D, u5.id);
  const sl = (user, at, src, campaign, landing) =>
    db.prepare("INSERT INTO signup_log (user_id, ip_hash, device_id, at, src, medium, campaign, landing, ref_host) VALUES (?, ?, ?, ?, ?, 'social', ?, ?, '')").run(user.id, `ip-${user.id}`, `dev-${user.id}`, at, src, campaign, landing);
  await sl(u1, now - 2 * D, "bluesky", "pokemon-set-0924", "/"); // paying (sub_status active)
  await sl(u2, now - 3 * D, "x", "pokemon-movers-0923", "/cards/pokemon");
  await sl(u4, now - D, "x", "pokemon-set-0925", "/");
  await sl(u3, now - 40 * D, "instagram", "old", "/pricing"); // outside the window
  // u5 has no signup_log row at all (an account made before the guard, or an admin-made one).
  const pvs = (visitor, src, camp, p) =>
    db.prepare("INSERT INTO page_views (day, visitor, path, at, ref, device, country, src, camp) VALUES (?, ?, ?, ?, '', 'phone', 'US', ?, ?)").run("2026-09-26", visitor, p, now - H, src, camp);
  await pvs("v1", "bluesky", "pokemon-set-0926", "/");
  await pvs("v2", "bluesky", "pokemon-set-0926", "/");
  await pvs("v2", "bluesky", "", "/pricing"); // same visitor again: still one
  await pvs("v3", "search", "", "/");
  await pvs("v4", "", "", "/scan"); // a later client-side page: no source, not counted
  const b = await getAnalytics("7d", now);
  check("sign-ups by source, biggest first, each with its campaigns and how many pay now", b.attribution.signups, [
    { source: "x", signups: 2, paying: 0, campaigns: [{ campaign: "pokemon-movers-0923", signups: 1, paying: 0 }, { campaign: "pokemon-set-0925", signups: 1, paying: 0 }] },
    { source: "bluesky", signups: 1, paying: 1, campaigns: [{ campaign: "pokemon-set-0924", signups: 1, paying: 1 }] },
    { source: "unknown", signups: 1, paying: 0, campaigns: [] },
  ]);
  check("the source table adds up to the sign-ups metric", [b.attribution.signups.reduce((s, r) => s + r.signups, 0), b.metrics.signups.total], [4, 4]);
  check("a signup outside the range is not counted", b.attribution.signups.some((r) => r.source === "instagram"), false);
  check("visitors by source (distinct visitors, blank sources ignored)", b.attribution.visitors, [{ source: "bluesky", visitors: 2 }, { source: "search", visitors: 1 }]);
  check("first page of sign-ups", b.attribution.landings, [{ path: "/", signups: 2 }, { path: "/cards/pokemon", signups: 1 }]);
  check("collected once any signup carries a source", b.attribution.collected, true);
  const wide = await getAnalytics("90d", now);
  check("a wider range picks the older signup up", wide.attribution.signups.find((r) => r.source === "instagram"), { source: "instagram", signups: 1, paying: 1, campaigns: [{ campaign: "old", signups: 1, paying: 1 }] });

  // A database from before the columns existed shows zeros, never an error, and every other number still works.
  await db.prepare("ALTER TABLE signup_log DROP COLUMN src").run();
  await db.prepare("ALTER TABLE page_views DROP COLUMN src").run();
  const bare = await getAnalytics("7d", now);
  check("no columns: attribution reads as empty", [bare.attribution.signups, bare.attribution.visitors, bare.attribution.collected], [[], [], false]);
  check("no columns: the rest of analytics is unharmed", [bare.metrics.signups.total, bare.metrics.pageViews.total > 0], [4, true]);
  await db.prepare("ALTER TABLE signup_log ADD COLUMN src TEXT").run();
  await db.prepare("ALTER TABLE page_views ADD COLUMN src TEXT").run();
}

console.log("helpers");
check("deltaPct", [deltaPct(150, 100), deltaPct(50, 100), deltaPct(5, 0), deltaPct(0, 0)], [50, -50, null, 0]);
check("parseRange", [parseRange("30d"), parseRange("junk"), parseRange(undefined)], ["30d", "7d", "7d"]);
{
  const w = parseWindow({ from: "2026-09-01", to: "2026-09-15" }, now);
  check("parseWindow custom", [w.id, w.from, w.to, w.days], ["custom", "2026-09-01", "2026-09-15", 15]);
  check("parseWindow custom spans 15 Eastern days", Math.round((w.end - w.since) / 86_400_000), 15);
  const clipped = parseWindow({ from: "2026-09-01", to: "2099-01-01" }, now);
  check("parseWindow refuses a window over a year", clipped, "7d");
  check("parseWindow to before from -> preset", parseWindow({ from: "2026-09-15", to: "2026-09-01", range: "30d" }, now), "30d");
  check("parseWindow junk dates -> preset", parseWindow({ from: "sep 1", to: "2026-09-15" }, now), "7d");
  const custom = await getAnalytics(w, now);
  check("custom window reports range custom", [custom.range, custom.since, custom.now], ["custom", w.since, w.end - 1]);
  const keys = custom.metrics.pageViews.series.keys;
  check("custom window buckets run from `from` to `to`", [keys[0], keys[keys.length - 1], keys.length], ["2026-09-01", "2026-09-15", 15]);
  check("lifetime money is present", typeof custom.lifetime.soldUsd, "number");
}

if (failures) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall analytics checks passed");
