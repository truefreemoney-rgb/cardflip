import { SITE_URL } from "@/lib/siteUrl";

/**
 * Card pictures are served from cardflip.io/pics/... (Chris 10-12: "put in some safeguard so people cant use images
 * hosted on our website, on their own, like we did"). The files live in our Blob store under cards/; next.config
 * rewrites /pics/* there, so the store's own address never reaches a page, an API answer or a saved row, and the
 * Vercel Firewall (which only sees cardflip.io traffic) can refuse other sites' hotlinks and rate-limit bulk copying.
 *
 * The DB keeps the Blob URL (own_image_url / own_tile_url); readers pass it through toPics(). Full https URL in
 * production because card pictures get saved into inventory / watchlist rows and travel to emails, eBay and public
 * pages; a bare path in dev, where the local rewrite serves it (and prod has no copy of an unpushed change).
 */
export const PICS_STORE = "https://mlwovvakovcpakbr.public.blob.vercel-storage.com";
const STORE_CARDS = `${PICS_STORE}/cards/`;

function picsOrigin(): string {
  return process.env.NODE_ENV === "development" ? "" : SITE_URL;
}

/** Our Blob URL for a card picture → its cardflip.io/pics address. Anything else comes back unchanged. */
export function toPics(url: string): string {
  return url.startsWith(STORE_CARDS) ? `${picsOrigin()}/pics/${url.slice(STORE_CARDS.length)}` : url;
}

/**
 * A /pics address → the Blob URL behind it, for server-side fetches (picture tiebreak, social art): straight to the
 * store, no trip through our own firewall or its rate limit. Anything else comes back unchanged.
 */
export function fromPics(url: string): string {
  const m = /^(?:https?:\/\/[^/]+)?\/pics\/(.+)$/.exec(url);
  return m && !m[1].includes("..") ? `${STORE_CARDS}${m[1]}` : url;
}
