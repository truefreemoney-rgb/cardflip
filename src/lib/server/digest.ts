import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { askingPriceFor } from "@/lib/listing";
import { isMailConfigured, sendWeeklyDigestEmail } from "@/lib/server/mail";
import { usdSeries } from "@/lib/server/priceHistory";
import { heldTrustOrOpen } from "@/lib/server/priceTrustSite";
import { addDays, dayIndex, todayUtc } from "@/lib/priceSeries";

/**
 * Weekly collection digest (Tier 2 #8, Chris 09-27): one Sunday mail per
 * seller with cards — what the pile is worth now vs a week ago, the five
 * biggest gainers and losers, what sold this week, and what has sat listed
 * 30+ days. Same price_series and condition math as the Inventory value
 * strip (inventoryValue.ts), so the numbers match the app. A card whose market
 * the price guard flags (priceTrustSite) and whose price the seller did not
 * type is left out of the value and the movers (one plain footnote in the mail
 * says how many); a mover's week-ago price that is junk counts as unchanged.
 *
 * Runs inside the daily job. digest_sent_week on users holds the Eastern
 * Sunday it last went out, so the job's repeated daily runs send once; the
 * unsubscribe link in the mail flips digest_off.
 */

const ROW_CAP = 400;
const USER_CAP = 500;
const TOP = 5;
const STALE_DAYS = 30;
const DAY = 86_400_000;

export interface DigestCard {
  id: string;
  name: string;
  set: string;
  number: string;
  /** Asking price today. */
  now: number;
  /** Asking price a week ago (today's when the series is younger than a week). */
  before: number;
  change: number;
  pct: number;
}

export interface Digest {
  valueNow: number;
  valueBefore: number;
  held: number;
  /** Cards left out because their market price looks off (only set when > 0). */
  leftOut?: number;
  gainers: DigestCard[];
  losers: DigestCard[];
  sold: Array<{ id: string; name: string; set: string; number: string; price: number; soldAt: number }>;
  stale: Array<{ id: string; name: string; set: string; number: string; price: number; days: number }>;
}

interface Row {
  id: string;
  card_name: string;
  set_name: string;
  card_number: string;
  condition: string;
  quantity: number | null;
  status: string;
  price: number;
  sold_price: number | null;
  sold_at: number | null;
  listed_at: number | null;
  catalog_card_id: string | null;
  game: string | null;
  price_locked: number | null;
}

/** Series value on `day` (nearest earlier reading; the first reading when the series starts later). */
function onDay(series: { startDay: string; prices: (number | null)[] }, day: string): number | null {
  const i = Math.min(dayIndex(series.startDay, day), series.prices.length - 1);
  for (let j = i; j >= 0; j--) if (series.prices[j] != null) return series.prices[j];
  for (let j = Math.max(i, 0); j < series.prices.length; j++) if (series.prices[j] != null) return series.prices[j];
  return null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The Eastern calendar day, yyyy-mm-dd. */
export function easternDay(now = Date.now()): string {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(now));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function isEasternSunday(now = Date.now()): boolean {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(now)) === "Sun";
}

