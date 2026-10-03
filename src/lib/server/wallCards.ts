import "server-only";
import { CHART_MIN_POINTS } from "@/lib/cardPages";
import { plausiblePrices } from "@/lib/listing";
import { usdSeries } from "@/lib/server/priceHistory";
import { trustedUsdPrices } from "@/lib/server/priceTrustLoad";
import { GAME_ICONS, STAGE_ICONS } from "@/lib/server/stageCards";
import { composeWall } from "@/lib/wallMix";
import type { CardPrice, GameId, PokemonCard } from "@/lib/types";

/**
 * The homepage card wall and ticker, from our own mirrors (10-02 night).
 * Until now the wall was pokemontcg.io's dearest hits plus Magic's showcase,
 * and the page then dropped every card under CHART_MIN_POINTS recorded days
 * (every wall card opens a chart); the Pokémon picks were new chase cards
 * with thin history, so the wall came out Magic-heavy. Here each icon's
 * printing is chosen FOR its history: the one with the most priced days
 * inside a sane band, so the chart behind every card is a real line.
 *
 * Lorcana / One Piece / Yu-Gi-Oh! history started 09-30 (tcgPriceRefresh),
 * so their slots fill themselves once the first printings reach the bar;
 * composeWall gives Pokémon the slots until then.
 */
const WALL_BAND: [number, number] = [15, 500];
const inBand = (n: number) => n >= WALL_BAND[0] && n <= WALL_BAND[1];
const marketOf = (c: PokemonCard) => plausiblePrices(c.prices).find((p) => p.market && p.currency === "USD")?.market ?? null;

/** Candidates → one printing per icon: priced, charted, in the band when any is. */
function pickPerIcon(groups: PokemonCard[][], points: Map<string, number>): PokemonCard[] {
  const out: PokemonCard[] = [];
  const used = new Set<string>();
  for (const group of groups) {
    const ok = group.filter((c) => c.imageSmall && !used.has(c.id) && (marketOf(c) ?? 0) > 5 && (points.get(c.id) ?? 0) >= CHART_MIN_POINTS);
    const pool = ok.some((c) => inBand(marketOf(c)!)) ? ok.filter((c) => inBand(marketOf(c)!)) : ok;
    const best = pool.sort((a, b) => points.get(b.id)! - points.get(a.id)! || marketOf(b)! - marketOf(a)!)[0];
    if (best) {
      out.push(best);
      used.add(best.id);
    }
  }
  return out;
}

async function pointsOf(ids: string[]): Promise<Map<string, number>> {
  const series = await usdSeries(ids);
  const out = new Map<string, number>();
  for (const id of ids) out.set(id, series.get(id)?.prices.filter((p) => p != null).length ?? 0);
  return out;
}

async function pokemonPool(): Promise<PokemonCard[]> {
  const { hasEnglishMirror, searchEnglishCardsLocal } = await import("@/lib/server/enCards");
  if (!(await hasEnglishMirror())) return [];
  const groups = (await Promise.all(STAGE_ICONS.map((name) => searchEnglishCardsLocal(name, null, 40)))).map((r) => r.cards);
  const all = groups.flat();
  // Mirror rows carry no prices; price_series does, and only prices the guard believes come back.
  const [{ prices }, points] = await Promise.all([trustedUsdPrices(all.map((c) => c.id)), pointsOf(all.map((c) => c.id))]);
  for (const card of all) {
    const p = prices.get(card.id);
    const entry: CardPrice | null = p ? { source: "tcgplayer", variant: p.variant, label: p.variant, currency: "USD", market: p.price, low: null, high: null } : null;
    card.prices = entry ? [entry] : [];
  }
  return pickPerIcon(groups, points);
}

async function magicPool(): Promise<PokemonCard[]> {
  const { hasMtgMirror, mtgShowcase } = await import("@/lib/server/mtgCards");
  if (!(await hasMtgMirror())) return [];
  const cards = await mtgShowcase(12);
  const points = await pointsOf(cards.map((c) => c.id));
  return pickPerIcon(cards.map((c) => [c]), points);
}

async function tcgPool(game: "lorcana" | "onepiece" | "yugioh"): Promise<PokemonCard[]> {
  const { hasTcgMirror, searchTcgCardsLocal } = await import("@/lib/server/tcgCards");
  if (!(await hasTcgMirror(game))) return [];
  const groups = await Promise.all(GAME_ICONS[game].map((name) => searchTcgCardsLocal(game, name, null, 40)));
  // One Piece promos carry Bandai's SAMPLE stamp and DON!! cards have no name a visitor knows (stageCards).
  const clean = groups.map((g) => g.filter((c) => c.setCode !== "PROMO" && c.setCode !== "DON"));
  const points = await pointsOf(clean.flat().map((c) => c.id));
  return pickPerIcon(clean, points);
}

const safe = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);

/** The wall + ticker list for the games the public can scan, in the recipe's order. Empty when the mirrors are (fresh dev DB). */
export async function wallCards(games: GameId[], day = new Date().toISOString().slice(0, 10)): Promise<PokemonCard[]> {
  const has = (g: GameId) => games.includes(g);
  const [pokemon, mtg, lorcana, onepiece, yugioh] = await Promise.all([
    safe(pokemonPool()),
    has("mtg") ? safe(magicPool()) : Promise.resolve([]),
    has("lorcana") ? safe(tcgPool("lorcana")) : Promise.resolve([]),
    has("onepiece") ? safe(tcgPool("onepiece")) : Promise.resolve([]),
    has("yugioh") ? safe(tcgPool("yugioh")) : Promise.resolve([]),
  ]);
  const seed = Number(day.replace(/-/g, "")) || 0;
  return composeWall({ pokemon, mtg, lorcana, onepiece, yugioh }, 24, seed);
}
