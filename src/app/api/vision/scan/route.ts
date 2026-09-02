import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import {
  VisionNotConfiguredError,
  analyzeCardImage,
  isVisionConfigured,
} from "@/lib/server/vision";
import type { ScanLanguage } from "@/lib/types";
import { parseGame } from "@/lib/games";
import { isDemoUser } from "@/lib/server/users";
import { recordScan, scanQuota, scanQuotaExhausted } from "@/lib/server/scanQuota";
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
 * Demo is one shared public account, so its cap is effectively global.
 */
const SCAN_DAILY_BUDGET = 500;
const SCAN_DEMO_DAILY_BUDGET = 60;

/** Photos arrive downscaled by the client; this is a backstop, not the budget. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const user = await requireUser();
    // Every call here costs money at Anthropic — per-account burst + daily
    // caps, tighter for the shared demo login anyone can use.
    enforceRateLimit(
      `vision:${user.id}`,
      ...(isDemoUser(user) ? LIMITS.visionScanDemo : LIMITS.visionScan),
    );

    if (!isVisionConfigured()) {
      return NextResponse.json({ status: "unconfigured", card: null });
    }

    // Subscribers get 500 scans a month plus any purchased packs; free early
    // access stays ungated (the rate limits above still bound it).
    if (scanQuotaExhausted(user)) {
      return NextResponse.json(
        {
          error: "You've used all 500 scans this month — your allowance resets when the subscription renews",
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
    const demo = isDemoUser(user);
    const overBudget = await dayBudgetSpent(
      demo ? "scan_demo" : `scan_${user.id}`,
      demo ? SCAN_DEMO_DAILY_BUDGET : SCAN_DAILY_BUDGET,
    );
    if (overBudget) {
      return NextResponse.json(
        { error: "Today's scan budget is used up — try again tomorrow", retryAfterSeconds: 3600 },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }

    const card = await analyzeCardImage(image, mediaType, language, parseGame(body?.game));
    // Metered for everyone (launch pricing needs the data), enforced above
    // for subscribers only. After the call — a failed scan shouldn't count.
    const usage = await recordScan(user);
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
