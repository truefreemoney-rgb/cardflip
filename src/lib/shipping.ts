/**
 * How a sold card gets mailed (Chris 10-08: "we shouldn't let the user post
 * to eBay unless they pick a shipping option, and we should supply
 * instructions for shipping to the seller").
 *
 * Two picks on the US site. The postage of the pick sits inside the asking
 * price (lib/fees.ts), the buyer sees free shipping, and the eBay listing uses
 * the matching fulfillment policy ("CardFlip envelope" / "CardFlip shipping").
 * The instructions show on the Inventory row and the card sheet once the card
 * is live or sold, so the seller knows what to put it in.
 */
import { ENVELOPE_MAX_USD, POSTAGE_USD, TRACKED_POSTAGE_USD, type ShipMethod } from "./fees.ts";

export interface ShipOption {
  id: ShipMethod;
  label: string;
  /** One line under the label on the pick tile. */
  sub: string;
  postage: number;
}

export const SHIP_OPTIONS: readonly ShipOption[] = [
  { id: "envelope", label: "Envelope", sub: `eBay Standard Envelope, tracked, under $${ENVELOPE_MAX_USD}`, postage: POSTAGE_USD },
  { id: "tracked", label: "Tracked mailer", sub: "Bubble mailer, USPS Ground Advantage", postage: TRACKED_POSTAGE_USD },
];

export function shipLabel(method: ShipMethod | null | undefined): string {
  return method === "tracked" ? "Tracked mailer" : method === "envelope" ? "Envelope" : "Not picked";
}

/** Why the envelope tile is off at this price. */
export const ENVELOPE_OVER_CAP = `Over $${ENVELOPE_MAX_USD}, eBay needs a tracked mailer`;

/** The sentence the publish confirm shows for the pick. */
export function shipConfirmLine(method: ShipMethod): string {
  return method === "tracked"
    ? "Ships in a bubble mailer by USPS Ground Advantage. Free shipping for the buyer, the postage is already in your price."
    : "Ships as an eBay Standard Envelope (tracked). Free shipping for the buyer, the postage is already in your price.";
}

/** Step-by-step mailing instructions, shown once the card is live or sold. */
export function shipSteps(method: ShipMethod): string[] {
  return method === "tracked"
    ? [
        "Penny sleeve, then a toploader. Tape the top of the toploader shut.",
        "Put the toploader in a bubble mailer and tape it flat so it can't slide.",
        "Buy the USPS Ground Advantage label on eBay (Seller Hub → Orders → Print shipping label). Add insurance on a card over $100.",
        "Mail it within 1 business day. eBay adds the tracking to the order for you.",
      ]
    : [
        "Penny sleeve, then a toploader. Tape the top of the toploader shut.",
        "Put it in a plain white envelope with a stiff piece of cardboard, nothing thicker than a quarter inch.",
        "Buy the eBay Standard Envelope label on eBay (Seller Hub → Orders → Print shipping label), print it and tape it on.",
        "Drop it in any USPS mailbox within 1 business day. It is tracked, so eBay sees it on its way.",
      ];
}
