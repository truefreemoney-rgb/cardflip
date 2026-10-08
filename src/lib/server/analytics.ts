import "server-only";
import { db } from "@/lib/db";
import { PRICING } from "@/lib/pricing";
import { TIKTOK_POSTED_PREFIX, tiktokHandPosted } from "@/lib/socialTiktok";

/** Same key the publisher writes (lib/server/socialPublish.ts) — not imported so this stays a light module. */
const LAST_POST_PREFIX = "social_last_post:";

/**
 * Everything /admin/analytics shows, read in one pass (09-26, Chris: "make
 * an analytics tab ... easier for me if I'm traveling, to just look at my
 * phone"). One range (24h / 7d / 30d / 90d), every number against the
 * period before it, plus the breakdowns the overview never had: funnel,
 * pages, referrers, devices, countries, scans by game, subscriptions,
 * social. Read-only; every query is wrapped so one missing table or column
 * (a database from before the page_views probes ran) shows a zero, not a
 * blank page.
 */

export type Range = "24h" | "7d" | "30d" | "90d";
export const RANGES: { id: Range; label: string; hours: number }[] = [
  { id: "24h", label: "24h", hours: 24 },
  { id: "7d", label: "7 days", hours: 7 * 24 },
  { id: "30d", label: "30 days", hours: 30 * 24 },
  { id: "90d", label: "90 days", hours: 90 * 24 },
];
export function parseRange(v: unknown): Range {
  return RANGES.some((r) => r.id === v) ? (v as Range) : "7d";
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** A custom window picked with two dates (Eastern calendar days, both ends inclusive). */
export interface CustomWindow {
  id: "custom";
  from: string;
  to: string;
  since: number;
  end: number;
  days: number;
}
export type Window = Range | CustomWindow;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Eastern midnight that starts the given calendar day. */
function etDayStart(day: string, now: number): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d) - etOffsetMs(now);
}

/**
 * ?from=YYYY-MM-DD&to=YYYY-MM-DD wins when both are real days and in order;
 * otherwise the preset (?range=), defaulting to 7d. `to` in the future is
 * clipped to now; a window longer than a year is refused (falls back).
 */
export function parseWindow(params: { range?: unknown; from?: unknown; to?: unknown }, now = Date.now()): Window {
  const { from, to } = params;
  if (typeof from === "string" && typeof to === "string" && DAY_RE.test(from) && DAY_RE.test(to) && from <= to) {
    const since = etDayStart(from, now);
    const end = Math.min(etDayStart(to, now) + DAY_MS, now);
    const days = Math.round((etDayStart(to, now) + DAY_MS - since) / DAY_MS);
    if (Number.isFinite(since) && end > since && days <= 366) return { id: "custom", from, to, since, end, days };
  }
  return parseRange(params.range);
}

export interface Series {
  /** Bucket keys, oldest first: "YYYY-MM-DD" or (hourly) "YYYY-MM-DDTHH", Eastern time (Chris 09-26: "this should be on EST time"). */
  keys: string[];
  values: number[];
  hourly: boolean;
}

export interface Metric {
  total: number;
  /** Same measure over the period immediately before. */
  prior: number;
  series: Series;
}

