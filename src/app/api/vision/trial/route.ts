import { NextResponse } from "next/server";
import {
  VISION_MODEL,
  VisionNotConfiguredError,
  analyzeCardImageWithUsage,
  isVisionConfigured,
} from "@/lib/server/vision";
import { recordScanUsage } from "@/lib/server/scanUsage";
import { isBudgetError } from "@/lib/visionBudget";
import { parseGame } from "@/lib/games";
import { gameFeaturesFor } from "@/lib/server/settings";
import { dayBudgetSpent } from "@/lib/server/dayBudget";
import { clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, deviceIdFrom, hashIp, newDeviceId } from "@/lib/server/signupGuard";
import { recordTrialScan, trialScanUsedUp } from "@/lib/server/trialScan";

/**
 * The ad landing page's free scan (10-05, /scan): one card read with no
 * account. Same read as /api/vision/scan, behind its own gates instead of a
 * login: a few tries per device (the cf_dev cookie the signup reuses) and per
 * network, a per-IP burst limit, and a site-wide daily budget. Matching and
 * pricing run in the page against the public /api/search-card, as in the app.
 * About $0.011 a read (scan_usage, 09-02), so the daily budget caps the worst
 * day at ~$3.30.
 */
const TRIAL_DAILY_BUDGET = 300;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** scan_usage rows for these reads, so the expenses page counts them. */
const TRIAL_USER = "trial-scan";

export const maxDuration = 60;

export async function POST(req: Request) {
  const fresh = deviceIdFrom(req) === null;
  const deviceId = deviceIdFrom(req) ?? newDeviceId();
  const send = (body: unknown, status = 200) => {
    const res = NextResponse.json(body, { status });
    if (fresh) {
      res.cookies.set(DEVICE_COOKIE, deviceId, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: DEVICE_COOKIE_MAX_AGE,
      });
    }
    return res;
  };

  try {
    const ip = clientIp(req);
    const limited = await limitOrRespondAsync(`trialscan:${ip}`, [{ limit: 6, windowMs: 10 * 60 * 1000 }]);
    if (limited) return limited;
    if (!isVisionConfigured()) return send({ status: "unconfigured", card: null });

    const body = await req.json().catch(() => null);
    const image = body?.image as string | undefined;
    const mediaType = (body?.mediaType as string | undefined) ?? "image/jpeg";
    if (!image) return send({ error: "Missing image" }, 400);
    if ((image.length * 3) / 4 > MAX_IMAGE_BYTES) return send({ error: "Image too large" }, 413);

    const ipHash = hashIp(ip);
    if (await trialScanUsedUp(deviceId, ipHash)) return send({ status: "used", card: null }, 402);
    if (await dayBudgetSpent("trial_scan", TRIAL_DAILY_BUDGET)) return send({ status: "busy", card: null }, 429);
    await recordTrialScan(deviceId, ipHash);

    // Only games open to everyone may take over a scan.
    const features: Record<string, boolean> = { pokemon: true, ...(await gameFeaturesFor(null)) };
    const game = parseGame(body?.game);
    const visionAt = Date.now();
    let scanned;
    try {
      scanned = await analyzeCardImageWithUsage(image, mediaType, "en", game, false, (g) => features[g] === true, visionAt);
    } catch (err) {
      if (isBudgetError(err)) {
        console.warn(`trial scan: read ran out of time after ${Date.now() - visionAt} ms`);
        return send({ status: "error", reason: "timeout" }, 504);
      }
      throw err;
    }
    const { read: card, usage: tokens } = scanned;
    await recordScanUsage(TRIAL_USER, VISION_MODEL, tokens, {
      game: card.game ?? game,
      name: card.name,
      number: card.cardNumber,
      conf: card.confidence,
      ms: Date.now() - visionAt,
    }).catch((err) => console.error("trial scan_usage write failed:", err instanceof Error ? err.message : err));
    return send({ status: "done", card });
  } catch (err) {
    if (err instanceof VisionNotConfiguredError) return send({ status: "unconfigured", card: null });
    console.error("Trial scan failed:", err);
    return send({ status: "error", card: null }, 502);
  }
}
