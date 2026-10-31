import { NextResponse } from "next/server";
import {
  VISION_MODEL,
  VisionNotConfiguredError,
  analyzeCardImageWithUsage,
  isVisionConfigured,
} from "@/lib/server/vision";
import { recordScanUsage } from "@/lib/server/scanUsage";
import { scanLogRead } from "@/lib/server/scanLogRead";
import { isBudgetError } from "@/lib/visionBudget";
import { parseGame } from "@/lib/games";
import { gameFeaturesFor } from "@/lib/server/settings";
import { dayBudgetSpent } from "@/lib/server/dayBudget";
import { clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondAsync } from "@/lib/server/rateLimitDb";
import { DEVICE_COOKIE, DEVICE_COOKIE_MAX_AGE, deviceIdFrom, hashIp, newDeviceId } from "@/lib/server/signupGuard";
import { forgetTrialScan, recordTrialScan, trialScanUsedUp } from "@/lib/server/trialScan";
import { readImageInput } from "@/lib/server/imageInput";
import { isAppleIp } from "@/lib/appleNetwork";
import { BLURRY_MESSAGE, photoSoftness, tooSoft } from "@/lib/server/photoSoftness";
import { prefetchMatch } from "@/lib/server/scanPrefetch";

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
/** scan_usage rows for these reads, so the expenses page counts them. */
const TRIAL_USER = "trial-scan";

export const maxDuration = 60;

export async function POST(req: Request) {
  const startedAt = Date.now();
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
    // App Review (Apple's own network, lib/appleNetwork.ts): reviewers share addresses and test devices, and the review
    // notes promise the free first scan, so only the site-wide day budget applies to them (10-31).
    const reviewer = isAppleIp(ip);
    const limited = reviewer ? null : await limitOrRespondAsync(`trialscan:${ip}`, [{ limit: 6, windowMs: 10 * 60 * 1000 }]);
    if (limited) return limited;
    if (!isVisionConfigured()) return send({ status: "unconfigured", card: null });

    const body = await req.json().catch(() => null);
    // A real picture or a 400 before the free scan is spent (#33: lib/server/imageInput.ts).
    const input = readImageInput(body?.image);
    if (!input.ok) return send({ error: input.error }, input.status);
    const { image, mediaType } = input;

    // Too soft to read the number: the retake message, no vision call, the free scan not spent (lib/server/photoSoftness.ts).
    const soft = await photoSoftness(image);
    if (soft && tooSoft(soft)) {
      console.info(`trial scan: refused blurry photo (text ${soft.text}, number ${soft.number})`);
      return send({ status: "error", reason: "blurry", error: BLURRY_MESSAGE }, 422);
    }

    const ipHash = reviewer ? null : hashIp(ip);
    if (!reviewer && (await trialScanUsedUp(deviceId, ipHash))) return send({ status: "used", card: null }, 402);
    if (await dayBudgetSpent("trial_scan", TRIAL_DAILY_BUDGET)) return send({ status: "busy", card: null }, 429);
    const triedAt = Date.now();
    await recordTrialScan(deviceId, ipHash, triedAt);

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
    // A slab or a pack/box gets "coming soon" on the page and does not use up a free try (Chris 10-31).
    if (card.slab === true || card.kind === "sealed") {
      await forgetTrialScan(deviceId, triedAt).catch((err) => console.error("trial give-back failed:", err instanceof Error ? err.message : err));
    }
    // The same compact read as the app's scans (lib/server/scanLogRead.ts): a missed free scan replays with its set code,
    // art and, for Pokémon, the pattern + ball read (10-21: trial rows had name/number/conf only).
    await recordScanUsage(TRIAL_USER, VISION_MODEL, tokens, scanLogRead(card, card.game ?? game, { pre: visionAt - startedAt, ms: Date.now() - visionAt, ...(soft ? { soft: [soft.text, soft.number] as [number, number] } : {}) })).catch((err) => console.error("trial scan_usage write failed:", err instanceof Error ? err.message : err));
    // One trip (#B, 10-30): the catalog search for this read, run here; the ad page may use it or search itself.
    const prefetch = Date.now() - startedAt < 6_000 ? await prefetchMatch(req, card, card.game ?? game, "en") : null;
    return send({ status: "done", card, ...(prefetch ? { prefetch } : {}) });
  } catch (err) {
    if (err instanceof VisionNotConfiguredError) return send({ status: "unconfigured", card: null });
    console.error("Trial scan failed:", err);
    return send({ status: "error", card: null }, 502);
  }
}
