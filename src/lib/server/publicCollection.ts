import "server-only";
import { db } from "@/lib/db";
import { findUserByHandle } from "@/lib/server/users";
import { latestUsdPrices } from "@/lib/server/priceHistory";
import { heldTrustOrOpen } from "@/lib/server/priceTrustSite";
import { askingPriceFor } from "@/lib/listing";
import { ebayListingUrl } from "@/lib/ebayInventory";
import type { GameId } from "@/lib/types";
import { parseGame } from "@/lib/games";

/**
 * Public collection page (Tier 2 #10, 09-27): cardflip.io/u/<handle>.
 *
 * What a visitor sees: the seller's display name, every card they own that
 * is not sold, at today's price, with a "Buy on eBay" link on the rows
 * that are live there. Private by default — a handle with the switch off
 * answers null, same as no handle at all, so the page 404s either way and
 * nobody can tell which. Read-only: prices come from price_series
 * (latestUsdPrices), never the live refresh, so a public hit writes
 * nothing. Sealed rows ride along with their own name.
 *
 * The price guard (priceTrustSite): a draft whose price came from a market the
 * rule flags (and that the seller did not type) shows no price and is left out
 * of the total, so a stranger never sees a junk value. A live eBay listing's
 * price is the seller's real ask and always shows.
 */

export const PUBLIC_CARD_CAP = 500;

export interface PublicCard {
  id: string;
  name: string;
  setName: string;
  number: string;
  imageUrl: string;
  condition: string;
  game: GameId;
  kind: "card" | "sealed";
  /** Today's asking price for the condition; null = unpriced. */
  price: number | null;
  /** Live eBay listing, when there is one. */
  ebayUrl: string | null;
  firstEdition: boolean;
}

export interface PublicCollection {
  handle: string;
  name: string;
  cards: PublicCard[];
  count: number;
  /** Sum of the priced cards. */
  value: number;
  forSale: number;
  /** True when more cards exist than the page shows. */
  truncated: boolean;
}

interface Row {
  id: string;
  card_name: string;
  set_name: string;
  card_number: string;
  image_url: string;
  condition: string;
  game: string;
  kind: string;
  status: string;
  price: number | null;
  catalog_card_id: string | null;
  variant: string | null;
  price_locked: number | null;
  ebay_listing_id: string | null;
  first_edition: number | null;
  quantity: number | null;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** The page's data, or null when there is nothing public at this handle. */
export async function publicCollection(handle: string): Promise<PublicCollection | null> {
  const user = await findUserByHandle(handle);
  if (!user || !user.handlePublic || user.handle !== handle) return null;

  const rows = (await db
    .prepare(
      `SELECT id, card_name, set_name, card_number, image_url, condition, game, kind, status, price, catalog_card_id, variant, price_locked, ebay_listing_id, first_edition, quantity
         FROM cards
        WHERE user_id = ? AND status != 'sold'
        ORDER BY price DESC, created_at DESC
        LIMIT ?`,
    )
    .all(user.id, PUBLIC_CARD_CAP + 1)) as unknown as Row[];
  const truncated = rows.length > PUBLIC_CARD_CAP;
  const shown = rows.slice(0, PUBLIC_CARD_CAP);

  // A row priced by hand or by the daily refresh shows that price; one at
  // $0 (imported before its first refresh) falls back to today's market.
  const unpriced = shown.filter((r) => !(r.price && r.price > 0) && r.catalog_card_id).map((r) => r.catalog_card_id as string);
  const market = unpriced.length ? await latestUsdPrices([...new Set(unpriced)]) : new Map<string, { price: number; variant: string }>();

  const trust = await heldTrustOrOpen(shown.flatMap((r) => (r.catalog_card_id && r.kind !== "sealed" ? [{ catalog_card_id: r.catalog_card_id, variant: r.variant, game: r.game }] : [])));
  let value = 0;
  let forSale = 0;
  const cards: PublicCard[] = shown.map((r) => {
    let price: number | null = r.price && r.price > 0 ? round(r.price) : null;
    // The fallback reads the card's default series (latestUsdPrices), so it is judged on that
    // one; a stored price came from the row's own variant line and is judged on it.
    let judgedVariant = r.variant;
    if (price == null && r.catalog_card_id) {
      const m = market.get(r.catalog_card_id)?.price ?? 0;
      price = m > 0 ? askingPriceFor(m, r.condition) : null;
      judgedVariant = null;
    }
    // A price that came from a flagged market is not shown (nor counted); the seller's own price and a live ask are.
    if (price != null && r.catalog_card_id && r.kind !== "sealed" && !r.price_locked && r.status !== "listed" && trust.flag({ catalog_card_id: r.catalog_card_id, variant: judgedVariant, game: r.game })) price = null;
    if (price != null) value += price;
    const ebayUrl = r.status === "listed" && r.ebay_listing_id ? ebayListingUrl(r.ebay_listing_id) : null;
    if (ebayUrl) forSale++;
    return {
      id: r.id,
      name: r.card_name,
      setName: r.set_name,
      number: r.card_number,
      imageUrl: r.image_url,
      condition: r.condition,
      game: parseGame(r.game),
      kind: r.kind === "sealed" ? "sealed" : "card",
      price,
      ebayUrl,
      firstEdition: r.first_edition === 1,
    };
  });
  // Priced first, dearest at the top — the row price alone sorted $0 rows last already.
  cards.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));

  return {
    handle,
    name: user.name,
    cards,
    count: rows.length > PUBLIC_CARD_CAP ? PUBLIC_CARD_CAP : rows.length,
    value: round(value),
    forSale,
    truncated,
  };
}
