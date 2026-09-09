import "server-only";
import { db } from "@/lib/db";
import { plausiblePrices } from "@/lib/listing";
import { getFeaturedCard, getShowcaseCards } from "@/lib/tcg";
import { latestUsdPrices } from "@/lib/server/priceHistory";
import { gameOf, type CardPrice, type PokemonCard } from "@/lib/types";

/**
 * The cards on the empty scanner's stage (Uploader viewfinder). Chris,
 * 09-06: "sometimes this doesn't load … site locking up, slow loading" —
 * the route was asking pokemontcg.io (two queries, 5 retries × 8s) on every
 * cold function, measured at 12s from prod. Now: our own English mirror
 * first (one Turso query per icon name), and the finished list is cached in
 * card_cache for STAGE_TTL_MS, so the route is one read. pokemontcg.io is
 * only the fallback when the mirror is empty (fresh dev DB).
 */

export interface StageCard {
  name: string;
  setName: string;
  number: string;
  imageUrl: string;
  price: number | null;
  /** The one card the Uploader stage shows. See STAGE_LEAD_ICON. */
  lead?: boolean;
}

const STAGE_CARDS = 10;
const STAGE_TTL_MS = 6 * 60 * 60 * 1000;
// v5 (09-09): Gyarados is gone from the list, not just from the full-art
// slot. It held that slot through v3 and v4 and Chris asked twice for
// "something else"; while the name stayed here any other slot could still
// serve a Gyarados and read as no change at all.
const ICONS = ["Charizard", "Pikachu", "Mewtwo", "Gengar", "Umbreon", "Blastoise", "Lucario", "Dragonite", "Rayquaza", "Eevee"];

// v2 (09-07): printings nearest $50, not the dearest — Chris: "make it something worth like $50".
// v5 (09-09): $35 — "make the price around $35ish". The target lives in two
// places: here it decides each icon's printing, and Uploader picks the one
// stage card nearest the same number to show. Both have to move together or
// the retarget never reaches the card on screen.
const STAGE_TARGET_USD = 35;
const nearTarget = (card: PokemonCard) => Math.abs((marketOf(card) ?? Infinity) - STAGE_TARGET_USD);
const cacheKey = (magic: boolean) => `stage:v6:${magic ? "magic" : "pokemon"}`;

// v3 (09-09): one slot shows a full-art printing instead of the
// target-nearest one — Chris asked for "a full art card at a similar
// price". The mirror has no rarity column; isSecretRare (numbered above the
// set total) is the same full-art signal enCards.ts already uses for
// identification.
// v4 (09-09): unbounded "can range a lot" surfaced a full art priced well
// past $50, so the pick is bounded to a band instead (inside it scores 0),
// still falling back to the plain target-nearest pick when the mirror has
// no full art for that icon.
// v5 (09-09): the band follows the $35 target.
// v6 (09-09): Chris named the card — "pikachu, similar value" — so the slot
// is Pikachu at the same money (band unchanged), and the icon that owns it
// is now the same constant the stage leads with, below.
const STAGE_LEAD_ICON = "Pikachu";
const FULL_ART_ICONS = new Set([STAGE_LEAD_ICON]);
const FULL_ART_BAND_MIN_USD = 30;
const FULL_ART_BAND_MAX_USD = 40;
const distanceFromFullArtBand = (card: PokemonCard) => {
  const price = marketOf(card);
  if (price == null) return Infinity;
  if (price < FULL_ART_BAND_MIN_USD) return FULL_ART_BAND_MIN_USD - price;
  if (price > FULL_ART_BAND_MAX_USD) return price - FULL_ART_BAND_MAX_USD;
  return 0;
};

function marketOf(card: PokemonCard): number | null {
  return plausiblePrices(card.prices).find((p) => p.market)?.market ?? null;
}

function pick(card: PokemonCard, lead: boolean): StageCard {
  const out: StageCard = { name: card.name, setName: card.setName, number: card.number, imageUrl: card.imageLarge, price: marketOf(card) };
  if (lead) out.lead = true;
  return out;
}

