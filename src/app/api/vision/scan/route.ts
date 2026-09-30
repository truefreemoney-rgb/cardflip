import { NextResponse } from "next/server";
import { requireUser, AuthError, subscriptionGate } from "@/lib/server/auth";
import {
  VISION_MODEL,
  VisionNotConfiguredError,
  analyzeCardImageWithUsage,
  isVisionConfigured,
} from "@/lib/server/vision";
import { recordScanUsage } from "@/lib/server/scanUsage";
import type { ScanLanguage } from "@/lib/types";
import { parseGame } from "@/lib/games";
import { gameFeaturesFor } from "@/lib/server/settings";
import { giveBackScans, outOfScansMessage, reserveScan, scanQuota, scanQuotaExhausted } from "@/lib/server/scanQuota";
import { scanTier, type ScanQuota, type User } from "@/lib/server/users";
import { dayBudgetSpent } from "@/lib/server/dayBudget";
import { etTime } from "@/lib/time";
import {
  LIMITS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/server/rateLimit";

/**
 * Durable daily caps (db counters — the in-memory windows in rateLimit.ts
 * never bind on serverless, the PSA-leak lesson). Same numbers the in-memory
 * daily rules carried; those stay as warm-instance burst guards per minute.
 */
const SCAN_DAILY_BUDGET = 500;

/** Photos arrive downscaled by the client; this is a backstop, not the budget. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The 402 for an empty balance. The legacy day is a UTC day (users.ts quotaDay); its message says when it rolls over in Eastern (site-wide ET, 09-30). */
function outOfScans(user: User, usage: ScanQuota) {
  const nextUtcMidnight = (Math.floor(Date.now() / 86_400_000) + 1) * 86_400_000;
  return NextResponse.json(
    {
      error:
        scanTier(user) === "legacy"
          ? `You've used today's 100 scans — the counter resets at ${etTime(nextUtcMidnight)}, or subscribe for more scans`
          : outOfScansMessage(user, usage),
      quota: true,
      usage,
    },
    { status: 402 },
  );
}

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const wall = subscriptionGate(user);
    if (wall) return wall;
    // Every call here costs money at Anthropic — per-account burst + daily caps.
    enforceRateLimit(`vision:${user.id}`, ...LIMITS.visionScan);

    if (!isVisionConfigured()) {
      return NextResponse.json({ status: "unconfigured", card: null });
    }

    // A subscriber's balance (each payment adds the plan's scans, unused scans stack); the trial allowance lifetime; a Scan Pack balance until it is gone.
    // Fast answer from the row already in hand; the reservation below is the real, atomic check.
    if (scanQuotaExhausted(user)) return outOfScans(user, scanQuota(user));

    const body = await req.json().catch(() => null);
    const image = body?.image as string | undefined;
    const mediaType = (body?.mediaType as string | undefined) ?? "image/jpeg";
    const language: ScanLanguage =
      body?.language === "ja" || body?.language === "zh" ? body.language : "en";

    if (!image) {
      return NextResponse.json({ error: "Missing image" }, { status: 400 });
    }
    // base64 inflates by ~4/3, so compare against the decoded size.
    if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image too large" }, { status: 413 });
    }

    // Last gate before spending money — a well-formed request that clears the
    // burst limiter still has to fit the durable daily budget.
    const overBudget = await dayBudgetSpent(`scan_${user.id}`, SCAN_DAILY_BUDGET);
    if (overBudget) {
      return NextResponse.json(
        { error: "Today's scan budget is used up — try again tomorrow", retryAfterSeconds: 3600 },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }

    // Only games this seller can see may take over a scan (gated games stay admin-only).
    const features: Record<string, boolean> = { pokemon: true, ...(await gameFeaturesFor(user)) };
    // The scan is taken BEFORE the paid call (an atomic, guarded take: two
    // photos in flight can never spend the same last scan, and none is lost
    // to a stale read) and given back if the read fails: a failed scan
    // shouldn't count. Metered for everyone (launch pricing needs the data).
    const reservation = await reserveScan(user);
    if (reservation.taken < 1) return outOfScans(user, reservation.usage);
    let scanned;
    try {
      scanned = await analyzeCardImageWithUsage(
        image,
        mediaType,
        language,
        parseGame(body?.game),
        body?.pocket === true,
        (g) => features[g] === true,
      );
    } catch (err) {
      await giveBackScans(user, reservation).catch((e) =>
        console.error("scan give-back failed:", e instanceof Error ? e.message : e),
      );
      throw err;
    }
    const { read: card, usage: tokens } = scanned;
    // The token bill is written alongside; a ledger failure must never fail
    // a scan the seller already paid for.
    const [usage] = await Promise.all([
      Promise.resolve(reservation.usage),
      recordScanUsage(user.id, VISION_MODEL, tokens, {
        game: card.game ?? parseGame(body?.game),
        ...(card.switchedFrom ? { from: card.switchedFrom } : {}),
        // Stored so the second-look rate can be MEASURED next time, not inferred from token counts.
        ...(card.secondLook ? { second: card.secondLook } : {}),
        name: card.name,
        number: card.cardNumber,
        total: card.setTotal,
        code: card.setCode,
        art: card.artStyle,
        kind: card.kind ?? null,
        conf: card.confidence,
      }).catch((err) =>
        console.error("scan_usage write failed:", err instanceof Error ? err.message : err),
      ),
    ]);
    return NextResponse.json({ status: "done", card, usage });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    if (err instanceof VisionNotConfiguredError) {
      return NextResponse.json({ status: "unconfigured", card: null });
    }
    // A vision failure shouldn't sink the scan — the caller falls back to OCR.
    console.error("Vision scan failed:", err);
    return NextResponse.json({ status: "error", card: null }, { status: 502 });
  }
}
