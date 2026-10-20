/**
 * THE default printing, in one place (review 10-19 #16). Before this file the
 * app (lib/listing.ts) quoted holofoil > reverseHolofoil > normal while the
 * public pages, the alerts, the live refresh and the price guard quoted
 * normal first, so one card carried two headline prices and a draft could be
 * repriced to the other printing on Inventory load. Normal first is the
 * printing a seller is almost always holding (11,171 Pokemon cards have both
 * a normal and a reverse holo row); a card with no normal row (a holo rare)
 * falls through to its holofoil. The scan's own pattern read, the seller's
 * pick and the 1st Edition toggle still override this.
 */
export const DEFAULT_VARIANT_ORDER = ["normal", "nonfoil", "holofoil", "reverseHolofoil", "foil", "etched"] as const;

/** Position in the default-printing order (lower = the one people usually mean); unknown printings rank last. */
export const variantRank = (variant: string): number => (DEFAULT_VARIANT_ORDER as readonly string[]).indexOf(variant) + 1 || 99;