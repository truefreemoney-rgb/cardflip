import { NextResponse } from "next/server";
import { requireUser, AuthError, subscriptionGate } from "@/lib/server/auth";
import {
  VISION_MODEL,
  VisionNotConfiguredError,
  analyzeCardImageWithUsage,
  isVisionConfigured,
} from "@/lib/server/vision";
import { recordScanUsage } from "@/lib/server/scanUsage";
import { scanLogRead } from "@/lib/server/scanLogRead";
import { SCAN_BUDGET_MS, isBudgetError } from "@/lib/visionBudget";
import type { ScanLanguage } from "@/lib/types";
import { parseGame } from "@/lib/games";
import { giveBackScans, outOfScansMessage, reserveScan, scanQuota, scanQuotaExhausted } from "@/lib/server/scanQuota";
import type { ScanQuota, User } from "@/lib/server/users";
import { dayBudgetSpent, dayBump, readsKey } from "@/lib/server/dayBudget";
import { readIsEmpty } from "@/lib/server/scanGiveback";
import { readImageInput } from "@/lib/server/imageInput";
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

/** The 402 for an empty balance (the message names the next credit date, a Booster or the legacy reset: scanQuota.ts). */
function outOfScans(user: User, usage: ScanQuota) {
  return NextResponse.json({ error: outOfScansMessage(user, usage), quota: true, usage }, { status: 402 });
}

/** The read is capped inside (lib/server/vision.ts time budgets, ~28 s worst case); the function limit sits above it. */
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    // Stage clock (10-02): the read stores how long the gates and the vision
    // call took, so scan speed is measured from real scans, not guessed.
    const startedAt = Date.now();
    const user = await requireUser();
    const wall = subscriptionGate(user);
    if (wall) return wall;
    // Every call here costs money at Anthropic — per-account burst + daily caps.
    enforceRateLimit(`vision:${user.id}`, ...LIMITS.visionScan);

    if (!isVisionConfigured()) {
      return NextResponse.json({ status: "unconfigured", card: null });
    }

    // A subscriber's balance (each payment adds the plan's scans, unused scans stack); the trial allowance lifetime; a Booster balance until it is gone.
    // Fast answer from the row already in hand; the reservation below is the real, atomic check.
    if (scanQuotaExhausted(user)) return outOfScans(user, scanQuota(user));

    const body = await req.json().catch(() => null);
    const language: ScanLanguage =
      body?.language === "ja" || body?.language === "zh" ? body.language : "en";

    // A real picture or a 400 before any scan is reserved (#33: lib/server/imageInput.ts).
    const input = readImageInput(body?.image);
    if (!input.ok) return NextResponse.json({ error: input.error }, { status: input.status });
    const { image, mediaType } = input;

    // Last gate before spending money — a well-formed request that clears the
    // burst limiter still has to fit the durable daily budget.
    const overBudget = await dayBudgetSpent(`scan_${user.id}`, SCAN_DAILY_BUDGET);
    if (overBudget) {
      return NextResponse.json(
        { error: "Today's scan budget is used up — try again tomorrow", retryAfterSeconds: 3600 },
        { status: 429, headers: { "Retry-After": "3600" } },
      );
    }

    // The scan is taken BEFORE the paid call (an atomic, guarded take: two
    // photos in flight can never spend the same last scan, and none is lost
    // to a stale read) and given back if the read fails: a failed scan
    // shouldn't count. Metered for everyone (launch pricing needs the data).
    const reservation = await reserveScan(user);
    if (reservation.taken < 1) return outOfScans(user, reservation.usage);
    let scanned;
    const visionAt = Date.now();
    try {
      scanned = await analyzeCardImageWithUsage(
        image,
        mediaType,
        language,
        parseGame(body?.game),
        body?.pocket === true,
        // No auto-switch (Chris 10-12): another game's card is a bad scan, not saved, given back
        // (scanGiveback readIsEmpty: seen != game). The scanner says which game to switch to.
        undefined,
        visionAt,
      );
    } catch (err) {
      await giveBackScans(user, reservation).catch((e) =>
        console.error("scan give-back failed:", e instanceof Error ? e.message : e),
      );
      // Out of time (lib/visionBudget.ts): the seller shoots again, the scan is given back, the Log page hears about it.
      if (isBudgetError(err)) {
        console.warn(`scan: read ran out of time after ${Date.now() - visionAt} ms (budget ${SCAN_BUDGET_MS} ms)`, err instanceof Error ? err.message : err);
        return NextResponse.json({ status: "error", reason: "timeout" }, { status: 504 });
      }
      throw err;
    }
    const { read: card, usage: tokens } = scanned;
    const visionMs = Date.now() - visionAt;
    // A slow day shows on the Log page before anyone notices (Chris 10-04: the scanner must never stall).
    if (visionMs > 6_000) console.warn(`scan: slow read ${visionMs} ms`, card.secondLook ? `second look: ${card.secondLook}` : "");
    // The token bill is written alongside; a ledger failure must never fail
    // a scan the seller already paid for.
    const [usage, , scanId] = await Promise.all([
      Promise.resolve(reservation.usage),
      // Today's good reads: the tiebreak and binder-locate routes are rationed against this. An empty read (the
      // give-back's own test) earns no allowance (10-16 audit: junk scans each bought one more Opus tiebreak).
      readIsEmpty({ conf: card.confidence, kind: card.kind ?? null, slab: card.slab === true, seen: card.detectedGame ?? null, game: card.game ?? parseGame(body?.game) })
        ? Promise.resolve(0)
        : dayBump(readsKey(user.id)).catch((err) => console.error("reads counter failed:", err instanceof Error ? err.message : err)),
      // The compact read (lib/server/scanLogRead.ts): name/number/code, the give-back fields, and for
      // Pokémon the pattern + ball read (B1 10-20: a Master Ball miss is diagnosable from the log).
      recordScanUsage(user.id, VISION_MODEL, tokens, scanLogRead(card, card.game ?? parseGame(body?.game), {
        // ms spent in the gates before the vision call, and in the call itself.
        pre: visionAt - startedAt,
        ms: visionMs,
      }), reservation.draw).catch((err) => {
        console.error("scan_usage write failed:", err instanceof Error ? err.message : err);
        return null;
      }),
    ]);
    // scanId: the row a "No match found" give-back names (POST /api/vision/scan/giveback, 10-11).
    return NextResponse.json({ status: "done", card, usage, scanId });
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