/** The digest for one seller; null when there is nothing to say (no cards at all). */
export async function buildDigest(userId: string, now = Date.now()): Promise<Digest | null> {
  const rows = (await db
    .prepare(
      `SELECT id, card_name, set_name, card_number, condition, quantity, status, price,
              sold_price, sold_at, listed_at, catalog_card_id, game, price_locked
       FROM cards WHERE user_id = ? ORDER BY created_at DESC LIMIT ${ROW_CAP}`,
    )
    .all(userId)) as unknown as Row[];
  if (rows.length === 0) return null;

  const held = rows.filter((r) => r.status !== "sold");
  const ids = [...new Set(held.map((r) => r.catalog_card_id).filter((x): x is string => Boolean(x)))];
  const series = ids.length ? await usdSeries(ids) : new Map<string, { startDay: string; prices: (number | null)[] }>();
  const today = todayUtc(now);
  const weekAgo = addDays(today, -7);
  // One batched trust read for this seller's pile, judged on the default series the value below reads.
  const trust = await heldTrustOrOpen(held.flatMap((r) => (r.catalog_card_id ? [{ catalog_card_id: r.catalog_card_id, variant: null, game: r.game }] : [])), today);
  let leftOut = 0;

  const priced: DigestCard[] = [];
  let valueNow = 0;
  let valueBefore = 0;
  for (const r of held) {
    const s = r.catalog_card_id ? series.get(r.catalog_card_id) : null;
    const qty = r.quantity ?? 1;
    if (!s) {
      // No series: the hand-set price counts as flat.
      if (r.price > 0) {
        valueNow += r.price * qty;
        valueBefore += r.price * qty;
      }
      continue;
    }
    const market = onDay(s, today);
    if (market == null || !(market > 0)) continue;
    const held1 = { catalog_card_id: r.catalog_card_id!, variant: null, game: r.game };
    if (trust.flag(held1)) {
      // The market is junk: the seller's own price (typed, or a live listing's ask) counts flat, anything else is left out.
      if ((r.price_locked || r.status === "listed") && r.price > 0) {
        valueNow += r.price * qty;
        valueBefore += r.price * qty;
      } else {
        leftOut += qty;
      }
      continue;
    }
    const firstIdx = s.prices.findIndex((p) => p != null);
    const firstDay = firstIdx >= 0 ? addDays(s.startDay, firstIdx) : today;
    // A series younger than a week has no honest "before": count it as unchanged.
    let marketBefore = firstDay > weekAgo ? market : (onDay(s, weekAgo) ?? market);
    // A week-ago price the guard calls junk (a plateau that just corrected) is no honest "before": unchanged.
    if (marketBefore !== market && trust.flagOld(held1, 7, marketBefore)) marketBefore = market;
    const nowAsk = askingPriceFor(market, r.condition);
    const beforeAsk = askingPriceFor(marketBefore, r.condition);
    valueNow += nowAsk * qty;
    valueBefore += beforeAsk * qty;
    const change = round((nowAsk - beforeAsk) * qty);
    priced.push({
      id: r.id,
      name: r.card_name,
      set: r.set_name,
      number: r.card_number,
      now: round(nowAsk),
      before: round(beforeAsk),
      change,
      pct: beforeAsk > 0 ? Math.round(((nowAsk - beforeAsk) / beforeAsk) * 1000) / 10 : 0,
    });
  }
  const gainers = priced.filter((c) => c.change > 0).sort((a, b) => b.change - a.change).slice(0, TOP);
  const losers = priced.filter((c) => c.change < 0).sort((a, b) => a.change - b.change).slice(0, TOP);

  const sold = rows
    .filter((r) => r.status === "sold" && r.sold_at != null && r.sold_at > now - 7 * DAY && r.sold_at <= now)
    .map((r) => ({ id: r.id, name: r.card_name, set: r.set_name, number: r.card_number, price: round(r.sold_price ?? r.price), soldAt: r.sold_at! }))
    .sort((a, b) => b.soldAt - a.soldAt);
  const stale = rows
    .filter((r) => r.status === "listed" && r.listed_at != null && r.listed_at <= now - STALE_DAYS * DAY)
    .map((r) => ({ id: r.id, name: r.card_name, set: r.set_name, number: r.card_number, price: round(r.price), days: Math.floor((now - r.listed_at!) / DAY) }))
    .sort((a, b) => b.days - a.days);

  return { valueNow: round(valueNow), valueBefore: round(valueBefore), held: held.length, ...(leftOut > 0 ? { leftOut } : {}), gainers, losers, sold, stale };
}

export interface DigestSweepResult {
  skipped?: string;
  users: number;
  sent: number;
}

interface UserRow {
  id: string;
  email: string;
  digest_token: string | null;
  digest_sent_week: string | null;
}

/** Mint (once) the token the unsubscribe link carries. */
export async function digestTokenFor(userId: string): Promise<string> {
  const row = (await db.prepare("SELECT digest_token FROM users WHERE id = ?").get(userId)) as { digest_token: string | null } | undefined;
  if (row?.digest_token) return row.digest_token;
  const token = randomUUID().replace(/-/g, "");
  await db.prepare("UPDATE users SET digest_token = ? WHERE id = ? AND digest_token IS NULL").run(token, userId);
  return ((await db.prepare("SELECT digest_token FROM users WHERE id = ?").get(userId)) as { digest_token: string }).digest_token;
}

/** The unsubscribe link's landing: true when the token matched and the flag is now set. */
export async function unsubscribeDigest(userId: string, token: string): Promise<boolean> {
  if (!userId || !token) return false;
  const r = await db.prepare("UPDATE users SET digest_off = 1 WHERE id = ? AND digest_token = ?").run(userId, token);
  return Number(r.changes ?? 0) > 0;
}

export async function sweepWeeklyDigest(
  now = Date.now(),
  opts: { force?: boolean } = {},
  /** Test seam (scripts/test-digest.mjs). */
  deps: { send?: typeof sendWeeklyDigestEmail; configured?: () => boolean } = {},
): Promise<DigestSweepResult> {
  if (!(deps.configured ?? isMailConfigured)()) return { skipped: "mail not configured", users: 0, sent: 0 };
  if (!opts.force && !isEasternSunday(now)) return { skipped: "not Sunday", users: 0, sent: 0 };
  const send = deps.send ?? sendWeeklyDigestEmail;
  const week = easternDay(now);
  const users = (await db
    .prepare(
      `SELECT u.id, u.email, u.digest_token, u.digest_sent_week FROM users u
       WHERE u.digest_off = 0 AND u.email_pending = 0 AND EXISTS (SELECT 1 FROM cards c WHERE c.user_id = u.id)
       LIMIT ${USER_CAP}`,
    )
    .all()) as unknown as UserRow[];
  let sent = 0;
  for (const u of users) {
    if (u.digest_sent_week === week && !opts.force) continue;
    try {
      const digest = await buildDigest(u.id, now);
      if (!digest || (digest.held === 0 && digest.sold.length === 0)) continue;
      const token = u.digest_token ?? (await digestTokenFor(u.id));
      await send(u.email, digest, { userId: u.id, token });
      await db.prepare("UPDATE users SET digest_sent_week = ? WHERE id = ?").run(week, u.id);
      sent++;
    } catch (err) {
      // Stamp nothing on a failed send — the next run this Sunday retries.
      console.error(`weekly digest to ${u.email} failed:`, err);
    }
  }
  return { users: users.length, sent };
}