export interface Analytics {
  /** End of the window: the real now for presets, the end of the `to` day for a custom window. */
  now: number;
  range: Range | "custom";
  since: number;
  /** Money lives on its own (Chris 09-27): these ignore the range. */
  lifetime: { soldUsd: number; sold: number; listed: number };
  metrics: {
    visitors: Metric;
    pageViews: Metric;
    signups: Metric;
    scans: Metric;
    visionCalls: Metric;
    visionCostUsd: Metric;
    priceChecks: Metric;
    listed: Metric;
    sold: Metric;
    soldUsd: Metric;
    /** Subscription payments that cleared (scan_credits kind payment: first month and renewals). */
    subPayments: Metric;
    /** Those payments in dollars at the plan's USD price (pricing.ts); a local-currency payment counts at its USD price. */
    subIncomeUsd: Metric;
    wishlist: Metric;
    helpMessages: Metric;
    errors: Metric;
  };
  funnel: {
    /** Accounts created inside the range. */
    cohort: FunnelSteps;
    /** Accounts that existed by the range's end; scanned/listed/sold count activity inside the range. */
    everyone: FunnelSteps;
  };
  pages: { path: string; views: number; visitors: number }[];
  referrers: { host: string; visitors: number }[];
  devices: { device: string; visitors: number }[];
  countries: { country: string; visitors: number }[];
  /** True once at least one row carries the 09-26 columns. */
  detailsCollected: boolean;
  scansByGame: { game: string; scans: number }[];
  priceChecksByGame: { game: string; checks: number }[];
  subscriptions: {
    rows: { plan: string; status: string; users: number }[];
    activeStandard: number;
    activePro: number;
    pastDue: number;
    canceled: number;
    mrrUsd: number;
    ebayConnected: number;
    totalUsers: number;
  };
  social: { site: string; lastDay: string | null; postsThatDay: number }[];
  attribution: Attribution;
}

/**
 * Where people come from (09-30, lib/attribution.ts): accounts created in the
 * range by the source the browser kept at signup, then by campaign (one post),
 * with how many of them pay now; visitors by the source of their page load; and
 * the first page signups landed on. `source` is a stored source (bluesky, x,
 * search, direct, other:<host>) or "unknown" for accounts with nothing recorded
 * (made before this shipped, or a browser with storage blocked).
 */
export interface Attribution {
  signups: { source: string; signups: number; paying: number; campaigns: { campaign: string; signups: number; paying: number }[] }[];
  visitors: { source: string; visitors: number }[];
  landings: { path: string; signups: number }[];
  /** True once any signup carries a source. */
  collected: boolean;
}

export interface FunnelSteps {
  signedUp: number;
  scanned: number;
  listed: number;
  sold: number;
  paying: number;
}

const PLAN_USD: Record<string, number> = { standard: PRICING.standard.price, pro: PRICING.pro.price };

async function rows<T>(sql: string, ...args: (string | number)[]): Promise<T[]> {
  try {
    return (await db.prepare(sql).all(...args)) as unknown as T[];
  } catch {
    return [];
  }
}
async function scalar(sql: string, ...args: (string | number)[]): Promise<number> {
  try {
    const row = (await db.prepare(sql).get(...args)) as { n: number | null } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Eastern offset (ms) at `ts`: -4h in summer, -5h in winter. One offset
 * per request (taken at `now`) shifts every timestamp before bucketing, so
 * SQLite's strftime/date, which only know UTC, land on Eastern hours/days.
 */
export function etOffsetMs(ts: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ts));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  return asUtc - Math.floor(ts / 1000) * 1000;
}

function keyOf(ts: number, hourly: boolean, offset: number): string {
  const iso = new Date(ts + offset).toISOString();
  return hourly ? iso.slice(0, 13) : iso.slice(0, 10);
}

/** Fill every bucket of the window from sparse {k, n} rows. */
function fill(sparse: { k: string; n: number }[], since: number, now: number, hourly: boolean, offset: number): Series {
  const map = new Map(sparse.map((r) => [r.k, Number(r.n ?? 0)]));
  const step = hourly ? HOUR_MS : DAY_MS;
  const keys: string[] = [];
  const values: number[] = [];
  // Walk from the window's start bucket to now's bucket, inclusive (Eastern-shifted clock).
  const s = since + offset;
  const start = (hourly ? Math.floor(s / HOUR_MS) * HOUR_MS : Date.UTC(
    new Date(s).getUTCFullYear(), new Date(s).getUTCMonth(), new Date(s).getUTCDate())) - offset;
  for (let t = start; t <= now; t += step) {
    const k = keyOf(t, hourly, offset);
    keys.push(k);
    values.push(map.get(k) ?? 0);
  }
  return { keys, values, hourly };
}

