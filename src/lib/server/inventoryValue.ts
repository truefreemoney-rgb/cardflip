import "server-only";
import { db } from "@/lib/db";
import { askingPriceFor } from "@/lib/listing";
import { usdSeries } from "@/lib/server/priceHistory";
import { addDays, dayIndex, todayUtc } from "@/lib/priceSeries";
import type { GameId } from "@/lib/types";

/**
 * Inventory value over time (Chris, 09-10: "a graph of their listing value
 * changing over time"). One point per day: the asking price of every copy the
 * seller held that day, from our own price_series through the same condition
 * math the live refresh uses (askingPriceFor) — so today's point is the
 * Inventory panel's "Asking" line, give or take hand-set prices.
 *
 * It is a market view of the pile the seller holds today: every card counts
 * across the whole window (a pile scanned this afternoon still gets a line —
 * Chris's first look at it was 40 cards scanned that day and an empty strip),
 * and a sold copy stops counting after its sale day. Rows without a catalog
 * id (pre-09-01 scans) are skipped, the same as the live refresh.
 */

const ROW_CAP = 400;
export const MAX_VALUE_DAYS = 365;

export interface ValuePoint {
  day: string;
  value: number;
}

interface Row {
  catalog_card_id: string;
  condition: string;
  quantity: number | null;
  status: string;
  created_at: number;
  sold_at: number | null;
}

/** Series value on `day` (nearest earlier reading; the first reading when the series starts later). */
function onDay(series: { startDay: string; prices: (number | null)[] }, day: string): number | null {
  const i = Math.min(dayIndex(series.startDay, day), series.prices.length - 1);
  for (let j = i; j >= 0; j--) if (series.prices[j] != null) return series.prices[j];
  for (let j = Math.max(i, 0); j < series.prices.length; j++) if (series.prices[j] != null) return series.prices[j];
  return null;
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export async function inventoryValueSeries(
  userId: string,
  game: GameId,
  days: number,
  now = Date.now(),
): Promise<ValuePoint[]> {
  const span = Math.min(MAX_VALUE_DAYS, Math.max(2, Math.floor(days)));
  const rows = (await db
    .prepare(
      `SELECT catalog_card_id, condition, quantity, status, created_at, sold_at FROM cards
       WHERE user_id = ? AND game = ? AND catalog_card_id IS NOT NULL
       ORDER BY created_at DESC LIMIT ${ROW_CAP}`,
    )
    .all(userId, game)) as unknown as Row[];
  if (rows.length === 0) return [];

  const series = await usdSeries([...new Set(rows.map((r) => r.catalog_card_id))]);
  const today = todayUtc(now);
  const firstDay = addDays(today, -(span - 1));
  const held = rows
    .map((r) => ({
      series: series.get(r.catalog_card_id) ?? null,
      condition: r.condition,
      qty: r.quantity ?? 1,
      // Day of the series' first reading — the line starts at the earliest one.
      first: (() => {
        const s = series.get(r.catalog_card_id);
        const i = s ? s.prices.findIndex((p) => p != null) : -1;
        return s && i >= 0 ? addDays(s.startDay, i) : null;
      })(),
      // A sold row leaves the pile on its sale day (the day itself still counts).
      until: r.status === "sold" && r.sold_at ? dayOf(r.sold_at) : null,
    }))
    .filter((h) => h.series !== null);
  if (held.length === 0) return [];
  // No reading anywhere before this day — onDay would only echo a series'
  // first value backwards, which is not history.
  const earliest = held.map((h) => h.first!).sort()[0];
  const startDay = earliest > firstDay ? earliest : firstDay;

  const out: ValuePoint[] = [];
  for (let day = startDay; day <= today; day = addDays(day, 1)) {
    let value = 0;
    for (const h of held) {
      if (h.until && day > h.until) continue;
      const market = onDay(h.series!, day);
      if (market == null || !(market > 0)) continue;
      value += askingPriceFor(market, h.condition) * h.qty;
    }
    out.push({ day, value: Math.round(value * 100) / 100 });
  }
  return out.some((p) => p.value > 0) ? out : [];
}
