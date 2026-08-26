import "server-only";
import { NextRequest, NextResponse } from "next/server";

/**
 * Shared gate for the /api/cron/* routes. Accepts either `?key=CRON_SECRET`
 * (manual pinger, cron-job.org) or `Authorization: Bearer CRON_SECRET` —
 * Vercel Cron sends the Bearer header automatically when the CRON_SECRET
 * env var exists. Returns the error response to send, or null to proceed.
 */
export function cronAuthError(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  const key = req.nextUrl.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (key !== secret) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
