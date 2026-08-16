import "server-only";
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getPlatformStats, type PlatformStats } from "@/lib/server/cards";
import { dailyStatus } from "@/lib/server/dailyJobs";
import { adminUsingDefaults } from "@/lib/adminAuth";

/**
 * Everything the admin console shows, gathered server-side in one place:
 * platform KPIs, 30-day activity series, per-user rollups, data/pipeline
 * health (mirrors, price history, daily job), and which integrations are
 * configured. Read-only aggregates — nothing here mutates.
 */

const DAY_MS = 86_400_000;

export interface DaySeries {
  /** ISO day, oldest first, exactly `days` entries. */
  days: string[];
  values: number[];
  total: number;
}

function daySeries(rows: { day: string; n: number }[], days: number, now = Date.now()): DaySeries {
  const map = new Map(rows.map((r) => [r.day, r.n]));
  const out: DaySeries = { days: [], values: [], total: 0 };
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * DAY_MS).toISOString().slice(0, 10);
    const n = map.get(d) ?? 0;
    out.days.push(d);
    out.values.push(n);
    out.total += n;
  }
  return out;
}

function perDay(table: string, tsColumn: string, days: number, where = "", now = Date.now()): DaySeries {
  const since = now - days * DAY_MS;
  const rows = db
    .prepare(
      `SELECT date(${tsColumn} / 1000, 'unixepoch') AS day, COUNT(*) AS n
         FROM ${table} WHERE ${tsColumn} >= ? ${where ? `AND ${where}` : ""}
        GROUP BY day`,
    )
    .all(since) as unknown as { day: string; n: number }[];
  return daySeries(rows, days, now);
}

export interface UserRollup {
  id: string;
  cards: number;
  listed: number;
  sold: number;
  revenue: number;
  wishlist: number;
  lastActive: number | null;
}

export interface AdminOverview {
  stats: PlatformStats & {
    newUsers7d: number;
    scans7d: number;
    scans30d: number;
    priceChecks7d: number;
    wishlistItems: number;
    mtgCards: number;
    pokemonCards: number;
  };
  activity: {
    scans: DaySeries;
    signups: DaySeries;
    priceChecks: DaySeries;
    sold: DaySeries;
  };
  userRollups: Record<string, UserRollup>;
  data: {
    enCards: number;
    jpCards: number;
    zhCards: number;
    mtgCards: number;
    mtgSets: number;
    mtgSyncedAt: number | null;
    priceSeries: { pokemon: number; mtg: number; total: number; latestDay: string | null };
    tcgplayerMap: number;
    dbBytes: number;
    seedMarker: string | null;
    daily: ReturnType<typeof dailyStatus>;
  };
  system: {
    node: string;
    uptimeSec: number;
    rssBytes: number;
    env: { name: string; ok: boolean; note?: string }[];
    adminDefaults: boolean;
  };
}

