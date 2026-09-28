import "server-only";
import { db } from "@/lib/db";
import { askingPriceFor } from "@/lib/listing";
import { usdSeries } from "@/lib/server/priceHistory";
import { inventoryValueSeries } from "@/lib/server/inventoryValue";
import { addDays, dayIndex, todayUtc } from "@/lib/priceSeries";
import type { GameId } from "@/lib/types";

/**
 * Collection insights (Tier 3 #17, 09-28): the stock-portfolio view of the
 * pile the seller holds. Everything comes from data we already keep — the
 * cards table, price_series through askingPriceFor (the same condition math
 * the live refresh uses) and inventoryValueSeries for the value line.
 *
 * "Holding" = every unsold row (draft, live, ended). Sold rows only appear
 * in the split and the sold total. Rows without a catalog id have no series,
 * so they count at their stored price and never move.
 */

const ROW_CAP = 600;
const MOVERS = 5;
const TOP = 10;

export interface InsightCard {
  id: string;
  name: string;
  setName: string;
  imageUrl: string;
  kind: "card" | "sealed";
  quantity: number;
  /** Today's asking price for one copy. */
  price: number;
  /** Asking price a week ago, null when the series has no reading. */
  weekAgo: number | null;
}

export interface Mover extends InsightCard {
  delta: number;
  pct: number;
}

export interface Bucket {
  name: string;
  value: number;
  count: number;
}

export interface Insights {
  game: GameId;
  holding: number;
  /** Value 7 and 30 days ago from the inventory value line (null = not enough history). */
  value: { now: number; weekAgo: number | null; monthAgo: number | null };
  gainers: Mover[];
  losers: Mover[];
  top: (InsightCard & { share: number })[];
  bySet: Bucket[];
  split: {
    live: { count: number; value: number };
    draft: { count: number; value: number };
    ended: { count: number; value: number };
    sold: { count: number; value: number };
  };
  /** Verified drafts that are not listed: the nudge under the split. */
  unlistedVerified: { count: number; value: number };
}

interface Row {
  id: string;
  card_name: string;
  set_name: string;
  image_url: string;
  kind: string;
  condition: string;
  status: string;
  price: number;
  sold_price: number | null;
  quantity: number | null;
  catalog_card_id: string | null;
  ebay_ended_at: number | null;
  verified_at: number | null;
  price_locked: number;
}

