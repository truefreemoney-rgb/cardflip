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
import {
  LIMITS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/server/rateLimit";

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

    const card = await analyzeCardImage(image, mediaType, language, parseGame(body?.game));
    return NextResponse.json({ status: "done", card });
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
