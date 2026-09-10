import { NextResponse, type NextRequest } from "next/server";

/**
 * Admin console geofence (Chris, 09-10: "only american ISPs can connect to
 * the admin"). Vercel stamps every request with the visitor's country
 * (x-vercel-ip-country, from the connecting IP); anything outside the
 * allowed list gets a 404 on /admin pages and a 403 on /api/admin — before
 * the page or the password prompt exists for them.
 *
 * ADMIN_COUNTRIES (comma-separated ISO codes) widens the list; default US.
 * No header = not on Vercel (dev server, tests) = allowed, so nothing here
 * changes local work. Cron routes live under /api/cron and are untouched.
 */
const ALLOWED = new Set(
  (process.env.ADMIN_COUNTRIES ?? "US")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
);

export function adminCountryAllowed(country: string | null | undefined): boolean {
  if (!country) return !process.env.VERCEL; // off-Vercel only
  return ALLOWED.has(country.toUpperCase());
}

export function proxy(req: NextRequest) {
  const country = req.headers.get("x-vercel-ip-country");
  if (adminCountryAllowed(country)) return NextResponse.next();
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  return isApi
    ? NextResponse.json({ error: "Not available from your region." }, { status: 403 })
    : new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain" } });
}

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/admin/:path*"],
};
