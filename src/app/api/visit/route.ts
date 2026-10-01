import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { deviceClass, referrerHost } from "@/lib/visit";
import { classifySource, clean } from "@/lib/attribution";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";

/**
 * Visitor ping for the admin console's daily-visitors tiles (09-25).
 * POST /api/visit {path, ref?} from <VisitPing/> on every public page load.
 * Stores one row per (UTC day, visitor, path); the visitor key is a hash of
 * day + IP + user agent + salt, so it changes every day and never becomes a
 * profile. No cookie, no response body. Anything odd is dropped silently:
 * this must never fail a page.
 *
 * 09-26 (Analytics tab): the row also keeps the referrer's HOST (external
 * only), a device class and the country code Vercel stamps on the request.
 * Aggregates only — the raw referrer URL, user agent and IP are not stored.
 *
 * 09-30: a page load's first ping also carries `first` and the tagged link's
 * utm_source / utm_campaign; the row keeps the classified source (src) and
 * the campaign (camp) for the admin "where visitors come from" table.
 */
export const dynamic = "force-dynamic";

const SKIP = /^\/(admin|api)(\/|$)/;
/** A path the site could serve (10-01 sweep: any 200-char string was a new row). */
const PATH_SHAPE = /^\/[A-Za-z0-9\-._~%/]{0,159}$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as {
      path?: unknown;
      ref?: unknown;
      first?: unknown;
      utm_source?: unknown;
      utm_campaign?: unknown;
    } | null;
    let path = typeof body?.path === "string" ? body.path : "";
    if (!path.startsWith("/") || path.length > 200 || SKIP.test(path))
      return new NextResponse(null, { status: 204 });
    path = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
    if (!PATH_SHAPE.test(path)) return new NextResponse(null, { status: 204 });
    const ua = req.headers.get("user-agent") ?? "";
    if (!ua || /bot|crawl|spider|preview|lighthouse|headless/i.test(ua))
      return new NextResponse(null, { status: 204 });
    // Per IP (Vercel's own header, not the spoofable first x-forwarded-for), counted in the db: an unauthenticated
    // writer with no cap was a free way to fill page_views (10-01 sweep). Over the cap the ping is dropped, silently.
    if (await limitOrRespondAsync(`visit:${clientIp(req)}`, LIMITS.visit)) return new NextResponse(null, { status: 204 });
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const salt =
      process.env.VISIT_SALT ?? process.env.CRON_SECRET ?? "cardflip";
    const visitor = createHash("sha256")
      .update(`${day}|${clientIp(req)}|${ua}|${salt}`)
      .digest("hex")
      .slice(0, 32);
    const country = (req.headers.get("x-vercel-ip-country") ?? "").toUpperCase().slice(0, 2);
    const ref = referrerHost(body?.ref);
    // Source + campaign (lib/attribution.ts) ride a page load's first ping only; later client-side pages leave them blank.
    const src = body?.first === true ? classifySource(body.utm_source, ref, ua) : "";
    const camp = body?.first === true ? clean(body.utm_campaign) : "";
    try {
      await db
        .prepare(
          "INSERT OR IGNORE INTO page_views (day, visitor, path, at, ref, device, country, src, camp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(day, visitor, path, now, ref, deviceClass(ua), country, src, camp);
    } catch {
      // A database that has not run the src/camp ALTERs yet still counts the visit.
      await db
        .prepare(
          "INSERT OR IGNORE INTO page_views (day, visitor, path, at, ref, device, country) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(day, visitor, path, now, ref, deviceClass(ua), country);
    }
  } catch {
    // Counting is best-effort.
  }
  return new NextResponse(null, { status: 204 });
}
