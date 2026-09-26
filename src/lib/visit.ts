/**
 * Pure helpers for the visitor ping (app/api/visit) — kept out of the route
 * file so tests can import them and Next's route-export check stays happy.
 */

const OWN_HOSTS = /(^|\.)cardflip\.io$|^localhost(:\d+)?$/i;

/** Referrer host, lowercased, "www." dropped; "" for our own pages / junk. */
export function referrerHost(ref: unknown): string {
  if (typeof ref !== "string" || !ref || ref.length > 2000) return "";
  try {
    const host = new URL(ref).hostname.toLowerCase().replace(/^www\./, "");
    if (!host || OWN_HOSTS.test(host)) return "";
    return host.slice(0, 80);
  } catch {
    return "";
  }
}

/** phone | tablet | desktop from the user agent — the UA itself is not kept. */
export function deviceClass(ua: string): "phone" | "tablet" | "desktop" {
  if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) return "tablet";
  if (/iphone|ipod|android.*mobile|windows phone|mobile/i.test(ua)) return "phone";
  return "desktop";
}
