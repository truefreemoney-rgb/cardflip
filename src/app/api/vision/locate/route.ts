import { NextResponse } from "next/server";
import { requireUser, AuthError, subscriptionGate } from "@/lib/server/auth";
import { VISION_MODEL, VisionNotConfiguredError, isVisionConfigured, locateCards } from "@/lib/server/vision";
import { recordScanUsage } from "@/lib/server/scanUsage";
import { dayBudgetSpent } from "@/lib/server/dayBudget";
import { outOfScansMessage, scanQuota, scanQuotaExhausted } from "@/lib/server/scanQuota";
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

/**
 * Durable per-account daily cap (a db counter; the in-memory limiter never binds
 * on serverless). Locating is a paid call that is not itself a scan (each card
 * on the page is counted when it is read), so without a cap of its own it would
 * cost money that no scan pays for. A page holds 9-12 cards, so 100 pages a day
 * is far above the 500-scan daily budget it feeds.
 */
const LOCATE_DAILY_BUDGET = 100;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const wall = subscriptionGate(user);
    if (wall) return wall;
    enforceRateLimit(`vision:${user.id}`, ...LIMITS.visionScan);
    if (!isVisionConfigured()) return NextResponse.json({ status: "unconfigured", cards: [] });

    if (scanQuotaExhausted(user)) {
      return NextResponse.json(
        { error: outOfScansMessage(user), quota: true, usage: scanQuota(user) },
        { status: 402 },
      );
    }

    const body = await req.json().catch(() => null);
    const image = body?.image as string | undefined;
    const mediaType = (body?.mediaType as string | undefined) ?? "image/jpeg";
    if (!image) return NextResponse.json({ error: "Missing image" }, { status: 400 });
    if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) return NextResponse.json({ error: "Image too large" }, { status: 413 });

    if (await dayBudgetSpent(`locate_${user.id}`, LOCATE_DAILY_BUDGET)) {
      return NextResponse.json({ error: "Today's page budget is used up — try again tomorrow", retryAfterSeconds: 3600 }, { status: 429, headers: { "Retry-After": "3600" } });
    }

    const result = await locateCards(image, mediaType);
    const cards = cleanBoxes(result.cards);
    const px = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);
    await recordScanUsage(user.id, VISION_MODEL, result.usage, { locate: true, found: cards.length, w: px(body?.width), h: px(body?.height) }).catch((err) =>
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
