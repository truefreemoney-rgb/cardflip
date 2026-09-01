import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Error-only monitoring, self-hosted in the app's own database. The site
 * promises "no analytics profile" in /privacy, so this records faults, not
 * people: source + message + stack, nothing about who was browsing.
 *
 * Writers: instrumentation.ts onRequestError (every unhandled route error)
 * plus explicit reportServerError calls in jobs. Reader: the admin console's
 * Errors section. 30-day retention, pruned opportunistically on write.
 */

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export interface ErrorEvent {
  id: string;
  at: number;
  source: string;
  message: string;
  stack: string | null;
  digest: string | null;
}

/** Never throws — a broken error logger must not take the request down with it. */
export async function reportServerError(
  source: string,
  err: unknown,
  digest?: string,
): Promise<void> {
  try {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error && err.stack ? err.stack.slice(0, 4000) : null;
    const now = Date.now();
    await db.prepare(
      "INSERT INTO error_events (id, at, source, message, stack, digest) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(randomUUID(), now, source.slice(0, 200), message.slice(0, 1000), stack, digest ?? null);
    await db.prepare("DELETE FROM error_events WHERE at < ?").run(now - RETENTION_MS);
  } catch {
    // Last resort only — the original error is already being handled upstream.
  }
}

export async function listRecentErrors(limit = 50): Promise<ErrorEvent[]> {
  const rows = (await db
    .prepare("SELECT * FROM error_events ORDER BY at DESC LIMIT ?")
    .all(limit)) as unknown as ErrorEvent[];
  return rows;
}

/** Errors in the last 24h — the admin KPI tile. */
export async function errorCount24h(): Promise<number> {
  const row = (await db
    .prepare("SELECT COUNT(*) AS n FROM error_events WHERE at > ?")
    .get(Date.now() - 24 * 60 * 60 * 1000)) as { n: number } | undefined;
  return row?.n ?? 0;
}
