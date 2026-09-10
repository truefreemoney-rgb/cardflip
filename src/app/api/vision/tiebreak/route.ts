import { NextResponse } from "next/server";
import { requireUser, AuthError, subscriptionGate } from "@/lib/server/auth";
import { TIEBREAK_MODEL, VisionNotConfiguredError, isVisionConfigured, tiebreakByPicture } from "@/lib/server/vision";
import { recordScanUsage } from "@/lib/server/scanUsage";
import { parseGame } from "@/lib/games";
import { LIMITS, RateLimitError, enforceRateLimit, rateLimitResponse } from "@/lib/server/rateLimit";

/**
 * The picture tiebreak (docs/POKEMON-IDENTIFICATION.md, docs/MTG-IDENTIFICATION.md
 * §3d): the scanner found two printings within a point of each other and
 * sends the photo plus the two ids; the stronger model looks at the photo
 * and both catalog pictures and says which. Same gates as /api/vision/scan;
 * counts against the same burst limit; billed on the scan ledger as Opus.
 * Never fails the scan: any problem answers { id: null }.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const wall = subscriptionGate(user);
    if (wall) return wall;
    enforceRateLimit(`vision:${user.id}`, ...LIMITS.visionScan);
    if (!isVisionConfigured()) return NextResponse.json({ id: null, reason: "unconfigured" });

    const body = await req.json().catch(() => null);
    const image = body?.image as string | undefined;
    const mediaType = (body?.mediaType as string | undefined) ?? "image/jpeg";
    const ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 2) : [];
    if (!image || ids.length !== 2 || ids[0] === ids[1]) {
      return NextResponse.json({ error: "Need an image and two different ids" }, { status: 400 });
    }
    if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Image too large" }, { status: 413 });

    const game = parseGame(body?.game);
    const result = await tiebreakByPicture(image, mediaType, game, [ids[0], ids[1]]);
    await recordScanUsage(user.id, TIEBREAK_MODEL, result.usage, {
      game,
      tiebreak: ids,
      pick: result.pick,
      conf: result.confidence,
      reason: result.reason.slice(0, 200),
    }).catch((err) => console.error("scan_usage write failed:", err instanceof Error ? err.message : err));
    return NextResponse.json({ id: result.id, pick: result.pick, confidence: result.confidence, reason: result.reason });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    if (err instanceof VisionNotConfiguredError) return NextResponse.json({ id: null, reason: "unconfigured" });
    console.error("tiebreak failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ id: null, reason: "failed" });
  }
}
