import "server-only";
import { db } from "@/lib/db";
import { askingPriceFor } from "@/lib/listing";
import { isMailConfigured, sendCardAlertEmail, type CardAlertHit } from "@/lib/server/mail";
import { usdSeries } from "@/lib/server/priceHistory";
import { addDays, dayIndex, todayUtc } from "@/lib/priceSeries";
import { sendPushToUser } from "@/lib/server/push";
import { cardAlertPush } from "@/lib/pushMessages";

/**
 * Price alerts on cards the seller OWNS (Tier 2 #7, 09-27). Two kinds, one
 * mail per user per daily pass:
 *
 *   target — "tell me when this hits $X" set on the collection page. Fires
 *            when today's market-based asking price (askingPriceFor, the
 *            number the app would price the card at) reaches the target;
 *            alerted_at stamps it and updateCard clears the stamp whenever
 *            the target changes.
 *   spike  — "sell now": a held card up SPIKE_PCT and SPIKE_MIN over its
 *            asking price a week ago. Nothing to set; spike_alerted_at keeps
 *            it to one nudge per card per SPIKE_COOLDOWN_DAYS.
 *
 * Same price_series the charts draw, so the sweep costs no external calls.
 */

const CHECK_CAP = 400;
export const SPIKE_PCT = 25;
export const SPIKE_MIN = 5;
export const SPIKE_COOLDOWN_DAYS = 30;
const DAY = 86_400_000;

interface Row {
  id: string;
  user_id: string;
  email: string;
  card_name: string;
  set_name: string;
  card_number: string;
  condition: string;
  catalog_card_id: string;
  alert_price: number | null;
  alerted_at: number | null;
  spike_alerted_at: number | null;
}

export interface CardAlertSweepResult {
  checked: number;
  sent: number;
  nudged: number;
}

function onDay(series: { startDay: string; prices: (number | null)[] }, day: string): number | null {
  const i = Math.min(dayIndex(series.startDay, day), series.prices.length - 1);
  for (let j = i; j >= 0; j--) if (series.prices[j] != null) return series.prices[j];
  return null;
}

export async function sweepCardAlerts(
  now = Date.now(),
  /** Test seam: the mailer and its configured check (scripts/test-card-alerts.mjs). */
  deps: { send?: typeof sendCardAlertEmail; configured?: () => boolean; push?: typeof sendPushToUser } = {},
): Promise<CardAlertSweepResult> {
  if (!(deps.configured ?? isMailConfigured)()) return { checked: 0, sent: 0, nudged: 0 };
  const send = deps.send ?? sendCardAlertEmail;
  const push = deps.push ?? sendPushToUser;
  const cooldown = now - SPIKE_COOLDOWN_DAYS * DAY;
  // Armed targets, plus every held card whose spike nudge is off cooldown.
  const rows = (await db
    .prepare(
      `SELECT c.id, c.user_id, u.email, c.card_name, c.set_name, c.card_number, c.condition,
              c.catalog_card_id, c.alert_price, c.alerted_at, c.spike_alerted_at
       FROM cards c JOIN users u ON u.id = c.user_id
       WHERE c.status != 'sold' AND c.catalog_card_id IS NOT NULL
         AND ((c.alert_price IS NOT NULL AND c.alerted_at IS NULL)
              OR c.spike_alerted_at IS NULL OR c.spike_alerted_at < ?)
       LIMIT ${CHECK_CAP}`,
    )
    .all(cooldown)) as unknown as Row[];
  if (rows.length === 0) return { checked: 0, sent: 0, nudged: 0 };

  const series = await usdSeries([...new Set(rows.map((r) => r.catalog_card_id))]);
  const today = todayUtc(now);
  const weekAgo = addDays(today, -7);
  const byUser = new Map<string, { email: string; userId: string; hits: Array<CardAlertHit & { rowId: string }> }>();
  for (const r of rows) {
    const s = series.get(r.catalog_card_id);
    if (!s) continue;
    const market = onDay(s, today);
    if (market == null || !(market > 0)) continue;
    const price = Math.round(askingPriceFor(market, r.condition) * 100) / 100;
    const hits: Array<CardAlertHit & { rowId: string }> = [];
    if (r.alert_price != null && r.alerted_at == null && price >= r.alert_price) {
      hits.push({ rowId: r.id, name: r.card_name, set: r.set_name, number: r.card_number, price, target: r.alert_price, kind: "target" });
    }
    if (r.spike_alerted_at == null || r.spike_alerted_at < cooldown) {
      const firstIdx = s.prices.findIndex((p) => p != null);
      const firstDay = firstIdx >= 0 ? addDays(s.startDay, firstIdx) : today;
      const marketBefore = firstDay > weekAgo ? null : onDay(s, weekAgo);
      if (marketBefore != null && marketBefore > 0) {
        const before = Math.round(askingPriceFor(marketBefore, r.condition) * 100) / 100;
        if (price - before >= SPIKE_MIN && (price - before) / before >= SPIKE_PCT / 100) {
          hits.push({ rowId: r.id, name: r.card_name, set: r.set_name, number: r.card_number, price, target: before, kind: "spike" });
        }
      }
    }
    if (hits.length === 0) continue;
    const entry = byUser.get(r.user_id) ?? { email: r.email, userId: r.user_id, hits: [] };
    entry.hits.push(...hits);
    byUser.set(r.user_id, entry);
  }

  let sent = 0;
  let nudged = 0;
  for (const { email, userId, hits } of byUser.values()) {
    try {
      await send(email, hits);
      for (const h of hits) {
        if (h.kind === "target") {
          await db.prepare("UPDATE cards SET alerted_at = ? WHERE id = ?").run(now, h.rowId);
          sent++;
        } else {
          await db.prepare("UPDATE cards SET spike_alerted_at = ? WHERE id = ?").run(now, h.rowId);
          nudged++;
        }
      }
      // The phone banner rides along with the mail (Tier 2 #9); it never throws.
      await push(userId, cardAlertPush(hits));
    } catch (err) {
      // Stamp nothing on a failed send — the next daily pass retries.
      console.error(`card alert email to ${email} failed:`, err);
    }
  }
  return { checked: rows.length, sent, nudged };
}
