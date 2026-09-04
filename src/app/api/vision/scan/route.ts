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
import { recordScan, scanQuota, scanQuotaExhausted } from "@/lib/server/scanQuota";
import { isSubscribed } from "@/lib/server/users";
import { dayBudgetSpent } from "@/lib/server/dayBudget";
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

    // 500 (Pro: 2,000) scans a month per subscriber; 10 lifetime on the free trial.
    if (scanQuotaExhausted(user)) {
      return NextResponse.json(
        {
          error: isSubscribed(user)
            ? `You've used all ${scanQuota(user).included.toLocaleString("en-US")} scans this month — your allowance resets at the start of next month`
            : "Your 10 free scans are used — subscribe to keep scanning",
          quota: true,
          usage: scanQuota(user),
        },
        { status: 402 },
      );
    }

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

    const { read: card, usage: tokens } = await analyzeCardImageWithUsage(
      image,
      mediaType,
      language,
      parseGame(body?.game),
    );
    // Metered for everyone (launch pricing needs the data), enforced above
    // for subscribers only. After the call — a failed scan shouldn't count.
    // The token bill is written alongside; a ledger failure must never fail
    // a scan the seller already paid for.
    const [usage] = await Promise.all([
      recordScan(user),
      recordScanUsage(user.id, VISION_MODEL, tokens, {
        game: parseGame(body?.game),
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
