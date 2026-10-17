import "server-only";
import { db } from "@/lib/db";

/**
 * "Price looks wrong?" (A-H #9, 10-17): a reader on a card page says the price is too high or too low. Each report
 * lands on /admin/prices under "Readers flagged", where I check eBay sold and call it the usual way. One vote per
 * card page + printing + visitor (a second click from the same visitor only updates their vote); 90 days kept.
 */

export type PriceReportDirection = "high" | "low";

const KEEP_MS = 90 * 24 * 60 * 60 * 1000;
/** A card page path the site serves: /cards/<game>/<set>/<name>--<key>. */
const CARD_PATH = /^\/cards\/[a-z0-9-]{1,40}\/[a-z0-9-]{1,120}\/[A-Za-z0-9\-._~%]{1,200}--[A-Za-z0-9\-._~%]{1,160}$/;
const VARIANT = /^[A-Za-z0-9 _-]{1,40}$/;

export interface PriceReportInput {
  path: string;
  variant: string;
  direction: PriceReportDirection;
  price: number | null;
}

/** Validates a report body; null when any field is off (the route answers 400). */
export function parsePriceReport(body: unknown): PriceReportInput | null {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return null;
  const path = typeof b.path === "string" ? b.path : "";
  const variant = typeof b.variant === "string" ? b.variant : "";
  const direction = b.direction === "high" || b.direction === "low" ? b.direction : null;
  const price = typeof b.price === "number" && Number.isFinite(b.price) && b.price >= 0 && b.price < 10_000_000 ? Math.round(b.price * 100) / 100 : null;
  if (!CARD_PATH.test(path) || !VARIANT.test(variant) || !direction) return null;
  return { path, variant, direction, price };
}

export async function addPriceReport(r: PriceReportInput, reporter: string, now = Date.now()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO price_reports (path, variant, reporter, direction, price_usd, at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (path, variant, reporter) DO UPDATE SET direction = excluded.direction, price_usd = excluded.price_usd, at = excluded.at`,
    )
    .run(r.path, r.variant, reporter, r.direction, r.price, now);
  await db.prepare("DELETE FROM price_reports WHERE at < ?").run(now - KEEP_MS);
}

export interface PriceReportRow {
  path: string;
  variant: string;
  high: number;
  low: number;
  /** The price the newest report saw. */
  price: number | null;
  last: number;
}

/** One row per card page + printing, most votes first, then newest. */
export async function listPriceReports(limit = 100): Promise<PriceReportRow[]> {
  const rows = (await db
    .prepare(
      `SELECT path, variant,
              SUM(CASE WHEN direction = 'high' THEN 1 ELSE 0 END) AS high,
              SUM(CASE WHEN direction = 'low' THEN 1 ELSE 0 END) AS low,
              MAX(at) AS last,
              (SELECT p2.price_usd FROM price_reports p2 WHERE p2.path = p.path AND p2.variant = p.variant ORDER BY p2.at DESC LIMIT 1) AS price
         FROM price_reports p GROUP BY path, variant ORDER BY COUNT(*) DESC, last DESC LIMIT ?`,
    )
    .all(limit)) as { path: string; variant: string; high: number; low: number; last: number; price: number | null }[];
  return rows.map((r) => ({ path: r.path, variant: r.variant, high: Number(r.high), low: Number(r.low), price: r.price == null ? null : Number(r.price), last: Number(r.last) }));
}

/** "Charizard (base-set)" from /cards/pokemon/base-set/charizard--base1-4, for the admin list. */
export function reportLabel(path: string): { game: string; set: string; name: string } {
  const [, , game = "", set = "", seg = ""] = path.split("/");
  const name = decodeURIComponent(seg.slice(0, seg.lastIndexOf("--")))
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
  return { game, set, name };
}
