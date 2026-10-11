import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { giveBackNoMatchScan } from "@/lib/server/scanGiveback";
import { LIMITS, RateLimitError, enforceRateLimit, rateLimitResponse } from "@/lib/server/rateLimit";

/**
 * POST { scanId }: the scanner found no card for this scan, give the scan
 * back (Chris, 10-11: "if a card can't be found, then it doesn't count as a
 * scan"). The server re-checks the stored read against the catalog before
 * paying out; see lib/server/scanGiveback.ts for the rules.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    enforceRateLimit(`vision:giveback:${user.id}`, ...LIMITS.visionScan);
    const body = (await req.json().catch(() => null)) as { scanId?: unknown } | null;
    const scanId = typeof body?.scanId === "string" ? body.scanId.trim() : "";
    if (!scanId || scanId.length > 64) return NextResponse.json({ error: "Missing scanId" }, { status: 400 });
    const result = await giveBackNoMatchScan(user, scanId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    console.error("scan give-back failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not give the scan back" }, { status: 500 });
  }
}
