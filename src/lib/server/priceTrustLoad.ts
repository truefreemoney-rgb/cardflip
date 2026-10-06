import "server-only";
import { db } from "@/lib/db";
import { addDays, decodePrices, todayUtc } from "@/lib/priceSeries";
import { PRICE_TRUST, REF_ALT_SOURCE, isVintage, lastPriced, priceTrust } from "@/lib/server/priceTrust";

/**
 * priceTrust for a batch of Pokémon cards (one query per 400 ids): the
 * loader the stage strip uses, and the one the card pages and listing
 * suggestions can call. The judged series is the one the price comes from
 * (tcgplayer USD, the same variant order as latestUsdPrices), so the price
 * printed is the price tested. Cards that fail come back in `rejected`
 * (id + reason) so the caller can log them; they are not in `prices`.
 */
const VARIANT_ORDER = ["normal", "nonfoil", "holofoil", "reverseHolofoil"];
const rank = (variant: string) => VARIANT_ORDER.indexOf(variant) + 1 || 99;

interface Row {
  card_id: string;
  variant: string;
  source: string;
  prices: string;
}

export async function trustedUsdPrices(
  cardIds: string[],
  day = todayUtc(),
): Promise<{ prices: Map<string, { price: number; variant: string }>; rejected: { id: string; reason: string }[] }> {
  const prices = new Map<string, { price: number; variant: string }>();
  const rejected: { id: string; reason: string }[] = [];
  const cmSince = addDays(day, -PRICE_TRUST.refMaxAgeDays);
  for (let i = 0; i < cardIds.length; i += 400) {
    const chunk = cardIds.slice(i, i + 400);
    const rows = (await db
      .prepare(
        `SELECT card_id, variant, source, prices FROM price_series
          WHERE game = 'pokemon' AND card_id IN (${chunk.map(() => "?").join(",")})
            AND ((source = 'tcgplayer' AND currency = 'USD') OR (source IN ('cardmarket', '${REF_ALT_SOURCE}') AND variant = 'average' AND updated_day >= ?))`,
      )
      .all(...chunk, cmSince)) as unknown as Row[];
    const byCard = new Map<string, { usd: { variant: string; prices: (number | null)[]; last: number }[]; cm: number | null; alt: number | null }>();
    for (const r of rows) {
      const c = byCard.get(r.card_id) ?? { usd: [], cm: null, alt: null };
      byCard.set(r.card_id, c);
      const series = decodePrices(r.prices);
      const last = lastPriced(series);
      if (last == null) continue;
      if (r.source === "cardmarket") c.cm = last;
      else if (r.source === REF_ALT_SOURCE) c.alt = last;
      else c.usd.push({ variant: r.variant, prices: series, last });
    }
    // Vintage (1st Edition, pre-2010 sets) is judged on its own terms: thin and round are its ordinary state.
    const released = new Map(
      ((await db.prepare(`SELECT id, set_release_date FROM en_cards WHERE id IN (${chunk.map(() => "?").join(",")})`).all(...chunk)) as unknown as { id: string; set_release_date: string }[]).map((r) => [r.id, r.set_release_date]),
    );
    for (const [id, c] of byCard) {
      if (c.usd.length === 0) continue;
      const pref = c.usd.reduce((a, b) => (rank(b.variant) < rank(a.variant) ? b : a));
      const verdict = priceTrust({ to: pref.last, prices: pref.prices, siblings: c.usd.filter((s) => s !== pref).map((s) => s.last), refEur: c.cm, refAltEur: c.alt, vintage: isVintage(pref.variant, released.get(id) ?? "") });
      if (verdict.ok) prices.set(id, { price: pref.last, variant: pref.variant });
      else rejected.push({ id, reason: verdict.reason });
    }
  }
  return { prices, rejected };
}
