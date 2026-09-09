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
}

const STAGE_CARDS = 10;
const STAGE_TTL_MS = 6 * 60 * 60 * 1000;
const ICONS = ["Charizard", "Pikachu", "Mewtwo", "Gengar", "Umbreon", "Blastoise", "Gyarados", "Dragonite", "Rayquaza", "Eevee"];

// v2 (09-07): printings nearest $50, not the dearest — Chris: "make it something worth like $50".
const STAGE_TARGET_USD = 50;
const nearTarget = (card: PokemonCard) => Math.abs((marketOf(card) ?? Infinity) - STAGE_TARGET_USD);
const cacheKey = (magic: boolean) => `stage:v2:${magic ? "magic" : "pokemon"}`;

function marketOf(card: PokemonCard): number | null {
  return plausiblePrices(card.prices).find((p) => p.market)?.market ?? null;
}

function pick(card: PokemonCard): StageCard {
  return { name: card.name, setName: card.setName, number: card.number, imageUrl: card.imageLarge, price: marketOf(card) };
}

/**
 * Icons where a full-art printing should be preferred over the strict
 * nearest-$50 pick, priced with much more slack than STAGE_TARGET_USD asks
 * of the rest (Chris, 09-09: "change the gyarados image ... [to] a full art
 * card at the similar price, can range a lot"). isSecretRare is a
 * numerator-over-set-total read, not a rarity column the mirror doesn't
 * have — see the ART_PENALTY comment above.
 */
const PREFER_FULL_ART = new Set(["Gyarados"]);

function bestPrinting(name: string, cards: PokemonCard[]): PokemonCard | undefined {
  const priced = cards.filter((c) => c.imageLarge && (marketOf(c) ?? 0) > 5);
  if (PREFER_FULL_ART.has(name)) {
    const fullArt = priced.filter((c) => c.isSecretRare);
    if (fullArt.length > 0) return fullArt.sort((a, b) => nearTarget(a) - nearTarget(b))[0];
  }
  return priced.sort((a, b) => nearTarget(a) - nearTarget(b))[0];
}

/** Real, priced cards from the local mirror — the dearest printing of each icon. */
async function fromMirror(): Promise<PokemonCard[]> {
  try {
    const { hasEnglishMirror, searchEnglishCardsLocal } = await import("@/lib/server/enCards");
    if (!(await hasEnglishMirror())) return [];
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
    for (let i = 0; i < results.length; i++) {
      const best = bestPrinting(ICONS[i], results[i].cards);
      if (best) out.push(best);
    }
    // Nearest $50 leads; the stage shows one still card (Uploader picks [0]-ish by the same rule).
    return out.sort((a, b) => nearTarget(a) - nearTarget(b));
  } catch {
    return [];
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

function finish(cards: PokemonCard[], magic: boolean): StageCard[] {
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
    .map(pick)
    .filter((c) => c.price != null)
    .slice(0, STAGE_CARDS);
}

async function build(magic: boolean): Promise<StageCard[]> {
  const pokemon = await fromMirror();
  if (pokemon.length >= 6) {
    if (!magic) return finish(pokemon, false);
    const mtg = await fromMagic();
    const mixed: PokemonCard[] = [];
    for (let i = 0; i < Math.max(pokemon.length, mtg.length); i++) {
      if (pokemon[i]) mixed.push(pokemon[i]);
      if (mtg[i]) mixed.push(mtg[i]);
    }
    return finish(mixed, true);
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