interface Spec {
  table: string;
  ts: string;
  /** SQL aggregate over the rows in a bucket. */
  agg: string;
  where?: string;
}

async function metric(spec: Spec, since: number, now: number, hourly: boolean): Promise<Metric> {
  const offset = etOffsetMs(now);
  const shifted = `(${spec.ts} + ${offset}) / 1000`;
  const bucket = hourly
    ? `strftime('%Y-%m-%dT%H', ${shifted}, 'unixepoch')`
    : `date(${shifted}, 'unixepoch')`;
  const where = spec.where ? `AND ${spec.where}` : "";
  const len = now - since;
  const [sparse, total, prior] = await Promise.all([
    rows<{ k: string; n: number }>(
      `SELECT ${bucket} AS k, ${spec.agg} AS n FROM ${spec.table} WHERE ${spec.ts} >= ? AND ${spec.ts} < ? ${where} GROUP BY k`,
      since, now + 1,
    ),
    scalar(`SELECT ${spec.agg} AS n FROM ${spec.table} WHERE ${spec.ts} >= ? AND ${spec.ts} < ? ${where}`, since, now + 1),
    scalar(`SELECT ${spec.agg} AS n FROM ${spec.table} WHERE ${spec.ts} >= ? AND ${spec.ts} < ? ${where}`, since - len, since),
  ]);
  return { total, prior, series: fill(sparse, since, now, hourly, offset) };
}

/** Sign-ups and visitors by source, campaign and landing page for [since, end). Every query is wrapped: a database without the columns reads as zeros. */
async function attribution(since: number, end: number): Promise<Attribution> {
  const [signupRows, visitorRows, landingRows, anyRow] = await Promise.all([
    rows<{ src: string; campaign: string; signups: number; paying: number }>(
      `SELECT COALESCE(NULLIF(s.src, ''), 'unknown') AS src, COALESCE(s.campaign, '') AS campaign,
              COUNT(*) AS signups, SUM(CASE WHEN u.sub_status IN ('active','trialing') THEN 1 ELSE 0 END) AS paying
         FROM users u LEFT JOIN signup_log s ON s.user_id = u.id
        WHERE u.created_at >= ? AND u.created_at < ?
        GROUP BY 1, 2`,
      since, end,
    ),
    rows<{ src: string; visitors: number }>(
      "SELECT src, COUNT(DISTINCT visitor) AS visitors FROM page_views WHERE at >= ? AND at < ? AND src IS NOT NULL AND src <> '' GROUP BY src ORDER BY visitors DESC, src LIMIT 12",
      since, end,
    ),
    rows<{ path: string; signups: number }>(
      "SELECT landing AS path, COUNT(*) AS signups FROM signup_log WHERE at >= ? AND at < ? AND landing IS NOT NULL AND landing <> '' GROUP BY landing ORDER BY signups DESC, landing LIMIT 10",
      since, end,
    ),
    rows<{ n: number }>("SELECT 1 AS n FROM signup_log WHERE src IS NOT NULL AND src <> '' LIMIT 1"),
  ]);
  const bySource = new Map<string, { source: string; signups: number; paying: number; campaigns: { campaign: string; signups: number; paying: number }[] }>();
  for (const r of signupRows) {
    const entry = bySource.get(r.src) ?? { source: r.src, signups: 0, paying: 0, campaigns: [] };
    const signups = Number(r.signups);
    const paying = Number(r.paying ?? 0);
    entry.signups += signups;
    entry.paying += paying;
    if (r.campaign) entry.campaigns.push({ campaign: r.campaign, signups, paying });
    bySource.set(r.src, entry);
  }
  const list = [...bySource.values()];
  for (const e of list) e.campaigns.sort((a, b) => b.signups - a.signups || a.campaign.localeCompare(b.campaign));
  list.sort((a, b) => b.signups - a.signups || a.source.localeCompare(b.source));
  return {
    signups: list,
    visitors: visitorRows.map((r) => ({ source: r.src, visitors: Number(r.visitors) })),
    landings: landingRows.map((r) => ({ path: r.path, signups: Number(r.signups) })),
    collected: anyRow.length > 0,
  };
}

