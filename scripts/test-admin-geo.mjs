// Admin geofence (src/proxy.ts): US only on Vercel, everything allowed off it.
//   npm run test:admingeo
import path from "node:path";
import { pathToFileURL } from "node:url";

const at = (p) => pathToFileURL(path.join(process.cwd(), "src", p)).href;
let failed = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n         got      ${JSON.stringify(got)}\n         expected ${JSON.stringify(want)}`}`);
  if (!ok) failed += 1;
}

process.env.VERCEL = "1";
const { NextRequest } = await import("next/server");
const { proxy, adminCountryAllowed } = await import(at("proxy.ts"));
const hit = (url, country) => proxy(new NextRequest(new URL(url, "https://cardflip.io"), { headers: country ? { "x-vercel-ip-country": country } : {} }));

check("US visitor reaches /admin", hit("/admin", "US").status, 200);
check("US visitor reaches /api/admin/board", hit("/api/admin/board", "us").status, 200);
check("DE visitor gets 404 on /admin/board", hit("/admin/board", "DE").status, 404);
check("RU visitor gets 403 on /api/admin/board", hit("/api/admin/board", "RU").status, 403);
check("no country on Vercel is refused", hit("/admin", null).status, 404);
delete process.env.VERCEL;
check("no country off Vercel (dev, tests) is allowed", adminCountryAllowed(null), true);
check("country list is case-insensitive", adminCountryAllowed("Us"), true);

// Site-wide country block (default IN): every page + API, except provider callbacks.
process.env.VERCEL = "1";
const { countryBlocked } = await import(at("proxy.ts"));
check("IN visitor gets 403 on the homepage", hit("/", "IN").status, 403);
check("IN visitor gets 403 on /app/scan", hit("/app/scan", "in").status, 403);
check("IN visitor gets 403 JSON on /api/cards", hit("/api/cards?q=x", "IN").status, 403);
check("IN never reaches /admin (403, not 404)", hit("/admin", "IN").status, 403);
check("Stripe webhook is exempt from the block", hit("/api/stripe/webhook", "IN").status, 200);
check("eBay account-deletion is exempt", hit("/api/ebay/account-deletion", "IN").status, 200);
check("cron routes are exempt", hit("/api/cron/pokemon-prices", "IN").status, 200);
check("US visitor reaches the homepage", hit("/", "US").status, 200);
check("DE visitor reaches the homepage (only admin is US-only)", hit("/", "DE").status, 200);
check("no country header is not blocked", countryBlocked(null, "/"), false);
delete process.env.VERCEL;

console.log(failed ? `\n${failed} admin-geo check(s) failed` : "\nAll admin-geo checks passed");
process.exit(failed ? 1 : 0);
