import { NextResponse, type NextRequest } from "next/server";

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

export function proxy(req: NextRequest) {
  const country = req.headers.get("x-vercel-ip-country");
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  if (countryBlocked(country, pathname)) {
    return isApi
      ? NextResponse.json({ error: "Not available from your region." }, { status: 403 })
      : new NextResponse("Not available in your region.", { status: 403, headers: { "content-type": "text/plain" } });
  }
  if (!isAdminPath(pathname) || adminCountryAllowed(country)) return NextResponse.next();
  return isApi
    ? NextResponse.json({ error: "Not available from your region." }, { status: 403 })
    : new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain" } });
}

export const config = {
  // Everything except Next's static assets; the proxy is a header check, cheap on every request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|brand/).*)"],
};