/** Accounts created in [since, end) and what they have done since (cohort). */
async function funnel(since: number, end: number): Promise<FunnelSteps> {
  const q = (extra: string) =>
    scalar(`SELECT COUNT(*) AS n FROM users u WHERE u.created_at >= ? AND u.created_at < ? ${extra}`, since, end);
  const [signedUp, scanned, listed, sold, paying] = await Promise.all([
    q(""),
    q("AND EXISTS (SELECT 1 FROM cards c WHERE c.user_id = u.id)"),
    q("AND EXISTS (SELECT 1 FROM cards c WHERE c.user_id = u.id AND (c.listed_at IS NOT NULL OR c.status IN ('listed','sold')))"),
    q("AND EXISTS (SELECT 1 FROM cards c WHERE c.user_id = u.id AND c.status = 'sold')"),
    q("AND u.sub_status IN ('active','trialing')"),
  ]);
  return { signedUp, scanned, listed, sold, paying };
}

/**
 * Every account that existed by the end of [since, end), and how many of them scanned,
 * listed or sold INSIDE the range (Chris 10-07: the second funnel follows the date picker
 * instead of all time). Paying is the subscription status now (no history is kept).
 */
async function activeFunnel(since: number, end: number): Promise<FunnelSteps> {
  const q = (extra: string, ...args: number[]) =>
    scalar(`SELECT COUNT(*) AS n FROM users u WHERE u.created_at < ? ${extra}`, end, ...args);
  const [signedUp, scanned, listed, sold, paying] = await Promise.all([
    q(""),
    q("AND EXISTS (SELECT 1 FROM cards c WHERE c.user_id = u.id AND c.created_at >= ? AND c.created_at < ?)", since, end),
    q("AND EXISTS (SELECT 1 FROM cards c WHERE c.user_id = u.id AND c.listed_at >= ? AND c.listed_at < ?)", since, end),
    q("AND EXISTS (SELECT 1 FROM cards c WHERE c.user_id = u.id AND c.status = 'sold' AND c.sold_at >= ? AND c.sold_at < ?)", since, end),
    q("AND u.sub_status IN ('active','trialing')"),
  ]);
  return { signedUp, scanned, listed, sold, paying };
}

