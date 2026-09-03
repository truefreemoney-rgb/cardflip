import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { VisionUsage } from "@/lib/server/vision";

/**
 * The vision bill, measured — one scan_usage row per Anthropic call, priced
 * at insert time from the model's published rate so history stays true when
 * the model or the price changes. Answers the margin question with data:
 * "what does a scan actually cost, and what did this user cost this month".
 *
 * Rates are USD per million tokens (Anthropic first-party API, 2026-09):
 * input / output / cache read / cache write (5-min).
 */
const RATES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
};

/** Cost in microdollars (1e-6 USD) for one call on `model`. */
export function scanCostMicros(model: string, u: VisionUsage): number {
  const r = RATES[model];
  if (!r) return 0;
  // Anthropic bills cache reads/writes separately from plain input tokens.
  const usd =
    (u.inputTokens * r.input +
      u.outputTokens * r.output +
      u.cacheReadTokens * r.cacheRead +
      u.cacheWriteTokens * r.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1_000_000);
}

export async function recordScanUsage(userId: string, model: string, u: VisionUsage): Promise<void> {
  await db
    .prepare(
      `INSERT INTO scan_usage (id, user_id, at, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_micros)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      randomUUID(),
      userId,
      Date.now(),
      model,
      u.inputTokens,
      u.outputTokens,
      u.cacheReadTokens,
      u.cacheWriteTokens,
      scanCostMicros(model, u),
    );
}

export interface ScanSpend {
  scans: number;
  /** USD, summed from cost_micros. */
  usd: number;
  avgInputTokens: number;
  avgOutputTokens: number;
}

/** The admin console's two windows. The clock read lives here, not in the
 * page's render (react-hooks/purity flags Date.now() during render). */
export async function scanSpendSummary(): Promise<{ last24h: ScanSpend; last30d: ScanSpend }> {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const [last24h, last30d] = await Promise.all([scanSpendSince(now - DAY), scanSpendSince(now - 30 * DAY)]);
  return { last24h, last30d };
}

/** Spend over a window — the admin console's margin tile. */
export async function scanSpendSince(sinceMs: number): Promise<ScanSpend> {
  const row = (await db
    .prepare(
      `SELECT COUNT(*) AS scans, COALESCE(SUM(cost_micros), 0) AS micros,
              COALESCE(AVG(input_tokens), 0) AS avg_in, COALESCE(AVG(output_tokens), 0) AS avg_out
         FROM scan_usage WHERE at >= ?`,
    )
    .get(sinceMs)) as { scans: number; micros: number; avg_in: number; avg_out: number };
  return {
    scans: Number(row.scans),
    usd: Number(row.micros) / 1_000_000,
    avgInputTokens: Math.round(Number(row.avg_in)),
    avgOutputTokens: Math.round(Number(row.avg_out)),
  };
}
