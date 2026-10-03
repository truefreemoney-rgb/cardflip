import { EBAY_FEE_RATE, POSTAGE_USD } from "@/lib/fees";
import { formatMoney } from "@/lib/listing";
import { PRICE, SCANS } from "@/lib/pricing";

/**
 * /features — every user-facing feature, one sentence each (Chris 10-02
 * night: "we have a ton of features on the website now and i want to inform
 * prospecting and even existing users what all the features are"; the
 * homepage keeps its one promise, this page is the full list). Grouped by
 * the job the seller is doing. Every claim must match what the product does
 * today (data honesty): numbers come from lib/pricing.ts and lib/fees.ts,
 * never typed here, and a feature leaves this list the day it is switched
 * off. Plain module so the help robot and a test can read it.
 */
export interface Feature {
  title: string;
  body: string;
  /** Where "Try it" goes: an app screen, or a public page. */
  href: string;
  /** The link's label; "Try it" when absent. */
  cta?: string;
}

export interface FeatureGroup {
  id: "scan" | "price" | "track" | "sell";
  label: string;
  heading: string;
  features: Feature[];
}

const feePct = `${(EBAY_FEE_RATE * 100).toFixed(2).replace(/\.?0+$/, "")}%`;

export const FEATURE_GROUPS: FeatureGroup[] = [
  {
    id: "scan",
    label: "Scan",
    heading: "Point the camera. That is the whole job.",
    features: [
      { title: "Camera scan", body: "Fill the frame, tap Capture. CardFlip reads the name and collector number off the photo and prices the card in seconds.", href: "/app" },
      { title: "Five games, one scanner", body: "Pokémon, Magic: The Gathering, Disney Lorcana, One Piece and Yu-Gi-Oh!, every English set from the first to the newest. Switch games with one tap.", href: "/app" },
      { title: "Stamps and finishes", body: "The 1st Edition stamp and the foil finish are read from the photo, so a 1st Edition holo is priced as one, not as the plain card.", href: "/app" },
      { title: "Not your card?", body: "Every printing that shares the name is one tap away. Pick the right one and the price, title and listing follow it.", href: "/app" },
      { title: "Your photo, every time", body: "The camera is the only way in, on purpose: eBay rejects listings that reuse stock pictures, so every card you list carries the photo you took of it.", href: "/app" },
      { title: "Search for a price", body: "Just want a number? Search any card by name, set or number for free, no scan spent.", href: "/app/price-check", cta: "Search cards" },
      { title: "Torch and framing help", body: "A torch for dim rooms, corner brackets to frame the card, and a blur check that asks for another shot before a fuzzy photo goes anywhere.", href: "/app" },
    ],
  },
  {
    id: "price",
    label: "Price",
    heading: "The real price for the exact card in your hand.",
    features: [
      { title: "Market price per printing", body: "The live market price for that printing and that variant, not a guess from the card name. Holo, reverse holo and promo versions are priced apart.", href: "/app" },
      { title: "Condition and strategy", body: "Pick the condition and the price adjusts. Choose Quick Sale to move it this week or Full Value to hold out for the market.", href: "/app" },
      { title: "Price history chart", body: "Our own recorded history for every card: 30 days, 90 days or all of it, with the high and low of the window.", href: "/cards", cta: "Browse card prices" },
      { title: "Live eBay sold prices", body: "What the same card actually sold for on eBay, shown beside the market price, so the asking price is grounded in real sales.", href: "/app" },
      { title: `Cheap cards still pay you`, body: `A card under ${formatMoney(5)} is priced at its value plus eBay's ${feePct} fee and ${formatMoney(POSTAGE_USD)} postage, so it never lists at a loss. From ${formatMoney(5)} to ${formatMoney(10)} less of that is added, and nothing above.`, href: "/pricing", cta: "See the fee math" },
      { title: "Free public price pages", body: "Every card and every set has its own page with the market price, the chart and the other printings. No account needed.", href: "/cards", cta: "Open card prices" },
    ],
  },
  {
    id: "track",
    label: "Track",
    heading: "Your binder, as a list that knows what it is worth.",
    features: [
      { title: "Inventory", body: "Every scanned card with its status: in the binder, live on eBay, ended or sold. Search, sort, categories and bulk actions.", href: "/app/collection", cta: "Open Inventory" },
      { title: "Collection insights", body: "What the whole collection is worth, its move over 7 and 30 days, the biggest movers and your top ten cards.", href: "/app/collection/insights", cta: "See insights" },
      { title: "Set completion", body: "For every set you hold cards from: how many you have, how many are missing, and what finishing the set would cost today.", href: "/app/collection/sets", cta: "See sets" },
      { title: "Import a collection", body: "Bring a Collectr, TCGplayer or TCG Collector export in as a CSV and every card lands in Inventory, priced.", href: "/app/collection/import", cta: "Import" },
      { title: "Watchlist with alerts", body: "Watch any card with a target price. A daily check emails you the day it gets there.", href: "/app/wishlist", cta: "Open Watchlist" },
      { title: "Share your collection", body: "A public page of your collection at cardflip.io/u/your-handle, with today's prices and a Buy on eBay button where a card is listed.", href: "/app/account", cta: "Set it up" },
      { title: "Sales report", body: "Every sale with eBay's real fees and your profit, by month, downloadable as a CSV for tax time.", href: "/app/collection/report", cta: "Open report" },
    ],
  },
  {
    id: "sell",
    label: "Sell",
    heading: "From a photo to a live eBay listing in one tap.",
    features: [
      { title: "Your own eBay account", body: "Connect it once through eBay's own consent page. Listings publish under your account and eBay pays you directly. CardFlip takes no cut.", href: "/connect-ebay", cta: "Connect eBay" },
      { title: "The listing is written for you", body: "Title, description, photo and price, in eBay's format, from the scan. Review it, tap Post, and it is live.", href: "/app" },
      { title: "Six countries, your currency", body: "Sell on eBay in the US, Canada, the UK, Ireland, Australia or New Zealand. Prices, fees and postage follow your home country.", href: "/connect-ebay", cta: "Connect eBay" },
      { title: "Reprice in place", body: "Change a price in CardFlip and the live listing updates. No relisting, no lost watchers.", href: "/app/collection", cta: "Open Inventory" },
      { title: "Reprice nudges", body: "When a listing drifts 15% or more from the market, Inventory flags it and offers the new price in one tap.", href: "/app/collection", cta: "Open Inventory" },
      { title: "Offers to watchers", body: "Send a discount to everyone watching a listing by hand, or set a percentage once and CardFlip offers it on listings that have sat two weeks with watchers.", href: "/app/collection", cta: "Open Inventory" },
      { title: "Sales tracked for you", body: "A sale on eBay marks the card sold in CardFlip with the real fees. Sold it somewhere else? Mark it sold, one card or many.", href: "/app/collection", cta: "Open Inventory" },
    ],
  },
];

/** The strip under the heading: real numbers, same sources as the pricing page. */
export const FEATURE_FACTS = [
  { value: "5", label: "games" },
  { value: String(SCANS.trial), label: "free scans to start" },
  { value: "0%", label: "cut of your sales" },
  { value: PRICE.standard, label: `a month for ${SCANS.standard} scans` },
];

export const FEATURE_COUNT = FEATURE_GROUPS.reduce((n, g) => n + g.features.length, 0);