export async function getAnalytics(window: Window, realNow = Date.now()): Promise<Analytics> {
  const range = typeof window === "string" ? window : window.id;
  const since = typeof window === "string" ? realNow - RANGES.find((r) => r.id === window)!.hours * HOUR_MS : window.since;
  // A custom window ends one ms before the next Eastern midnight so the last bucket is the `to` day, not the day after.
  const now = typeof window === "string" ? realNow : window.end - 1;
  const hourly = range === "24h";
  const m = (spec: Spec) => metric(spec, since, now, hourly);

  const [
    visitors, pageViews, signups, scans, visionCalls, visionCostMicros, priceChecks, listed, sold, soldUsd,
    subPayments, subIncomeUsd,
    wishlist, helpMessages, errors,
    cohort, everyone,
    pages, referrers, devices, countries, detailRows,
    scansByGame, priceChecksByGame,
    subRows, ebayConnected, totalUsers,
    socialRows, tiktokMarks,
    lifeSoldUsd, lifeSold, lifeListed,
    attrib,
  ] = await Promise.all([
    m({ table: "page_views", ts: "at", agg: "COUNT(DISTINCT visitor)" }),
    m({ table: "page_views", ts: "at", agg: "COUNT(*)" }),
    m({ table: "users", ts: "created_at", agg: "COUNT(*)" }),
    m({ table: "cards", ts: "created_at", agg: "COUNT(*)" }),
    m({ table: "scan_usage", ts: "at", agg: "COUNT(*)" }),
    m({ table: "scan_usage", ts: "at", agg: "COALESCE(SUM(cost_micros), 0)" }),
    m({ table: "price_checks", ts: "checked_at", agg: "COUNT(*)" }),
    m({ table: "cards", ts: "listed_at", agg: "COUNT(*)" }),
    m({ table: "cards", ts: "sold_at", agg: "COUNT(*)", where: "status = 'sold'" }),
    m({ table: "cards", ts: "sold_at", agg: "COALESCE(SUM(sold_price), 0)", where: "status = 'sold'" }),
    m({ table: "scan_credits", ts: "created_at", agg: "COUNT(*)", where: "kind = 'payment'" }),
    m({ table: "scan_credits", ts: "created_at", agg: `COALESCE(SUM(CASE plan WHEN 'pro' THEN ${PLAN_USD.pro} ELSE ${PLAN_USD.standard} END), 0)`, where: "kind = 'payment'" }),
    m({ table: "wishlist_items", ts: "added_at", agg: "COUNT(*)" }),
    m({ table: "help_messages", ts: "created_at", agg: "COUNT(*)", where: "role = 'user'" }),
    m({ table: "error_events", ts: "at", agg: "COUNT(*)" }),
    funnel(since, now + 1),
    activeFunnel(since, now + 1),
    rows<{ path: string; views: number; visitors: number }>(
      "SELECT path, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors FROM page_views WHERE at >= ? GROUP BY path ORDER BY views DESC, path LIMIT 12",
      since,
    ),
    rows<{ host: string; visitors: number }>(
      "SELECT ref AS host, COUNT(DISTINCT visitor) AS visitors FROM page_views WHERE at >= ? AND ref IS NOT NULL AND ref <> '' GROUP BY ref ORDER BY visitors DESC LIMIT 10",
      since,
    ),
    rows<{ device: string; visitors: number }>(
      "SELECT device, COUNT(DISTINCT visitor) AS visitors FROM page_views WHERE at >= ? AND device IS NOT NULL AND device <> '' GROUP BY device ORDER BY visitors DESC",
      since,
    ),
    rows<{ country: string; visitors: number }>(
      "SELECT country, COUNT(DISTINCT visitor) AS visitors FROM page_views WHERE at >= ? AND country IS NOT NULL AND country <> '' GROUP BY country ORDER BY visitors DESC LIMIT 10",
      since,
    ),
    rows<{ n: number }>("SELECT 1 AS n FROM page_views WHERE device IS NOT NULL LIMIT 1"),
    rows<{ game: string; scans: number }>(
      "SELECT COALESCE(game, 'pokemon') AS game, COUNT(*) AS scans FROM cards WHERE created_at >= ? GROUP BY 1 ORDER BY scans DESC",
      since,
    ),
    rows<{ game: string; checks: number }>(
      "SELECT COALESCE(game, 'pokemon') AS game, COUNT(*) AS checks FROM price_checks WHERE checked_at >= ? GROUP BY 1 ORDER BY checks DESC",
      since,
    ),
    rows<{ plan: string; status: string; users: number }>(
      "SELECT COALESCE(plan, 'standard') AS plan, sub_status AS status, COUNT(*) AS users FROM users WHERE sub_status IS NOT NULL GROUP BY 1, 2 ORDER BY users DESC",
    ),
    scalar("SELECT COUNT(*) AS n FROM users WHERE ebay_connected = 1"),
    scalar("SELECT COUNT(*) AS n FROM users"),
    rows<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE ?", `${LAST_POST_PREFIX}%`),
    rows<{ key: string; value: string }>("SELECT key, value FROM settings WHERE key LIKE ?", `${TIKTOK_POSTED_PREFIX}%`),
    scalar("SELECT COALESCE(SUM(sold_price), 0) AS n FROM cards WHERE status = 'sold'"),
    scalar("SELECT COUNT(*) AS n FROM cards WHERE status = 'sold'"),
    scalar("SELECT COUNT(*) AS n FROM cards WHERE listed_at IS NOT NULL OR status IN ('listed','sold')"),
    attribution(since, now + 1),
  ]);

  const visionCostUsd: Metric = {
    total: visionCostMicros.total / 1e6,
    prior: visionCostMicros.prior / 1e6,
    series: { ...visionCostMicros.series, values: visionCostMicros.series.values.map((v) => v / 1e6) },
  };

  const active = (plan: string) =>
    subRows.filter((r) => r.plan === plan && (r.status === "active" || r.status === "trialing")).reduce((a, r) => a + Number(r.users), 0);
  const activeStandard = active("standard");
  const activePro = active("pro");
  const statusSum = (s: string) => subRows.filter((r) => r.status === s).reduce((a, r) => a + Number(r.users), 0);

  const social = new Map<string, { lastDay: string | null; postsThatDay: number }>();
  for (const r of socialRows) {
    const rest = r.key.slice(LAST_POST_PREFIX.length);
    const [site, kind] = rest.split(":");
    const entry = social.get(site) ?? { lastDay: null, postsThatDay: 0 };
    if (kind === "uris") {
      try { entry.postsThatDay = (JSON.parse(r.value) as unknown[]).length; } catch { /* old shape */ }
    } else if (!kind) entry.lastDay = r.value;
    social.set(site, entry);
  }
  // TikTok is posted by hand: his Mark Posted clicks count when they are newer than the robot's last post.
  const hand = tiktokHandPosted(tiktokMarks);
  if (hand && hand.lastDay >= (social.get("tiktok")?.lastDay ?? "")) social.set("tiktok", hand);

  return {
    now,
    range,
    since,
    lifetime: { soldUsd: lifeSoldUsd, sold: lifeSold, listed: lifeListed },
    metrics: { visitors, pageViews, signups, scans, visionCalls, visionCostUsd, priceChecks, listed, sold, soldUsd, subPayments, subIncomeUsd, wishlist, helpMessages, errors },
    funnel: { cohort, everyone },
    pages: pages.map((p) => ({ path: p.path, views: Number(p.views), visitors: Number(p.visitors) })),
    referrers: referrers.map((r) => ({ host: r.host, visitors: Number(r.visitors) })),
    devices: devices.map((r) => ({ device: r.device, visitors: Number(r.visitors) })),
    countries: countries.map((r) => ({ country: r.country, visitors: Number(r.visitors) })),
    detailsCollected: detailRows.length > 0,
    scansByGame: scansByGame.map((r) => ({ game: r.game, scans: Number(r.scans) })),
    priceChecksByGame: priceChecksByGame.map((r) => ({ game: r.game, checks: Number(r.checks) })),
    subscriptions: {
      rows: subRows.map((r) => ({ plan: r.plan, status: r.status, users: Number(r.users) })),
      activeStandard,
      activePro,
      pastDue: statusSum("past_due"),
      canceled: statusSum("canceled"),
      mrrUsd: activeStandard * PLAN_USD.standard + activePro * PLAN_USD.pro,
      ebayConnected,
      totalUsers,
    },
    social: [...social.entries()].map(([site, v]) => ({ site, ...v })).sort((a, b) => a.site.localeCompare(b.site)),
    attribution: attrib,
  };
}

/** Percent change vs the prior period; null when there is nothing to compare against. */
export function deltaPct(cur: number, prior: number): number | null {
  if (!prior) return cur ? null : 0;
  return Math.round(((cur - prior) / prior) * 100);
}
