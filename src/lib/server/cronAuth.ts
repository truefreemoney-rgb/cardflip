import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { presentedKey, secretEqual } from "@/lib/server/secretEqual";

/**
 * Shared gate for the /api/cron/* routes: `Authorization: Bearer CRON_SECRET`
 * only (Vercel Cron sends it automatically when the CRON_SECRET env var
 * exists; the old ?key= query was dropped 10-14). Returns the error response to send, or null to proceed.
 */
export function cronAuthError(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  if (!secretEqual(presentedKey(req), secret)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}