/** Real, priced cards from the local mirror — the dearest printing of each icon. */
async function fromMirror(): Promise<{ cards: PokemonCard[]; leadId?: string }> {
  try {
    const { hasEnglishMirror, searchEnglishCardsLocal } = await import("@/lib/server/enCards");
    if (!(await hasEnglishMirror())) return { cards: [] };
    const results = await Promise.all(ICONS.map((name) => searchEnglishCardsLocal(name, null, 40)));
    // Mirror rows carry no prices; our own price_series does (one batch query,
    // the same join the set browser uses).
    const all = results.flatMap((r) => r.cards);
    const prices = await latestUsdPrices(all.map((c) => c.id));
    for (const card of all) {
      const p = prices.get(card.id);
      if (!p) continue;
      const entry: CardPrice = { source: "tcgplayer", variant: p.variant, label: p.variant, currency: "USD", market: p.price, low: null, high: null };
      card.prices = [entry];
    }
    const out: PokemonCard[] = [];
    let leadId: string | undefined;
    for (let i = 0; i < results.length; i++) {
      const candidates = results[i].cards.filter((c) => c.imageLarge && (marketOf(c) ?? 0) > 5);
      // The printing of each icon priced nearest the target — a card a
      // seller actually has in a binder, not the grail (was: the dearest
      // printing). The full-art icon instead takes its full-art printing
      // nearest the band.
      const best = FULL_ART_ICONS.has(ICONS[i])
        ? candidates.filter((c) => c.isSecretRare).sort((a, b) => distanceFromFullArtBand(a) - distanceFromFullArtBand(b))[0] ??
          candidates.sort((a, b) => nearTarget(a) - nearTarget(b))[0]
        : candidates.sort((a, b) => nearTarget(a) - nearTarget(b))[0];
      if (best) {
        out.push(best);
        if (ICONS[i] === STAGE_LEAD_ICON) leadId = best.id;
      }
    }
    // Nearest the target orders the reel; which card the stage SHOWS is the
    // lead flag, not this sort. Every icon's pick is chosen for being near
    // $35, so "nearest $35" was a coin toss between ten near-identical
    // distances — v3–v5 each renamed the full-art slot without any guarantee
    // that slot was the card on screen. The lead also goes first so the
    // ten-card cap (and the Magic interleave, which doubles the list) can
    // never slice it off.
    const sorted = out.sort((a, b) => nearTarget(a) - nearTarget(b));
    return { cards: sorted.sort((a, b) => Number(b.id === leadId) - Number(a.id === leadId)), leadId };
  } catch {
    return { cards: [] };
  }
}

async function fromMagic(): Promise<PokemonCard[]> {
  try {
    const { hasMtgMirror, mtgShowcase } = await import("@/lib/server/mtgCards");
    if (!(await hasMtgMirror())) return [];
    return await mtgShowcase(6);
  } catch {
    return [];
  }
}

function finish(cards: PokemonCard[], magic: boolean, leadId?: string): StageCard[] {
  const seen = new Set<string>();
  return cards
    .filter((c) => !!c && !!c.imageLarge)
    .filter((c) => magic || gameOf(c) !== "mtg")
    .filter((c) => {
      const key = c.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((c) => pick(c, c.id === leadId))
    .filter((c) => c.price != null)
    .slice(0, STAGE_CARDS);
}

async function build(magic: boolean): Promise<StageCard[]> {
  const { cards: pokemon, leadId } = await fromMirror();
  if (pokemon.length >= 6) {
    if (!magic) return finish(pokemon, false, leadId);
    const mtg = await fromMagic();
    const mixed: PokemonCard[] = [];
    for (let i = 0; i < Math.max(pokemon.length, mtg.length); i++) {
      if (pokemon[i]) mixed.push(pokemon[i]);
      if (mtg[i]) mixed.push(mtg[i]);
    }
    return finish(mixed, true, leadId);
  }
  // No mirror here (fresh dev DB): the old upstream path.
  const [featured, showcase] = await Promise.all([getFeaturedCard(), getShowcaseCards()]);
  return finish([featured, ...showcase].filter((c): c is PokemonCard => !!c), magic);
}

export async function getStageCards(magic: boolean, now = Date.now()): Promise<{ cards: StageCard[]; cached: boolean }> {
  const key = cacheKey(magic);
  try {
    const row = (await db.prepare("SELECT payload, cached_at FROM card_cache WHERE key = ?").get(key)) as
      | { payload: string; cached_at: number }
      | undefined;
    if (row && now - row.cached_at < STAGE_TTL_MS) {
      const cards = JSON.parse(row.payload) as StageCard[];
      if (cards.length > 0) return { cards, cached: true };
    }
  } catch {
    // Cache miss is fine.
  }
  const cards = await build(magic);
  if (cards.length > 0) {
    await db
      .prepare(
        `INSERT INTO card_cache (key, payload, cached_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, cached_at = excluded.cached_at`,
      )
      .run(key, JSON.stringify(cards), now)
      .catch(() => {});
  }
  return { cards, cached: false };
}