function count(sql: string, ...args: (string | number)[]): number {
  try {
    const row = db.prepare(sql).get(...args) as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

export function getAdminOverview(now = Date.now()): AdminOverview {
  const base = getPlatformStats();
  const week = now - 7 * DAY_MS;
  const month = now - 30 * DAY_MS;

  const rollupRows = db
    .prepare(
      `SELECT u.id,
              (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id) AS cards,
              (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id AND c.status = 'listed') AS listed,
              (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id AND c.status = 'sold') AS sold,
              (SELECT COALESCE(SUM(sold_price), 0) FROM cards c WHERE c.user_id = u.id AND c.status = 'sold') AS revenue,
              (SELECT COUNT(*) FROM wishlist_items w WHERE w.user_id = u.id) AS wishlist,
              (SELECT MAX(updated_at) FROM cards c WHERE c.user_id = u.id) AS lastActive
         FROM users u`,
    )
    .all() as unknown as UserRollup[];
  const userRollups: Record<string, UserRollup> = {};
  for (const r of rollupRows) userRollups[r.id] = { ...r, lastActive: r.lastActive ?? null };

  const seriesRow = db
    .prepare(
      `SELECT SUM(game = 'pokemon') AS pokemon, SUM(game = 'mtg') AS mtg, COUNT(*) AS total, MAX(updated_day) AS latest
         FROM price_series`,
    )
    .get() as { pokemon: number | null; mtg: number | null; total: number; latest: string | null } | undefined;

  const mtgSynced = db.prepare("SELECT MAX(synced_at) AS at FROM mtg_cards").get() as { at: number | null } | undefined;

  const dataDir = path.join(process.cwd(), "data");
  let dbBytes = 0;
  try {
    for (const f of ["cardflip.db", "cardflip.db-wal"]) {
      const p = path.join(dataDir, f);
      if (fs.existsSync(p)) dbBytes += fs.statSync(p).size;
    }
  } catch { /* unreadable */ }
  let seedMarker: string | null = null;
  try {
    const m = path.join(dataDir, "mtg-seed.imported");
    if (fs.existsSync(m)) seedMarker = fs.readFileSync(m, "utf8").trim();
  } catch { /* none */ }

  const env = process.env;
  const has = (k: string) => Boolean(env[k] && env[k]!.trim());
  const mem = process.memoryUsage();

  return {
    stats: {
      ...base,
      newUsers7d: count("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", week),
      scans7d: count("SELECT COUNT(*) AS n FROM cards WHERE created_at >= ?", week),
      scans30d: count("SELECT COUNT(*) AS n FROM cards WHERE created_at >= ?", month),
      priceChecks7d: count("SELECT COUNT(*) AS n FROM price_checks WHERE checked_at >= ?", week),
      wishlistItems: count("SELECT COUNT(*) AS n FROM wishlist_items"),
      mtgCards: count("SELECT COUNT(*) AS n FROM cards WHERE game = 'mtg'"),
      pokemonCards: count("SELECT COUNT(*) AS n FROM cards WHERE game = 'pokemon'"),
    },
    activity: {
      scans: perDay("cards", "created_at", 30, "", now),
      signups: perDay("users", "created_at", 30, "", now),
      priceChecks: perDay("price_checks", "checked_at", 30, "", now),
      sold: perDay("cards", "sold_at", 30, "status = 'sold'", now),
    },
    userRollups,
    data: {
      enCards: count("SELECT COUNT(*) AS n FROM en_cards"),
      jpCards: count("SELECT COUNT(*) AS n FROM jp_cards"),
      zhCards: count("SELECT COUNT(*) AS n FROM zh_cards"),
      mtgCards: count("SELECT COUNT(*) AS n FROM mtg_cards"),
      mtgSets: count("SELECT COUNT(*) AS n FROM mtg_sets"),
      mtgSyncedAt: mtgSynced?.at ?? null,
      priceSeries: {
        pokemon: Number(seriesRow?.pokemon ?? 0),
        mtg: Number(seriesRow?.mtg ?? 0),
        total: Number(seriesRow?.total ?? 0),
        latestDay: seriesRow?.latest ?? null,
      },
      tcgplayerMap: count("SELECT COUNT(*) AS n FROM tcgplayer_products"),
      dbBytes,
      seedMarker,
      daily: dailyStatus(),
    },
    system: {
      node: process.version,
      uptimeSec: Math.round(process.uptime()),
      rssBytes: mem.rss,
      env: [
        { name: "Anthropic vision", ok: has("ANTHROPIC_API_KEY") },
        { name: "pokemontcg.io key", ok: has("POKEMONTCG_API_KEY"), note: "optional — higher rate limit" },
        { name: "eBay app keyset", ok: has("EBAY_CLIENT_ID") && has("EBAY_CLIENT_SECRET") },
        { name: "eBay user OAuth (RuName)", ok: has("EBAY_RU_NAME") },
        { name: "eBay token key", ok: has("EBAY_TOKEN_KEY"), note: "falls back to client secret" },
        { name: "eBay deletion endpoint", ok: has("EBAY_VERIFICATION_TOKEN") },
        { name: "SMTP (password reset mail)", ok: has("SMTP_HOST") && has("SMTP_USER") && has("SMTP_PASS") },
        { name: "CRON_SECRET (daily pinger)", ok: has("CRON_SECRET") },
        { name: "Marketplace Insights", ok: env.EBAY_INSIGHTS_ENABLED === "1", note: "denied by eBay 2026-08-16" },
      ],
      adminDefaults: adminUsingDefaults(),
    },
  };
}