function onDay(series: { startDay: string; prices: (number | null)[] }, day: string): number | null {
  const i = Math.min(dayIndex(series.startDay, day), series.prices.length - 1);
  for (let j = i; j >= 0; j--) if (series.prices[j] != null) return series.prices[j];
  return null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function collectionInsights(userId: string, game: GameId, now = Date.now()): Promise<Insights> {
  const rows = (await db
    .prepare(
      `SELECT id, card_name, set_name, image_url, kind, condition, status, price, sold_price, quantity,
              catalog_card_id, ebay_ended_at, verified_at, price_locked
       FROM cards WHERE user_id = ? AND game = ?
       ORDER BY created_at DESC LIMIT ${ROW_CAP}`,
    )
    .all(userId, game)) as unknown as Row[];

  const ids = [...new Set(rows.filter((r) => r.status !== "sold" && r.catalog_card_id).map((r) => r.catalog_card_id!))];
  const series = ids.length ? await usdSeries(ids) : new Map<string, { variant: string; startDay: string; prices: (number | null)[] }>();
  const today = todayUtc(now);
  const lastWeek = addDays(today, -7);

  const cards: (InsightCard & { status: string; ended: boolean; verified: boolean })[] = [];
  for (const r of rows) {
    if (r.status === "sold") continue;
    const qty = r.quantity ?? 1;
    const s = r.catalog_card_id ? series.get(r.catalog_card_id) : undefined;
    const marketNow = s ? onDay(s, today) : null;
    const marketThen = s ? onDay(s, lastWeek) : null;
    // A hand-set price is the seller's number; otherwise today's market
    // through the condition math, falling back to the stored price.
    const price = r.price_locked ? r.price : marketNow != null && marketNow > 0 ? askingPriceFor(marketNow, r.condition) : r.price;
    const weekAgo = !r.price_locked && marketThen != null && marketThen > 0 ? askingPriceFor(marketThen, r.condition) : null;
    cards.push({
      id: r.id,
      name: r.card_name,
      setName: r.set_name,
      imageUrl: r.image_url,
      kind: r.kind === "sealed" ? "sealed" : "card",
      quantity: qty,
      price: r2(price),
      weekAgo: weekAgo != null ? r2(weekAgo) : null,
      status: r.status,
      ended: r.status === "listed" && !!r.ebay_ended_at,
      verified: !!r.verified_at,
    });
  }

  const holding = r2(cards.reduce((t, c) => t + c.price * c.quantity, 0));

  // Movers: per copy, a week of history required. Ties broken by dollars.
  const moved = cards
    .filter((c) => c.weekAgo != null && c.weekAgo > 0)
    .map((c) => ({ ...c, delta: r2(c.price - c.weekAgo!), pct: ((c.price - c.weekAgo!) / c.weekAgo!) * 100 }))
    .filter((c) => Math.abs(c.delta) >= 0.05);
  const gainers = moved.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta || b.pct - a.pct).slice(0, MOVERS);
  const losers = moved.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta || a.pct - b.pct).slice(0, MOVERS);

  const top = [...cards]
    .sort((a, b) => b.price * b.quantity - a.price * a.quantity)
    .slice(0, TOP)
    .map((c) => ({ ...c, share: holding > 0 ? (c.price * c.quantity) / holding : 0 }));

  const setMap = new Map<string, Bucket>();
  for (const c of cards) {
    const b = setMap.get(c.setName) ?? { name: c.setName, value: 0, count: 0 };
    b.value += c.price * c.quantity;
    b.count += c.quantity;
    setMap.set(c.setName, b);
  }
  const bySet = [...setMap.values()].map((b) => ({ ...b, value: r2(b.value) })).sort((a, b) => b.value - a.value);

  const split = {
    live: { count: 0, value: 0 },
    draft: { count: 0, value: 0 },
    ended: { count: 0, value: 0 },
    sold: { count: 0, value: 0 },
  };
  const unlistedVerified = { count: 0, value: 0 };
  for (const c of cards) {
    const key = c.status === "listed" ? (c.ended ? "ended" : "live") : "draft";
    split[key].count += c.quantity;
    split[key].value += c.price * c.quantity;
    if (key === "draft" && c.verified && c.kind === "card") {
      unlistedVerified.count += c.quantity;
      unlistedVerified.value += c.price * c.quantity;
    }
  }
  for (const r of rows) {
    if (r.status !== "sold") continue;
    split.sold.count += r.quantity ?? 1;
    split.sold.value += (r.sold_price ?? r.price) * (r.quantity ?? 1);
  }
  for (const k of Object.keys(split) as (keyof typeof split)[]) split[k].value = r2(split[k].value);
  unlistedVerified.value = r2(unlistedVerified.value);

  // The value line gives the 7 and 30 day change of the whole pile.
  const line = await inventoryValueSeries(userId, game, 31, now);
  const at = (day: string) => line.find((p) => p.day === day)?.value ?? null;
  // Both ends come from the line so the change agrees with the chart under
  // it; the hero number above stays `holding` (hand-set prices included).
  const value = {
    now: line.length ? line[line.length - 1].value : holding,
    weekAgo: line.length ? at(addDays(today, -7)) : null,
    monthAgo: line.length ? at(addDays(today, -30)) : null,
  };

  const strip = (c: (typeof cards)[number]): InsightCard => ({
    id: c.id,
    name: c.name,
    setName: c.setName,
    imageUrl: c.imageUrl,
    kind: c.kind,
    quantity: c.quantity,
    price: c.price,
    weekAgo: c.weekAgo,
  });
  return {
    game,
    holding,
    value,
    gainers: gainers.map((c) => ({ ...strip(c), delta: c.delta, pct: c.pct })),
    losers: losers.map((c) => ({ ...strip(c), delta: c.delta, pct: c.pct })),
    top: top.map((c) => ({ ...strip(c), share: c.share })),
    bySet,
    split,
    unlistedVerified,
  };
}
