import { apiPath } from "@/lib/client/basePath";
import type { PrintedNumber } from "@/lib/cardNumber";
import type { GameId, PokemonCard, ScanLanguage } from "@/lib/types";

/**
 * `printed` carries the whole fraction, not just the collector number. The set
 * total is what separates two cards that share a name and a number — a Base
 * Set Charizard (4/102) from its Base Set 2 reprint (4/130) — so dropping it
 * here would leave the server ranking on a coin flip.
 *
 * `game` picks the catalogue: Pokémon (default) or MTG, where `printed.setCode`
 * is the printed 3–5 letter set code ("LTR") and the set total is unused.
 */
export async function searchCards(
  name: string,
  printed?: PrintedNumber | string | null,
  lang: ScanLanguage = "en",
  /** Omit for the scanner's default (24); search UIs ask for every printing. */
  limit?: number,
  game: GameId = "pokemon",
): Promise<PokemonCard[]> {
  const params = new URLSearchParams({ name, lang });
  if (game !== "pokemon") params.set("game", game);
  if (limit) params.set("limit", String(limit));

  if (typeof printed === "string") {
    if (printed) params.set("number", printed);
  } else if (printed) {
    params.set("number", printed.number);
    if (printed.setTotal) params.set("setTotal", String(printed.setTotal));
    if (printed.setCode) params.set("setCode", printed.setCode);
  }

  const res = await fetch(apiPath(`/api/search-card?${params.toString()}`));
  if (!res.ok) throw new Error(`Search failed (${res.status})`);

  const data = await res.json();
  return data.cards ?? [];
}
