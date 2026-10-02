import type { GameId, PokemonCard } from "@/lib/types";
import { englishCardById } from "@/lib/server/enCards";
import { mtgCardById } from "@/lib/server/mtgCards";
import { isTcgGame, tcgCardById } from "@/lib/server/tcgCards";

/**
 * A card with no picture asks the catalog again.
 *
 * 10-02: Chris searched "charizard" on the Watchlist and the 30th Classic
 * Collection tile said "No image", and the row he saved stored an empty
 * picture URL. The catalog had the picture by then; the answer came from a
 * card_cache row written before the picture was filled (card_cache stores the
 * payload verbatim, and a picture fill does not touch it). 64 of 1,839 cache
 * rows still carried such a card. Cards that have a picture cost nothing here.
 */

/** The catalog's current picture for a card, or null when it has none (or the id is unknown). */
export async function catalogPicture(id: string, game: GameId | null | undefined): Promise<{ small: string; large: string } | null> {
  const g = game ?? "pokemon";
  const card = g === "mtg" ? (await mtgCardById(id))[0] : isTcgGame(g) ? (await tcgCardById(id))[0] : (await englishCardById(id)).cards[0];
  return card?.imageSmall ? { small: card.imageSmall, large: card.imageLarge || card.imageSmall } : null;
}

export async function fillMissingPictures(cards: PokemonCard[]): Promise<PokemonCard[]> {
  return Promise.all(
    cards.map(async (card) => {
      if (card.imageSmall) return card;
      const pic = await catalogPicture(card.id, card.game).catch(() => null);
      return pic ? { ...card, imageSmall: pic.small, imageLarge: pic.large } : card;
    }),
  );
}
