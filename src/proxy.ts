import { NextResponse, type NextRequest } from "next/server";
import { SITE_URL } from "@/lib/siteUrl";
import { shortLinkTarget } from "@/lib/attribution";
import { allowedCountries, isAllowedCountry } from "@/lib/countries";
import { HOME_COOKIE, SESSION_COOKIE_NAME, homeCookieConfigured, readHomeCookie } from "@/lib/homeCookie";

/**
 * Two geofences, both keyed on x-vercel-ip-country (Vercel stamps every
 * request with the connecting IP's country; no header = not on Vercel =
 * dev server, tests = allowed, so nothing here changes local work).
 *
 * 1. SITE BLOCK (Chris, 09-25: "block all traffic from India"): visitors
 *    from BLOCKED_COUNTRIES (comma-separated ISO codes, default IN) get a
 *    plain 403 on every page and API route. Machine-to-machine routes that
 *    other services call (Stripe webhook, eBay callbacks, cron) are exempt
 *    so a provider's edge in a blocked country cannot break billing.
 *
 * 2. ADMIN GEOFENCE (Chris, 09-10: "only american ISPs can connect to the
 *    admin"): anything outside ADMIN_COUNTRIES (default US) gets a 404 on
 *    /admin pages and a 403 on /api/admin — before the page or the password
 *    prompt exists for them.
 *
 * 3. COUNTRY GATE: see countryGatePasses below.
 */
const list = (env: string | undefined, fallback: string) =>
  new Set(
    (env ?? fallback)
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean),
  );
const ALLOWED = list(process.env.ADMIN_COUNTRIES, "US");
const BLOCKED = list(process.env.BLOCKED_COUNTRIES, "IN");

/** Routes other services call; never country-blocked. */
const EXEMPT_PREFIXES = ["/api/cron/", "/api/stripe/webhook", "/api/ebay/account-deletion", "/api/ebay/callback"];

export function adminCountryAllowed(country: string | null | undefined): boolean {
  if (!country) return !process.env.VERCEL; // off-Vercel only
  return ALLOWED.has(country.toUpperCase());
}

export function countryBlocked(country: string | null | undefined, pathname: string): boolean {
  if (!country) return false;
  if (!BLOCKED.has(country.toUpperCase())) return false;
  return !EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
}

const isAdminPath = (pathname: string) =>
  pathname === "/admin" || pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/");

/**
 * www.cardflip.io served the whole site (200) next to cardflip.io, so every page
 * existed at two addresses (SEO sweep 09-30). The www host sends a 308 to the
 * apex with the path and query kept; null = this request is not on www.
 */
export function wwwRedirectUrl(host: string | null, pathname: string, search: string): string | null {
  const apex = new URL(SITE_URL);
  const bare = (host ?? "").toLowerCase().replace(/:\d+$/, "");
  return bare === `www.${apex.hostname}` ? `${apex.origin}${pathname}${search}` : null;
}

export function proxy(req: NextRequest) {
  const country = req.headers.get("x-vercel-ip-country");
  const { pathname } = req.nextUrl;
  const www = wwwRedirectUrl(req.headers.get("host"), pathname, req.nextUrl.search);
  if (www) return NextResponse.redirect(www, 308);
  const isApi = pathname.startsWith("/api/");
  if (countryBlocked(country, pathname)) {
    return isApi
      ? NextResponse.json({ error: "Not available from your region." }, { status: 403 })
      : new NextResponse("Not available in your region.", { status: 403, headers: { "content-type": "text/plain" } });
  }
  // Tracked short links from social posts: cardflip.io/x/mtg-movers-0930 -> /?utm_source=x&... (lib/attribution.ts).
  const tracked = shortLinkTarget(pathname);
  if (tracked) return NextResponse.redirect(new URL(tracked, req.url), 302);
  if (isAdminPath(pathname) && !adminCountryAllowed(country)) {
    return isApi
      ? NextResponse.json({ error: "Not available from your region." }, { status: 403 })
      : new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }
  if (countryGatePasses(req, country, pathname)) return NextResponse.next();
  return isApi
    ? NextResponse.json({ error: "CardFlip isn't available in your country yet.", unavailable: true }, { status: 403 })
    : NextResponse.rewrite(new URL("/unavailable", req.url));
}

/**
 * 3. COUNTRY GATE (Chris 09-30): the site is open in US, CA, GB, IE, AU, NZ
 *    (lib/countries.ts; ALLOWED_COUNTRIES="*" turns it off). Everyone else
 *    sees /unavailable (the waitlist screen) and gets 403 from /api — unless
 *    they carry a cf_home travel pass (lib/homeCookie.ts): an account created
 *    in an open country, bound to the login cookie sent with it. No DB call.
 *    The proxy never sets cookies: a Set-Cookie would stop the CDN caching
 *    /cards pages.
 */
const OPEN = allowedCountries();

/** Machine callers, the waitlist screen itself, and the way back in for travellers. */
const GATE_EXEMPT_PREFIXES = [
  ...EXEMPT_PREFIXES,
  "/api/social/", // publish cron (vercel.json + GitHub Actions) and OAuth callbacks
  "/api/ops/", // GitHub Actions alerts
  "/api/runner/", // board runner
  "/api/digest/unsubscribe", // emailed links get opened abroad
  "/api/waitlist",
  "/api/geo",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/logout",
  "/api/auth/forgot",
  "/api/auth/reset",
  "/api/auth/confirm-email",
  "/api/auth/verify-email",
  "/sitemaps/",
  "/opengraph-image",
  "/icon",
  "/apple-icon",
];
const GATE_EXEMPT_PAGES = new Set([
  "/unavailable",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/confirm-email",
  "/privacy",
  "/terms",
  "/robots.txt",
  "/sitemap.xml",
  "/sw.js",
  "/manifest.webmanifest",
]);
/** Search engines and link previews crawl from anywhere; a foreign crawl must never index the waitlist screen on a card URL. */
const CRAWLER_UA = /Googlebot|Google-InspectionTool|AdsBot-Google|bingbot|DuckDuckBot|Applebot|YandexBot|facebookexternalhit|Twitterbot|Slackbot|LinkedInBot|Discordbot|Pinterestbot|Bluesky/i;

export function countryGateExempt(pathname: string): boolean {
  return (
    GATE_EXEMPT_PAGES.has(pathname) ||
    GATE_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p)) ||
    /^\/(google[0-9a-f]+\.html|tiktok[A-Za-z0-9]+\.txt)$/.test(pathname)
  );
}

export function countryGatePasses(req: NextRequest, country: string | null, pathname: string): boolean {
  if (!country || OPEN === "*" || isAllowedCountry(country, OPEN)) return true;
  if (countryGateExempt(pathname)) return true;
  // No signing key = no way to honour travel passes; stay open rather than lock members out.
  if (!homeCookieConfigured()) return true;
  const isApi = pathname.startsWith("/api/");
  if (!isApi && req.method === "GET" && CRAWLER_UA.test(req.headers.get("user-agent") ?? "")) return true;
  const claim = readHomeCookie(req.cookies.get(HOME_COOKIE)?.value, req.cookies.get(SESSION_COOKIE_NAME)?.value);
  return Boolean(claim && (claim.home === null || isAllowedCountry(claim.home, OPEN)));
}

export const config = {
  // Everything except Next's static assets; the proxy is a header check, cheap on every request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|brand/).*)"],
};
