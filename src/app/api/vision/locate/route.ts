import { NextResponse } from "next/server";
import { requireUser, AuthError, subscriptionGate } from "@/lib/server/auth";
import { VISION_MODEL, VisionNotConfiguredError, isVisionConfigured, locateCards } from "@/lib/server/vision";
import { recordScanUsage } from "@/lib/server/scanUsage";
import { scanQuota, scanQuotaExhausted } from "@/lib/server/scanQuota";
import { LIMITS, RateLimitError, enforceRateLimit, rateLimitResponse } from "@/lib/server/rateLimit";
import { cleanBoxes } from "@/lib/binder";

/**
 * Binder-page scan, step one: find every card in one photo. Answers the
 * boxes (fractions of the image) plus the seller's current allowance so the
 * browser can crop each card and queue it through /api/vision/scan — that
 * is where each card is counted. This call is not a scan on the allowance;
 * it is refused at zero remaining so a page is never located that cannot
 * then be read. Same gates and burst limit as the scan route; billed on the
 * token ledger.
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
    if (!isVisionConfigured()) return NextResponse.json({ status: "unconfigured", cards: [] });

    if (scanQuotaExhausted(user)) {
      return NextResponse.json(
        { error: "You're out of scans — each card on the page is one scan", quota: true, usage: scanQuota(user) },
        { status: 402 },
      );
    }

    const body = await req.json().catch(() => null);
    const image = body?.image as string | undefined;
    const mediaType = (body?.mediaType as string | undefined) ?? "image/jpeg";
    if (!image) return NextResponse.json({ error: "Missing image" }, { status: 400 });
    if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Image too large" }, { status: 413 });

    const result = await locateCards(image, mediaType);
    const cards = cleanBoxes(result.cards);
    await recordScanUsage(user.id, VISION_MODEL, result.usage, { locate: true, found: cards.length }).catch((err) =>
      console.error("scan_usage write failed:", err instanceof Error ? err.message : err),
    );
    return NextResponse.json({ status: "done", cards, usage: scanQuota(user) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    if (err instanceof VisionNotConfiguredError) return NextResponse.json({ status: "unconfigured", cards: [] });
    console.error("locate failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ status: "error", cards: [] }, { status: 502 });
  }
}
