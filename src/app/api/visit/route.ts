import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { deviceClass, referrerHost } from "@/lib/visit";

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
 */
export const dynamic = "force-dynamic";

const SKIP = /^\/(admin|api)(\/|$)/;

function clientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  return (xff?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "").trim();
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as {
      path?: unknown;
      ref?: unknown;
    } | null;
    let path = typeof body?.path === "string" ? body.path : "";
    if (!path.startsWith("/") || path.length > 200 || SKIP.test(path))
      return new NextResponse(null, { status: 204 });
    path = path.split("?")[0].replace(/\/+$/, "") || "/";
    const ua = req.headers.get("user-agent") ?? "";
    if (!ua || /bot|crawl|spider|preview|lighthouse|headless/i.test(ua))
      return new NextResponse(null, { status: 204 });
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const salt =
      process.env.VISIT_SALT ?? process.env.CRON_SECRET ?? "cardflip";
    const visitor = createHash("sha256")
      .update(`${day}|${clientIp(req)}|${ua}|${salt}`)
      .digest("hex")
      .slice(0, 32);
    const country = (req.headers.get("x-vercel-ip-country") ?? "").toUpperCase().slice(0, 2);
    await db
      .prepare(
        "INSERT OR IGNORE INTO page_views (day, visitor, path, at, ref, device, country) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(day, visitor, path, now, referrerHost(body?.ref), deviceClass(ua), country);
  } catch {
    // Counting is best-effort.
  }
  return new NextResponse(null, { status: 204 });
}
